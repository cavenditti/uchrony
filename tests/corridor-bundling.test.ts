import { stepDistance } from '../src/sim/grid'
import test from 'node:test'
import assert from 'node:assert/strict'
import { bundleCorridors, CORRIDOR_BUNDLING } from '../src/sim/corridor-bundling'
import { corridorCost, corridorProfile, corridorUsage, learnCorridors } from '../src/sim/corridors'
import { refreshTransport, reverseLegs, transportNetwork } from '../src/sim/transport'
import { freightOverlay } from '../src/map/trade'
import type { RouteLeg, World } from '../src/sim/types'
import { completedFreight, corridorWorld, independentHarbors as parallelHarbors } from './fixtures/corridors'

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
      crossings(world).map((link, i) =>
        JSON.stringify(link.legs) === JSON.stringify(original[i].legs) ? 0 : 12,
      ),
      'only geometry changed in the annual review receives a new adoption date',
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

test('short, distant and inactive lanes stay separate, and clear lanes avoid congestion', () => {
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
  const congested = corridorProfile(world),
    bundled = bundleCorridors(world, congested, links, () => true)
  assert.deepEqual(bundled[1], links[1], 'the clear lane does not join the congested one')
  assert(
    corridorCost(congested, bundled[0].legs) <= corridorCost(congested, links[0].legs),
    'the congested lane may escape onto a cheaper shared path',
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

test('long crossings four and five tiles apart share a trunk without moving ports', () => {
  for (const gap of [4, 5]) {
    const world = parallelHarbors({ width: 64, gap }),
      links = crossings(world)
    reinforce(
      world,
      links.map((link) => link.legs),
    )
    const profile = corridorProfile(world),
      bundled = bundleCorridors(world, profile, links, () => true)
    assert(sharedEdges(world, bundled[0].legs, bundled[1].legs) >= 50)
    for (const [i, link] of bundled.entries()) {
      assert.deepEqual(link.legs[0].cells.slice(0, 2), links[i].legs[0].cells.slice(0, 2))
      assert.deepEqual(link.legs[0].cells.slice(-2), links[i].legs[0].cells.slice(-2))
      const distance = (cells: number[]) =>
        cells.slice(1).reduce((sum, id, at) => sum + stepDistance(world.cells[cells[at]], world.cells[id]), 0)
      assert(
        distance(link.legs[0].cells) <= distance(links[i].legs[0].cells) + 2 * gap,
        'joining and leaving the trunk stays within the physical cross-track detour budget',
      )
    }
    assert.deepEqual(
      bundleCorridors(world, profile, bundled, () => true),
      bundled,
      'a joined branch does not become a competing trunk at the next review',
    )
  }
})

test('short parallel roads merge even when fewer than twelve edges can be shared', () => {
  const width = 14,
    world = corridorWorld(Array.from({ length: 6 }, () => 'A'.repeat(width))),
    links = [2, 3].map((row, i) => ({
      from: 0,
      to: i,
      legs: [
        {
          mode: 'land' as const,
          cells: Array.from({ length: width - 2 }, (_, col) => row * width + col + 1),
        },
      ],
    }))
  reinforce(
    world,
    links.map((link) => link.legs),
  )
  const bundled = bundleCorridors(world, corridorProfile(world), links, () => true)
  assert(sharedEdges(world, bundled[0].legs, bundled[1].legs) >= 8)
  assert.equal(bundled[1].legs[0].cells[0], links[1].legs[0].cells[0])
  assert.equal(bundled[1].legs[0].cells.at(-1), links[1].legs[0].cells.at(-1))
})

test('a small parallel fork rejoins an already shared long road', () => {
  const width = 300,
    world = corridorWorld(Array.from({ length: 6 }, () => 'A'.repeat(width))),
    trunk = Array.from({ length: width - 2 }, (_, col) => 2 * width + col + 1),
    branch = [
      ...trunk.slice(0, 140),
      3 * width + 140,
      ...Array.from({ length: 8 }, (_, col) => 3 * width + 141 + col),
      ...trunk.slice(148),
    ],
    links = [trunk, branch].map((cells, i) => ({
      from: 0,
      to: i + 1,
      legs: [{ mode: 'land' as const, cells }],
    }))
  reinforce(
    world,
    links.map((link) => link.legs),
  )
  const profile = corridorProfile(world)
  for (const cells of [trunk, branch])
    cells.forEach((id, i) => {
      if (i) assert(profile.adjacent[cells[i - 1]].includes(id))
    })
  const bundled = bundleCorridors(world, profile, links, () => true)
  assert.deepEqual(bundled[0].legs[0].cells, trunk)
  assert.deepEqual(bundled[1].legs[0].cells, trunk)
  assert.deepEqual(bundleCorridors(world, profile, [...links].reverse(), () => true).reverse(), bundled)
})

test('several parallel branches converge on one common trunk in the same review', () => {
  const width = 64,
    world = corridorWorld(Array.from({ length: 9 }, () => 'A'.repeat(width))),
    links = [2, 4, 5].map((row, i) => ({
      from: 0,
      to: i + 1,
      legs: [
        {
          mode: 'land' as const,
          cells: Array.from({ length: 60 - i * 2 }, (_, col) => row * width + col + 1 + i),
        },
      ],
    }))
  reinforce(
    world,
    links.map((link) => link.legs),
  )
  const profile = corridorProfile(world),
    oldEdges = new Set(links.flatMap((link) => [...corridorUsage(profile, link.legs).keys()])),
    bundled = bundleCorridors(world, profile, links, () => true),
    occupied = new Set(bundled.flatMap((link) => [...corridorUsage(profile, link.legs).keys()]))
  for (const [a, b] of [
    [0, 1],
    [0, 2],
    [1, 2],
  ])
    assert(sharedEdges(world, bundled[a].legs, bundled[b].legs) >= 50)
  assert(occupied.size < oldEdges.size * 0.5, 'one trunk replaces the three parallel lanes')
  assert.deepEqual(bundleCorridors(world, profile, [...links].reverse(), () => true).reverse(), bundled)
  for (const link of bundled) {
    const cells = link.legs[0].cells
    assert.equal(new Set(cells).size, cells.length)
    cells.forEach((id, i) => {
      if (i) assert(profile.adjacent[cells[i - 1]].includes(id))
    })
  }
})

test('long lanes up to eight tiles apart consolidate with bounded detours', () => {
  const world = parallelHarbors({ width: 96, gap: 8 }),
    links = crossings(world)
  reinforce(
    world,
    links.map((link) => link.legs),
  )
  const profile = corridorProfile(world),
    bundled = bundleCorridors(world, profile, links, () => true)
  assert(sharedEdges(world, bundled[0].legs, bundled[1].legs) >= 75)
  for (const [i, link] of bundled.entries()) {
    assert(link.legs[0].cells.length <= links[i].legs[0].cells.length + 16)
    assert.deepEqual(link.legs[0].cells.slice(0, 2), links[i].legs[0].cells.slice(0, 2))
    assert.deepEqual(link.legs[0].cells.slice(-2), links[i].legs[0].cells.slice(-2))
  }
})

test('repeated network cleanup strictly improves its objective without detour growth inside a review', () => {
  const width = 100,
    world = corridorWorld(Array.from({ length: 12 }, () => 'A'.repeat(width))),
    links = [1, 3, 5, 7, 9].map((row, i) => ({
      from: 0,
      to: i + 1,
      legs: [{ mode: 'land' as const, cells: Array.from({ length: 98 }, (_, col) => row * width + col + 1) }],
    }))
  reinforce(
    world,
    links.map((link) => link.legs),
  )
  const profile = corridorProfile(world),
    input = structuredClone(links)
  const score = (network: typeof links) => {
    const used = new Set<number>()
    let cost = 0
    for (const link of network)
      for (const [edge, n] of corridorUsage(profile, link.legs)) {
        if (!used.has(edge)) cost += profile.baseCost[edge]
        used.add(edge)
        cost += CORRIDOR_BUNDLING.travelWeight * profile.cost[edge] * n
      }
    return cost
  }
  let current = links
  for (let review = 0; review < 4; review++) {
    const next = bundleCorridors(world, profile, current, () => true)
    assert(score(next) <= score(current) + 1e-9)
    if (JSON.stringify(next) !== JSON.stringify(current)) assert(score(next) < score(current) - 1e-9)
    for (const [i, link] of next.entries()) {
      const effort = (path: RouteLeg[]) =>
        [...corridorUsage(profile, path)].reduce((sum, [edge, n]) => sum + profile.baseCost[edge] * n, 0)
      assert(effort(link.legs) <= effort(current[i].legs) * 1.25 + 1e-9)
      assert.equal(new Set(link.legs[0].cells).size, link.legs[0].cells.length)
    }
    current = next
  }
  assert(score(current) < score(links) * 0.7)
  assert.deepEqual(links, input, 'input geometry stays immutable')
})
