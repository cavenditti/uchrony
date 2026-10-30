import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import {
  trade,
  reserveTarget,
  shortestPaths,
  pathTo,
  transportGraph,
  BASE_PRICE,
  type Graph,
} from '../src/sim/economy'
import { establishedPath, rememberedTrade, TRADE_INERTIA } from '../src/sim/trade-memory'
import { parseSave, validateWorld } from '../src/sim/persistence'
import { GOODS, inventory, relation, type Good, type World } from '../src/sim/types'

function fixture() {
  const world = generateWorld('Sticky suppliers'),
    buyer = world.regions[world.nations[0].capital],
    graph = transportGraph(world),
    paths = shortestPaths(graph, buyer.id),
    sellers = world.regions
      .filter((r) => r.id !== buyer.id && r.nation === buyer.nation && Number.isFinite(paths.distance[r.id]))
      .sort((a, b) => paths.distance[a.id] - paths.distance[b.id])
  const near = sellers[0],
    far = sellers.find((r) => paths.distance[r.id] > paths.distance[near.id] * 2)!
  assert(far)
  const path = (seller: number) => pathTo(paths.previous, buyer.id, seller).reverse()
  const reset = (good: Good = 'coal', need = 100, supplierIds = [near.id, far.id]) => {
    for (const r of world.regions) r.prices = { ...BASE_PRICE }
    for (const r of world.regions) for (const g of GOODS) r.stocks[g] = reserveTarget(r, g)
    buyer.stocks[good] -= need
    for (const id of supplierIds) world.regions[id].stocks[good] += 10000
  }
  const remember = (seller = far, good: Good = 'coal') => {
    const flow = inventory()
    flow[good] = 100
    world.tradeLanes = [
      { from: seller.id, to: buyer.id, path: path(seller.id), flow, lastActive: world.month },
    ]
  }
  const shipped = (seller: number, good: Good = 'coal') =>
    world.routes.find((r) => r.from === seller && r.to === buyer.id)?.goods[good] ?? 0
  const step = () => {
    world.month++
    trade(world)
  }
  return { world, buyer, near, far, path, reset, remember, shipped, step }
}

test('a better supplier gains traffic gradually while small cost differences preserve relationships', () => {
  const f = fixture()
  f.remember()
  f.reset()
  f.step()
  assert(Math.abs(f.shipped(f.far.id) - 88) < 1e-6)
  assert(Math.abs(f.shipped(f.near.id) - 12) < 1e-6)
  f.reset()
  f.step()
  assert(Math.abs(f.shipped(f.far.id) - 77.44) < 1e-6)
  assert(Math.abs(f.shipped(f.near.id) - 22.56) < 1e-6)
  for (let i = 0; i < 28; i++) {
    f.reset()
    f.step()
  }
  assert(f.shipped(f.near.id) > 97, 'does not permanently lock in the worse supplier')

  const g = fixture(),
    paths = shortestPaths(transportGraph(g.world), g.buyer.id),
    sellers = g.world.regions
      .filter((r) => r.nation === g.buyer.nation && r.id !== g.buyer.id)
      .sort((a, b) => paths.distance[a.id] - paths.distance[b.id]),
    old = sellers.find(
      (r, i) =>
        i > 0 && paths.distance[r.id] * (1 - TRADE_INERTIA.improvement) <= paths.distance[sellers[i - 1].id],
    )!
  assert(old, 'fixture has similarly priced suppliers')
  const competitor = sellers[sellers.indexOf(old) - 1]
  g.remember(old)
  g.reset('coal', 100, [old.id, competitor.id])
  g.step()
  assert.equal(g.shipped(old.id), 100)
  assert.equal(g.shipped(competitor.id), 0)
})

test('small repeat orders and short idle periods preserve trade without fictitious shipments', () => {
  const f = fixture()
  f.remember(f.near)
  const small = reserveTarget(f.buyer, 'coal') * 0.02
  f.reset('coal', small, [f.near.id])
  f.step()
  assert(Math.abs(f.shipped(f.near.id) - small) < 1e-6, 'replenishes below the old 10% reorder gap')
  const recent = f.world.tradeLanes![0].flow.coal
  f.reset('coal', 0, [])
  f.step()
  assert.equal(f.world.routes.length, 0)
  assert.equal(f.world.tradeLanes![0].flow.coal, recent * 0.88)
  f.reset('coal', small, [f.near.id])
  f.step()
  assert(Math.abs(f.shipped(f.near.id) - small) < 1e-6)
  for (let i = 0; i <= TRADE_INERTIA.idleMonths; i++) {
    f.reset('coal', 0, [])
    f.step()
  }
  assert.equal(f.world.tradeLanes!.length, 0)
})

test('war, unavailable supply and urgent food bypass supplier inertia immediately', () => {
  for (const failure of ['war', 'supply', 'food']) {
    const f = fixture()
    if (failure === 'food') {
      f.buyer.population = { children: 100, adults: 100, elders: 100 }
      f.remember(f.far, 'food')
      f.reset('food', reserveTarget(f.buyer, 'food') - 1)
    } else {
      f.remember()
      f.reset('coal', 100, failure === 'supply' ? [f.near.id] : [f.near.id, f.far.id])
      if (failure === 'war') {
        f.far.nation = 1
        relation(f.world, 0, 1)!.treaty = 'war'
      }
    }
    f.step()
    assert.equal(f.shipped(f.far.id, failure === 'food' ? 'food' : 'coal'), 0, failure)
    assert(f.shipped(f.near.id, failure === 'food' ? 'food' : 'coal') > 0, failure)
    if (failure === 'war') assert(!f.world.tradeLanes!.some((lane) => lane.from === f.far.id))
  }
})

test('physical paths resist small cost changes but switch for major savings or a closed leg', () => {
  const edge = (to: number, cost: number) => ({ to, cost, capacity: 1000, sea: false, legs: [] }),
    graph: Graph = [[edge(1, 1.1), edge(2, 1)], [edge(3, 1.1)], [edge(3, 1)], []],
    old = [0, 1, 3],
    best = [0, 2, 3]
  assert.deepEqual(establishedPath(graph, old, best), old)
  graph[0][0].cost = 2
  assert.deepEqual(establishedPath(graph, old, best), best)
  graph[0][0].cost = 1.1
  graph[1] = []
  assert.deepEqual(establishedPath(graph, old, best), best)
  graph[1] = [{ ...edge(3, 1.1), capacity: 0 }]
  assert.deepEqual(establishedPath(graph, old, best), best)
})

test('inertial allocation conserves stocks and treasury and respects shared capacity', () => {
  const f = fixture()
  f.buyer.population.adults = 1_000_000
  f.remember()
  f.reset('coal', reserveTarget(f.buyer, 'coal'))
  const stocks = GOODS.map((g) => f.world.regions.reduce((sum, r) => sum + r.stocks[g], 0)),
    money = f.world.nations.reduce((sum, n) => sum + n.treasury, 0),
    graph = transportGraph(f.world)
  f.step()
  GOODS.forEach((g, i) =>
    assert(Math.abs(f.world.regions.reduce((sum, r) => sum + r.stocks[g], 0) - stocks[i]) < 1e-6),
  )
  assert(Math.abs(f.world.nations.reduce((sum, n) => sum + n.treasury, 0) - money) < 1e-6)
  const used = new Map<string, number>()
  for (const route of f.world.routes)
    for (let i = 1; i < route.path.length; i++) {
      const from = route.path[i - 1],
        to = route.path[i],
        key = `${Math.min(from, to)}-${Math.max(from, to)}`
      used.set(key, (used.get(key) ?? 0) + route.volume)
      assert(used.get(key)! <= graph[from].find((edge) => edge.to === to)!.capacity + 1e-6)
    }
  assert(f.world.regions.every((r) => GOODS.every((g) => r.stocks[g] >= 0)))
})

test('trade memory survives exact save continuation, backfills old shipments, and validates untrusted data', () => {
  const f = fixture()
  f.remember()
  f.reset()
  f.step()
  validateWorld(f.world)
  const restored = parseSave(JSON.stringify(f.world))
  f.reset()
  for (const r of restored.regions) r.stocks = { ...f.world.regions[r.id].stocks }
  f.step()
  restored.month++
  trade(restored)
  assert.deepEqual(restored, f.world)
  const legacy = structuredClone(f.world)
  delete legacy.tradeLanes
  validateWorld(legacy)
  assert.equal(rememberedTrade(legacy).size, 0, 'shipment records do not recreate missing supplier memory')
  for (const mutate of [
    (w: World) => {
      w.tradeLanes![0].flow.coal = -1
    },
    (w: World) => {
      w.tradeLanes![0].lastActive = w.month + 1
    },
    (w: World) => {
      w.tradeLanes![0].path = [w.tradeLanes![0].from, 99999]
    },
    (w: World) => {
      w.tradeLanes!.push(w.tradeLanes![0])
    },
  ]) {
    const bad = structuredClone(f.world)
    mutate(bad)
    assert.throws(() => validateWorld(bad), /trade lane/)
  }
})
