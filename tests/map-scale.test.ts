import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { movementNeighbors, neighbors, CELL_SIZE } from '../src/sim/grid'
import { tick } from '../src/sim/engine'
import { validateWorld, restoreWorld } from '../src/sim/persistence'
import { transportNetwork } from '../src/sim/transport'
import { population } from '../src/sim/types'
import { WORLD_SCALES, worldScale } from '../src/sim/scale'
import { buildGeometry, contains, zoomAt } from '../src/map/geometry'
import { HISTORICAL_EVENT_SCHEMA, validateHistoricalProposal } from '../src/sim/history-schema'
import { ensureHistory } from '../src/sim/history'
import { proceduralEvent } from '../src/sim/history-procedural'

test('world scale adds physical distance, connected provinces, independent states and a sparse navigable shipping network', () => {
  const w = generateWorld('A world unwritten', 3, 32, undefined, 'world')
  validateWorld(w)
  assert.equal(w.cells.length, 8064 * 16)
  assert.equal(w.width, WORLD_SCALES.world.width)
  assert(w.regions.length >= 1400)
  assert.equal(w.nations.length, 32)
  assert.equal(new Set(w.nations.map((n) => n.name)).size, 32)
  assert.equal(new Set(w.nations.map((n) => n.shortName)).size, 32)
  assert.equal(new Set(w.regions.map((r) => r.name)).size, w.regions.length)
  assert(w.cells.at(-1)!.x === (w.width - 0.5) * CELL_SIZE, 'physical sample size stays fixed as the world grows')
  for (const r of w.regions) {
    const seen = new Set([r.center]),
      queue = [r.center]
    for (let i = 0; i < queue.length; i++)
      for (const id of neighbors(queue[i], w.width, w.height))
        if (w.cells[id].region === r.id && !seen.has(id)) {
          seen.add(id)
          queue.push(id)
        }
    assert.equal(seen.size, r.cells.length, r.name)
  }
  const network = transportNetwork(w),
    sea = network.links.filter((link) => link.seaCost > 0)
  assert(sea.length > 0)
  assert(sea.length < network.harbors.length * 8, 'shipping graph grows with ports, not port pairs')
  for (const link of network.links) {
    assert.equal(link.legs[0].cells[0], w.regions[link.from].center)
    assert.equal(link.legs.at(-1)!.cells.at(-1), w.regions[link.to].center)
    for (const leg of link.legs)
      for (let i = 1; i < leg.cells.length; i++)
        assert(movementNeighbors(w.cells, leg.cells[i - 1], w.width, w.height).includes(leg.cells[i]))
  }
  // Every coastal province on a shared basin must be mutually reachable by
  // land and/or sea, including the islands the sparse network was built for.
  const graph = w.regions.map(() => [] as number[])
  for (const link of network.links) {
    graph[link.from].push(link.to)
    graph[link.to].push(link.from)
  }
  const reached = new Set([network.harbors[0].region]),
    queue = [...reached]
  for (let i = 0; i < queue.length; i++)
    for (const id of graph[queue[i]])
      if (!reached.has(id)) {
        reached.add(id)
        queue.push(id)
      }
  assert.equal(reached.size, w.regions.length)
  const geometry = buildGeometry(w.cells, w.width, w.height, w.regions.length)
  for (const r of w.regions.filter((_, i) => i % 17 === 0))
    for (const id of r.cells) {
      const c = w.cells[id]
      assert(contains(geometry.provinces[r.id], c.x, c.y))
    }
  const people = () =>
    w.regions.reduce((sum, r) => sum + population(r), 0) +
    w.armies.reduce((sum, a) => sum + a.soldiers, 0) +
    (w.warfare?.fleets ?? []).reduce((sum, f) => sum + f.soldiers, 0)
  for (let i = 0; i < 3; i++) {
    const before = people()
    tick(w)
    assert.equal(people(), before + w.totals.births - w.totals.deaths)
    validateWorld(w)
  }
  // Generated events and structured model effects can address provinces above
  // the old 599 ceiling as well as loading/saving their consequences.
  const region = w.regions[1000],
    history = ensureHistory(w)
  const event = proceduralEvent(w, {
    id: history.nextId++,
    month: w.month,
    nation: region.nation,
    region: region.id,
    category: 'discovery',
    seed: 73,
  })
  assert.equal(validateHistoricalProposal(w, event).region, 1000)
  assert((HISTORICAL_EVENT_SCHEMA.properties.region.maximum ?? 0) >= 1399)
  const restored = restoreWorld(JSON.parse(JSON.stringify(w)))
  assert.equal(restored.width, w.width)
  assert.equal(restored.regions.length, w.regions.length)
  assert.deepEqual(restored.tradeLanes, w.tradeLanes)
})

test('continental generation supports many states and legacy regional saves retain their dimensions', () => {
  const w = generateWorld('Scattered new states', 5, 48, undefined, 'continental')
  validateWorld(w)
  assert.equal(w.cells.length, 8064 * 4)
  assert(w.regions.length >= 560)
  assert.equal(w.nations.length, 48)
  assert(w.nations.every((n) => typeof w.regions[n.capital].name === 'string'))
  const legacy = generateWorld('Legacy dimensions')
  assert.equal(restoreWorld(JSON.parse(JSON.stringify(legacy))).cells.length, 8064)
  legacy.cells[1].q = legacy.width
  assert.throws(() => validateWorld(legacy), /map cell/)
  assert.throws(() => worldScale('unbounded'), /scale/)
})

test('the atlas can zoom from the full world to individual settlements', () => {
  const view = zoomAt({ zoom: 1, x: 0, y: 0 }, 32, { x: 450, y: 325 }, { w: 900, h: 650 })
  assert.equal(view.zoom, 32)
})
