import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { neighbors, HEX } from '../src/sim/hex'
import { transportNetwork } from '../src/sim/transport'
import { trade, transportGraph } from '../src/sim/economy'
import { validateWorld } from '../src/sim/persistence'
import { freightOverlay, pointAlong } from '../src/map/trade'
import { inventory, type Cell, type Region, type Route, type World } from '../src/sim/types'

// Small geographic fixtures isolate physical routing from the economic model.
function map(rows: string[]): World {
  const width = rows[0].length,
    height = rows.length,
    names = [...new Set(rows.join('').replaceAll('.', ''))].sort()
  const cells: Cell[] = rows.flatMap((row, r) =>
    [...row].map((name, q) => ({
      id: r * width + q,
      q,
      r,
      x: (q + (r % 2) / 2) * Math.sqrt(3) * HEX,
      y: r * 1.5 * HEX,
      terrain: name === '.' ? 'water' : 'plains',
      region: names.indexOf(name),
      elevation: name === '.' ? 0 : 0.3,
      moisture: 0.5,
      river: false,
    })),
  )
  const regions = names.map((name, id) => ({
    id,
    name,
    center: cells.find((c) => c.region === id)!.id,
    cells: cells.filter((c) => c.region === id).map((c) => c.id),
  })) as Region[]
  return { cells, regions, width, height, routes: [] } as unknown as World
}

function assertLegs(w: World, from: number, to: number, legs: NonNullable<Route['legs']>) {
  let at = w.regions[from].center
  for (const leg of legs) {
    assert.equal(leg.cells[0], at)
    assert(leg.cells.length >= (leg.mode === 'sea' ? 3 : 2))
    leg.cells.forEach((id, i) => {
      const water = w.cells[id].terrain === 'water'
      assert.equal(water, leg.mode === 'sea' && i > 0 && i < leg.cells.length - 1)
      if (i) assert(neighbors(leg.cells[i - 1], w.width, w.height).includes(id))
    })
    at = leg.cells[leg.cells.length - 1]
  }
  assert.equal(at, w.regions[to].center)
}

test('shipping navigates around a headland and cannot connect separated water bodies', () => {
  const rows = Array.from({ length: 9 }, () => [...'...........'])
  rows[4][1] = 'A'
  rows[4][9] = 'B'
  for (let r = 1; r < 8; r++) rows[r][5] = 'C'
  const w = map(rows.map((r) => r.join(''))),
    network = transportNetwork(w),
    link = network.links.find((l) => l.from === 0 && l.to === 1)!
  assert(link, 'both islands share a navigable sea')
  assertLegs(w, link.from, link.to, link.legs)
  assert(
    link.legs[0].cells.some((id) => w.cells[id].r === 0 || w.cells[id].r === 8),
    'ship goes around the headland',
  )
  rows[0][5] = rows[8][5] = 'C'
  const divided = map(rows.map((r) => r.join('')))
  assert(
    !transportNetwork(divided).links.some((l) => l.from === 0 && l.to === 1),
    'no shipping through a land barrier',
  )
})

test('roads use a low pass, stay within the connected provinces, and share harbor access', () => {
  const w = map(['AAABB', 'AAABB', 'AAABB', 'AAABB', 'AAABB'])
  w.regions[0].center = 10
  w.regions[1].center = 14
  for (let r = 0; r < 4; r++) {
    w.cells[r * 5 + 2].terrain = 'mountains'
    w.cells[r * 5 + 2].elevation = 1.2
  }
  const road = transportNetwork(w).links[0]
  assertLegs(w, 0, 1, road.legs)
  assert(road.legs[0].cells.includes(22), 'uses the low southern pass')
  assert(!road.legs[0].cells.some((id) => w.cells[id].terrain === 'mountains'))
  for (const seed of ['A world unwritten', 'Straits', 'Harbors']) {
    const world = generateWorld(seed, 5),
      network = transportNetwork(world)
    assert(network.links.some((l) => l.seaCost > 0))
    for (const link of network.links) {
      assertLegs(world, link.from, link.to, link.legs)
      for (const leg of link.legs)
        if (leg.mode === 'land')
          assert(leg.cells.every((id) => [link.from, link.to].includes(world.cells[id].region)))
    }
    for (const port of network.harbors) {
      assert.equal(port.access[0], world.regions[port.region].center)
      assert.equal(port.access.at(-1), port.land)
      assert(neighbors(port.land, world.width, world.height).includes(port.water))
      assert.equal(world.cells[port.water].terrain, 'water')
    }
  }
})

test('civilian routes are symmetric while military sea access is checked in each direction', () => {
  const w = generateWorld('Sea access'),
    civilian = transportGraph(w)
  civilian.forEach((edges, from) =>
    edges.forEach((edge) => {
      const back = civilian[edge.to].find((e) => e.to === from)!
      assert.equal(back.cost, edge.cost)
      assert.equal(back.capacity, edge.capacity)
      assertLegs(w, from, edge.to, edge.legs)
    }),
  )
  const sea = transportNetwork(w).links.find((l) => l.seaCost > 0)!
  w.regions[sea.from].nation = 0
  w.regions[sea.to].nation = 1
  const rel = w.relations.find((r) => r.a === 0 && r.b === 1)!
  rel.treaty = 'neutral'
  let military = transportGraph(w, 0)
  assert(!military[sea.from].some((e) => e.to === sea.to))
  assert(military[sea.to].some((e) => e.to === sea.from))
  rel.treaty = 'war'
  assert(!transportGraph(w)[sea.from].some((e) => e.to === sea.to))
  military = transportGraph(w, 0)
  assert(military[sea.from].some((e) => e.to === sea.to))
})

test('shipments use the exact physical network; saved geometry rejects jumps, water roads and broken endpoints', () => {
  const w = generateWorld('Freight saves')
  trade(w)
  assert(w.routes.length > 0)
  const graph = transportGraph(w)
  for (const route of w.routes) {
    assertLegs(w, route.from, route.to, route.legs!)
    assert.deepEqual(
      route.legs,
      route.path.slice(1).flatMap((to, i) => graph[route.path[i]].find((e) => e.to === to)!.legs),
    )
  }
  validateWorld(w)
  const legacy = structuredClone(w)
  legacy.routes.forEach((route) => {
    delete route.legs
  })
  validateWorld(legacy)
  assert(freightOverlay(legacy, 0, null).legacy)
  assert.equal(freightOverlay(legacy, 0, null).corridors.length, 0)
  for (const mutate of [
    (copy: World) => {
      copy.routes[0].legs![0].cells[0] = copy.cells.find((c) => c.terrain === 'water')!.id
    },
    (copy: World) => {
      copy.routes[0].legs![0].cells[1] = copy.routes[0].legs![0].cells[0]
    },
    (copy: World) => {
      copy.routes[0].legs![0].mode = 'sea'
    },
    (copy: World) => {
      copy.routes[0].to = (copy.routes[0].to + 1) % copy.regions.length
    },
  ]) {
    const copy = structuredClone(w)
    mutate(copy)
    assert.throws(() => validateWorld(copy), /freight|shipping/)
  }
})

test('map corridors aggregate opposing shipments once and focus only relevant freight', () => {
  const w = map(['AAAB'])
  w.regions[0].nation = 0
  w.regions[1].nation = 1
  const route = (from: number, to: number, volume: number): Route => ({
    id: `${from}-${to}-${volume}`,
    from,
    to,
    path: [from, to],
    sea: false,
    legs: [{ mode: 'land', cells: from === 0 ? [0, 1, 2, 3] : [3, 2, 1, 0] }],
    goods: inventory(),
    volume,
    value: 0,
    capacity: 100,
    international: true,
  })
  w.routes = [route(0, 1, 10), route(0, 1, 6), route(1, 0, 4)]
  const overlay = freightOverlay(w, 0, null)
  assert.equal(overlay.corridors.length, 1)
  const corridor = overlay.corridors[0]
  assert.equal(corridor.forward, 16)
  assert.equal(corridor.backward, 4)
  assert.equal(corridor.selectedForward + corridor.selectedBackward, 20)
  assert.equal(freightOverlay(w, 2, null).corridors[0].selectedForward, 0)
  const middle = pointAlong(w, corridor, corridor.distance / 2)
  assert(Math.abs(middle.x - (w.cells[0].x + w.cells[3].x) / 2) < 1e-8)
  assert.equal(pointAlong(w, corridor, -1).x, w.cells[0].x)
  assert.equal(pointAlong(w, corridor, corridor.distance + 1).x, w.cells[3].x)
})
