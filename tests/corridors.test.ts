import test from 'node:test'
import assert from 'node:assert/strict'
import { corridorCost, corridorProfile, corridorUsage, learnCorridors } from '../src/sim/corridors'
import { refreshTransport, transportNetwork } from '../src/sim/transport'
import { reserveTarget, trade } from '../src/sim/economy'
import { generateWorld } from '../src/sim/generate'
import { tick } from '../src/sim/engine'
import { parseSave, validateWorld } from '../src/sim/persistence'
import { GOODS, type World } from '../src/sim/types'
import { completedFreight, corridorWorld, independentHarbors as parallelHarbors } from './fixtures/corridors'

test('successful traffic attracts other journeys onto a shared corridor without moving harbors', () => {
  const world = parallelHarbors(),
    original = transportNetwork(world),
    trunk = original.links.find((link) => link.from === 0 && link.to === 1)!,
    neighbor = original.links.find((link) => link.from === 2 && link.to === 3)!,
    shared = (legs: typeof trunk.legs) => {
      const profile = corridorProfile(world),
        used = corridorUsage(profile, trunk.legs)
      return [...corridorUsage(profile, legs).keys()].filter((index) => used.has(index)).length
    },
    before = shared(neighbor.legs)
  refreshTransport(world, corridorProfile(world))
  const initialPlan = world.corridorPlan
  for (let month = 1; month <= 48; month++) {
    world.month = month
    const profile = corridorProfile(world)
    refreshTransport(world, profile)
    world.routes = [completedFreight(trunk)]
    learnCorridors(world, profile)
    if (month === 1) assert.equal(world.corridorPlan, initialPlan, 'no monthly path jump')
    if (month < 12)
      assert.deepEqual(
        transportNetwork(world).links.find((link) => link.from === 2 && link.to === 3)!.legs,
        neighbor.legs,
        'adopted tile paths hold for at least a year',
      )
  }
  const learned = transportNetwork(world).links.find((link) => link.from === 2 && link.to === 3)!
  assert(shared(learned.legs) > before + 20, 'parallel journeys join the successful trunk')
  assert.deepEqual(
    transportNetwork(world).harbors.map((port) => [port.land, port.water]),
    original.harbors.map((port) => [port.land, port.water]),
  )
  const profile = corridorProfile(world)
  assert(corridorCost(profile, learned.legs) < corridorCost(profile, neighbor.legs) * 0.9)
})

test('terrain penalties survive reinforcement, and congestion can outweigh familiarity', () => {
  const world = corridorWorld(['AAABB', 'AAABB', 'AAABB', 'AAABB', 'AAABB'])
  world.regions[0].center = 10
  world.regions[1].center = 14
  for (let r = 0; r < 4; r++) {
    world.cells[r * 5 + 2].terrain = 'mountains'
    world.cells[r * 5 + 2].elevation = 1.2
  }
  let profile = corridorProfile(world)
  world.corridors = profile.segments
    .filter(
      (segment) =>
        world.cells[segment.a].terrain === 'mountains' || world.cells[segment.b].terrain === 'mountains',
    )
    .map(({ a, b }) => ({ a, b, familiarity: 1, traffic: 0 }))
  profile = corridorProfile(world)
  refreshTransport(world, profile)
  const path = transportNetwork(world).links[0].legs[0].cells
  assert(path.includes(22), 'uses the low pass despite a reinforced ridge')
  assert(!path.some((id) => world.cells[id].terrain === 'mountains'))
  const index = profile.index(10, 11),
    { a, b } = profile.segments[index]
  world.corridors = [{ a, b, familiarity: 0.8, traffic: 0 }]
  const familiar = corridorProfile(world)
  assert(familiar.cost[index] < familiar.baseCost[index])
  world.corridors[0].traffic = familiar.capacity[index] * 2
  const congested = corridorProfile(world)
  assert(congested.cost[index] > congested.baseCost[index])
  assert(congested.cost.every((cost) => cost > 0 && Number.isFinite(cost)))
})

test('only completed freight reinforces a route; detours and loops earn less and inactivity evaporates', () => {
  const direct = corridorWorld(['AAAAA', 'AAAAA', 'AAAAA']),
    detour = structuredClone(direct),
    profile = corridorProfile(direct),
    route = completedFreight({ from: 0, to: 0, legs: [{ mode: 'land', cells: [0, 1, 2, 3, 4] }] }, 20)
  direct.routes = [route]
  detour.routes = [{ ...route, legs: [{ mode: 'land', cells: [0, 1, 2, 1, 2, 3, 4] }] }]
  learnCorridors(direct, profile)
  learnCorridors(detour, corridorProfile(detour))
  const short = direct.corridors!.find((trace) => trace.a === 1 && trace.b === 2)!,
    loop = detour.corridors!.find((trace) => trace.a === 1 && trace.b === 2)!
  assert(loop.familiarity < short.familiarity, 'a repeated edge does not earn extra reinforcement')
  assert.equal(loop.traffic, short.traffic * 3, 'all traversals still count as load')
  direct.routes = []
  const level = short.familiarity
  for (let i = 0; i < 28; i++) learnCorridors(direct, corridorProfile(direct))
  assert(direct.corridors![0].familiarity < level / 2)
  for (let i = 0; i < 300; i++) learnCorridors(direct, corridorProfile(direct))
  assert.equal(direct.corridors!.length, 0)
})

test('different province connections and opposing cargo share the same tile capacity', () => {
  const world = corridorWorld(['AAABBBBBBBBBBB', 'AAABBBBBBBBBBB', 'CCCBBBBBBBBBBB'])
  world.regions[1].center = 13
  world.regions[0].population.adults = 100000
  // Household coal maintenance is a fraction of raw industrial demand; keep this buyer large enough to saturate the trunk.
  world.regions[1].population.adults = 4000000
  for (const region of world.regions)
    for (const good of GOODS) region.stocks[good] = reserveTarget(region, good)
  world.regions[0].stocks.coal += 1000
  world.regions[2].stocks.coal += 1000000
  world.regions[1].stocks.coal = 0
  world.regions[1].stocks.timber += reserveTarget(world.regions[1], 'timber') * 0.2
  world.regions[0].stocks.timber -= 500
  const profile = corridorProfile(world),
    stocks = GOODS.map((good) => world.regions.reduce((sum, region) => sum + region.stocks[good], 0))
  trade(world)
  const loads = new Float64Array(profile.segments.length),
    connections = new Map<number, Set<string>>()
  for (const route of world.routes) {
    for (const [index, count] of corridorUsage(profile, route.legs!)) {
      loads[index] += route.volume * count
      assert(loads[index] <= profile.capacity[index] + 1e-6, 'physical capacity conserved')
      if (!connections.has(index)) connections.set(index, new Set())
      connections.get(index)!.add(`${route.from}-${route.to}`)
    }
  }
  assert(
    [...connections.values()].some((pairs) => pairs.size > 1),
    'fixture contains overlapping connections',
  )
  assert(
    world.routes.some((route) => route.from === 1 && route.to === 0),
    'opposing freight actually ships',
  )
  assert(world.routes.some((route) => route.from === 0 && route.to === 1))
  assert(world.routes.some((route) => route.from === 2 && route.to === 1))
  assert(
    loads.some((load, index) => Math.abs(load - profile.capacity[index]) < 1e-6),
    'shared trunk reaches capacity',
  )
  GOODS.forEach((good, i) =>
    assert(Math.abs(world.regions.reduce((sum, region) => sum + region.stocks[good], 0) - stocks[i]) < 1e-6),
  )
  assert(world.corridors!.length > 0)
  // Remembered trade alone cannot keep a corridor alive.
  for (const region of world.regions)
    for (const good of GOODS) region.stocks[good] = reserveTarget(region, good)
  const prior = world.corridors![0].familiarity
  world.month++
  trade(world)
  assert.equal(world.routes.length, 0)
  assert(world.corridors![0].familiarity < prior)
})

test('physical corridor plans and learning survive a save across a quarterly replan; old saves upgrade', () => {
  const world = generateWorld('Corridor continuation')
  for (let i = 0; i < 7; i++) tick(world)
  validateWorld(world)
  const restored = parseSave(JSON.stringify(world))
  for (let i = 0; i < 6; i++) tick(world)
  for (let i = 0; i < 6; i++) tick(restored)
  assert.deepEqual(restored, world)
  const legacy = structuredClone(world)
  delete legacy.corridors
  delete legacy.corridorPlan
  validateWorld(legacy)
  tick(legacy)
  assert(legacy.corridors!.length > 0)
  assert(legacy.corridorPlan!.links.length > 0)
  for (const mutate of [
    (w: World) => {
      w.corridors![0].familiarity = 1.01
    },
    (w: World) => {
      w.corridors![0].traffic = -1
    },
    (w: World) => {
      w.corridors![0].b = w.corridors![0].a
    },
    (w: World) => {
      w.corridors!.push(w.corridors![0])
    },
    (w: World) => {
      w.corridorPlan!.month = w.month + 1
    },
    (w: World) => {
      w.corridorPlan!.links.push(w.corridorPlan!.links[0])
    },
    (w: World) => {
      w.corridorPlan!.links[0].legs[0].cells[1] = w.corridorPlan!.links[0].legs[0].cells[0]
    },
  ]) {
    const bad = structuredClone(world)
    mutate(bad)
    assert.throws(() => validateWorld(bad), /corridor|freight/)
  }
})
