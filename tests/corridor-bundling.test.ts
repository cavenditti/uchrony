import test from 'node:test'
import assert from 'node:assert/strict'
import { bundleCorridors } from '../src/sim/corridor-bundling'
import { corridorProfile, corridorUsage, learnCorridors } from '../src/sim/corridors'
import { refreshTransport, reverseLegs, transportNetwork } from '../src/sim/transport'
import { freightOverlay } from '../src/map/trade'
import type { RouteLeg, World } from '../src/sim/types'
import { completedFreight, corridorWorld, parallelHarbors } from './fixtures/corridors'

const crossings = (world: World) =>
  [
    [0, 1],
    [2, 3],
  ].map(([from, to]) => transportNetwork(world).links.find((link) => link.from === from && link.to === to)!)
const sharedEdges = (world: World, a: RouteLeg[], b: RouteLeg[]) => {
  const profile = corridorProfile(world),
    edges = corridorUsage(profile, a)
  return [...corridorUsage(profile, b).keys()].filter((edge) => edges.has(edge)).length
}
function reinforce(world: World, legs: RouteLeg[][], traffic = 1000) {
  const profile = corridorProfile(world),
    edges = new Set(legs.flatMap((path) => [...corridorUsage(profile, path).keys()]))
  world.corridors = [...edges].map((edge) => ({
    a: profile.segments[edge].a,
    b: profile.segments[edge].b,
    familiarity: 0.7,
    traffic,
  }))
}

test('equally busy parallel crossings merge physically and remain stable with opposing freight', () => {
  for (const gap of [2, 3]) {
    const world = parallelHarbors({ gap }),
      original = crossings(world),
      ports = transportNetwork(world).harbors.map((port) => [port.land, port.water]),
      before = sharedEdges(world, original[0].legs, original[1].legs)
    let changes = 0,
      previous = JSON.stringify(original.map((link) => link.legs))
    for (let month = 0; month <= 48; month++) {
      world.month = month
      const profile = corridorProfile(world)
      refreshTransport(world, profile)
      const current = crossings(world),
        geometry = JSON.stringify(current.map((link) => link.legs))
      if (geometry !== previous) changes++
      previous = geometry
      if (month < 12)
        assert.deepEqual(
          current.map((link) => link.legs),
          original.map((link) => link.legs),
        )
      else assert(sharedEdges(world, current[0].legs, current[1].legs) >= before + 24)
      world.routes = [
        completedFreight(current[0]),
        completedFreight({ from: 3, to: 2, legs: reverseLegs(current[1].legs) }),
      ]
      learnCorridors(world, profile)
      for (const link of current)
        for (const leg of link.legs) {
          assert.equal(new Set(leg.cells).size, leg.cells.length, 'no loops')
          leg.cells.forEach((id, i) => {
            if (i) assert(profile.adjacent[leg.cells[i - 1]].includes(id), 'every step is adjacent')
            if (leg.mode === 'sea' && i > 0 && i < leg.cells.length - 1)
              assert.equal(world.cells[id].terrain, 'water')
          })
        }
    }
    assert.equal(changes, 1, 'no periodic split and rejoin')
    assert.deepEqual(
      [
        [0, 1],
        [2, 3],
      ].map(
        ([from, to]) =>
          world.corridorPlan!.links.find((link) => link.from === from && link.to === to)!.changedAt,
      ),
      [0, 12],
      'unchanged geometry retains its original adoption date',
    )
    assert.deepEqual(
      transportNetwork(world).harbors.map((port) => [port.land, port.water]),
      ports,
    )
    const overlay = freightOverlay(world, 0, null)
    assert(overlay.corridors.some((corridor) => corridor.forward === 1000 && corridor.backward === 1000))
  }
})

test('bundling is deterministic under input order and bounds extra travel effort', () => {
  const world = parallelHarbors(),
    links = crossings(world)
  reinforce(
    world,
    links.map((link) => link.legs),
  )
  const profile = corridorProfile(world),
    bundled = bundleCorridors(world, profile, links, () => true),
    reversed = bundleCorridors(world, profile, [...links].reverse(), () => true).reverse()
  assert.deepEqual(bundled, reversed)
  assert(sharedEdges(world, bundled[0].legs, bundled[1].legs) >= 24)
  for (const [i, link] of bundled.entries()) {
    const effort = (legs: RouteLeg[]) =>
      [...corridorUsage(profile, legs)].reduce(
        (sum, [edge, count]) => sum + profile.baseCost[edge] * count,
        0,
      )
    assert(effort(link.legs) <= effort(links[i].legs) * 1.15)
    assert(link.legs[0].cells.length <= links[i].legs[0].cells.length + 6)
    assert.deepEqual(link.legs[0].cells.slice(0, 2), links[i].legs[0].cells.slice(0, 2))
    assert.deepEqual(link.legs[0].cells.slice(-2), links[i].legs[0].cells.slice(-2))
  }
  assert.deepEqual(
    bundleCorridors(world, profile, links, () => false),
    links,
    'young paths hold',
  )
})

test('short, distant, inactive and expensive congested lanes stay separate', () => {
  for (const config of [{ width: 12 }, { gap: 8 }]) {
    const world = parallelHarbors(config),
      links = crossings(world)
    reinforce(
      world,
      links.map((link) => link.legs),
    )
    assert.deepEqual(
      bundleCorridors(world, corridorProfile(world), links, () => true),
      links,
    )
  }
  const world = parallelHarbors(),
    links = crossings(world)
  assert.deepEqual(
    bundleCorridors(world, corridorProfile(world), links, () => true),
    links,
  )
  reinforce(
    world,
    links.map((link) => link.legs),
  )
  const profile = corridorProfile(world),
    first = corridorUsage(profile, links[0].legs)
  for (const trace of world.corridors!) if (first.has(profile.index(trace.a, trace.b))) trace.traffic = 100000
  assert.deepEqual(
    bundleCorridors(world, corridorProfile(world), links, () => true),
    links,
  )
})

test('nearby water lanes cannot merge through a land barrier', () => {
  const rows = Array.from({ length: 7 }, () => '.'.repeat(40).split(''))
  rows[1][1] = 'A'
  rows[1][38] = 'B'
  rows[3].fill('E')
  rows[5][1] = 'C'
  rows[5][38] = 'D'
  const world = corridorWorld(rows.map((row) => row.join(''))),
    links = crossings(world)
  reinforce(
    world,
    links.map((link) => link.legs),
  )
  assert.deepEqual(
    bundleCorridors(world, corridorProfile(world), links, () => true),
    links,
  )
})

test('road bundles honor terrain and cannot use an unrelated province', () => {
  const make = () => {
    const world = corridorWorld(Array.from({ length: 7 }, () => 'A'.repeat(40))),
      links = [2, 4].map((row, i) => ({
        from: 0,
        to: i,
        legs: [{ mode: 'land' as const, cells: Array.from({ length: 38 }, (_, col) => row * 40 + col + 1) }],
      }))
    return { world, links }
  }
  const plain = make()
  reinforce(
    plain.world,
    plain.links.map((link) => link.legs),
  )
  const bundled = bundleCorridors(plain.world, corridorProfile(plain.world), plain.links, () => true)
  assert(sharedEdges(plain.world, bundled[0].legs, bundled[1].legs) >= 24)
  for (const barrier of ['mountains', 'province']) {
    const { world, links } = make()
    for (let id = 120; id < 160; id++) {
      if (barrier === 'mountains') {
        world.cells[id].terrain = 'mountains'
        world.cells[id].elevation = 3
      } else world.cells[id].region = 1
    }
    if (barrier === 'province') world.regions.push({ ...world.regions[0], id: 1 })
    reinforce(
      world,
      links.map((link) => link.legs),
    )
    assert.deepEqual(
      bundleCorridors(world, corridorProfile(world), links, () => true),
      links,
    )
  }
})
