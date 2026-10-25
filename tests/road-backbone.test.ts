import test from 'node:test'
import assert from 'node:assert/strict'
import { roadBackbone, ROAD_BACKBONE } from '../src/sim/road-backbone'
import { transportNetwork } from '../src/sim/transport'
import { corridorGeography, corridorProfile } from '../src/sim/corridors'
import { shortestPaths, transportGraph } from '../src/sim/economy'
import { generateWorld } from '../src/sim/generate'
import { ensureDistrictEconomy } from '../src/sim/districts'
import { districtNetwork } from '../src/sim/district-transport'
import { corridorWorld } from './fixtures/corridors'
import type { RouteLeg, World } from '../src/sim/types'

function towns() {
  return corridorWorld(
    Array.from({ length: 7 }, (_, r) =>
      Array.from({ length: 7 }, (_, c) => String.fromCharCode(65 + r * 7 + c)).join(''),
    ),
  )
}
function distances(world: World, links: { from: number; to: number; legs: RouteLeg[] }[], start: number) {
  const geo = corridorGeography(world),
    graph = world.regions.map(() => [] as { to: number; cost: number }[])
  for (const link of links) {
    const cost = link.legs.reduce(
      (sum, l) =>
        sum + l.cells.slice(1).reduce((n, b, i) => n + geo.segments[geo.index(l.cells[i], b)].effort, 0),
      0,
    )
    graph[link.from].push({ to: link.to, cost })
    graph[link.to].push({ to: link.from, cost })
  }
  const d = new Float64Array(graph.length).fill(Infinity),
    pending = new Set(graph.map((_, i) => i))
  d[start] = 0
  while (pending.size) {
    const at = [...pending].sort((a, b) => d[a] - d[b] || a - b)[0]
    pending.delete(at)
    if (!Number.isFinite(d[at])) break
    for (const edge of graph[at]) d[edge.to] = Math.min(d[edge.to], d[at] + edge.cost)
  }
  return d
}

test('young towns share a sparse road backbone with bounded detours and no lost destinations', () => {
  const w = towns(),
    input = transportNetwork(w).links,
    saved = JSON.stringify(input),
    selected = roadBackbone(w, input)
  assert(selected.length < input.length * 0.6)
  assert(selected.length >= w.regions.length - 1)
  for (const r of w.regions) {
    const before = distances(w, input, r.id),
      after = distances(w, selected, r.id)
    for (const dest of w.regions) {
      assert(Number.isFinite(after[dest.id]))
      assert(after[dest.id] <= before[dest.id] * ROAD_BACKBONE.maximumDetour + 1e-9)
    }
  }
  assert.deepEqual(roadBackbone(w, [...input].reverse()).reverse(), selected)
  assert.equal(JSON.stringify(input), saved)
  assert(
    selected.every((link) => input.includes(link)),
    'costs and physical paths are retained, not invented',
  )
})

test('cross-links require developed infrastructure, logistics and real established traffic together', () => {
  const w = towns(),
    input = transportNetwork(w).links,
    early = roadBackbone(w, input)
  w.regions.forEach((r) => (r.infrastructure = 0.9))
  w.nations[0].technologies.logistics = 7
  assert.deepEqual(roadBackbone(w, input), early, 'age or technology alone cannot manufacture mature demand')
  w.corridors = corridorGeography(w).segments.map(({ a, b }) => ({ a, b, familiarity: 0.8, traffic: 200 }))
  const mature = roadBackbone(w, input)
  assert(mature.length > early.length * 1.3)
  assert(
    early.every((link) => mature.includes(link)),
    'maturity adds useful roads without dismantling the backbone',
  )
  w.regions.forEach((r) => (r.infrastructure = 0.3))
  assert.deepEqual(roadBackbone(w, input), early, 'busy trails alone do not create an advanced road grid')
  w.regions.forEach((r) => (r.infrastructure = 0.9))
  w.nations[0].technologies.logistics = 0
  assert.deepEqual(roadBackbone(w, input), early)
  w.nations[0].technologies.logistics = 7
  w.corridors.forEach((c) => (c.traffic = 0))
  assert.deepEqual(roadBackbone(w, input), early, 'unused historic paths do not justify cross-links')
})

test('civilian access stays symmetric and domestic components survive foreign border closures', () => {
  const w = towns()
  w.nations.push({ ...structuredClone(w.nations[0]), id: 1 })
  w.regions.forEach((r) => (r.nation = w.cells[r.center].q < 3 ? 0 : 1))
  w.relations = [{ a: 0, b: 1, treaty: 'war' }] as World['relations']
  const graph = transportGraph(w)
  for (const r of w.regions) {
    const paths = shortestPaths(graph, r.id)
    for (const dest of w.regions)
      assert.equal(Number.isFinite(paths.distance[dest.id]), r.nation === dest.nation)
    for (const edge of graph[r.id])
      assert(
        graph[edge.to].some(
          (back) => back.to === r.id && back.cost === edge.cost && back.capacity === edge.capacity,
        ),
      )
  }
  const selected = graph.flat().length
  w.month = 96
  assert.equal(transportGraph(w).flat().length, selected, 'elapsed time does not densify the network')
})

test('fresh local markets use the sparse backbone while preserving segment budgets and reachable markets', () => {
  const w = generateWorld('Young road hierarchy')
  ensureDistrictEconomy(w)
  const network = districtNetwork(w),
    profile = corridorProfile(w)
  assert.equal(w.month, 0)
  const neighborPairs =
      w.localEconomy!.active.reduce((sum, id) => sum + w.localEconomy!.units[id].neighbors.length, 0) / 2,
    activeRoads =
      [...network.graph.values()].reduce(
        (sum, edges) => sum + edges.filter((edge) => edge.legs.every((leg) => leg.mode === 'land')).length,
        0,
      ) / 2
  assert(
    activeRoads < neighborPairs * 0.6,
    'the initial district graph must not restore the dense neighbor grid',
  )
  assert([...network.graph.values()].some((edges) => edges.length))
  for (const [from, edges] of network.graph)
    for (const edge of edges) {
      const back = network.graph.get(edge.to)!.find((e) => e.to === from)
      assert(back)
      assert.equal(back.capacity, edge.capacity)
      for (const [segment, count] of edge.usage)
        assert(edge.capacity <= profile.capacity[segment] / count + 1e-7)
      for (const leg of edge.legs)
        for (let i = 1; i < leg.cells.length; i++)
          assert(profile.adjacent[leg.cells[i - 1]].includes(leg.cells[i]))
    }
  const saved = structuredClone(w),
    restored = districtNetwork(saved)
  assert.deepEqual(
    [...restored.graph].map(([id, edges]) => [id, edges.map((e) => e.to)]),
    [...network.graph].map(([id, edges]) => [id, edges.map((e) => e.to)]),
  )
})
