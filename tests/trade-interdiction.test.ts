/** Blockades and sacking are physical operations, with conserved cargo and bounded reach. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand } from '../src/sim/commands'
import { generateWorld } from '../src/sim/generate'
import { ensureWarfare, friendlyPort, orderFleet } from '../src/sim/navy'
import { fleetReach, portBlockadeView, seaPassageView } from '../src/sim/naval-control'
import { transportNetwork } from '../src/sim/transport'
import { tradeRaidView } from '../src/sim/trade-raids'
import { physicalStocks, auditGoods } from '../src/sim/goods-accounting'
import { beginEconomyMonth } from '../src/sim/macroeconomy'
import { auditNationalAccounts } from '../src/sim/national-accounts'
import { restoreWorld, validateWorld } from '../src/sim/persistence'
import { ensureDistrictEconomy } from '../src/sim/districts'
import { arriveFreight } from '../src/sim/freight-transit'
import { setBorderPolicy } from '../src/sim/border-policy'
import { inventory, relation, type RouteLeg } from '../src/sim/types'
import { rebaseEndowments } from './fixtures/endowment'

function navalWorld() {
  const w = generateWorld('naval interdiction', 3, 4),
    network = transportNetwork(w)
  ensureWarfare(w)
  ensureDistrictEconomy(w)
  for (const f of w.warfare!.fleets) f.supply = 0
  const home = network.harbors[0],
    target = network.harbors.find((p) => w.regions[p.region].nation !== w.regions[home.region].nation)!
  assert(target)
  const nation = w.regions[home.region].nation,
    enemy = w.regions[target.region].nation,
    neutral = w.nations.find((n) => n.id !== nation && n.id !== enemy)!.id
  for (const rel of w.relations) rel.treaty = 'neutral'
  relation(w, nation, enemy)!.treaty = 'war'
  w.nations[nation].treasury = 100000
  for (const good of ['timber', 'iron', 'arms', 'tools', 'food'] as const)
    w.regions[home.region].stocks[good] = 100000
  rebaseEndowments(w)
  applyCommand(w, { type: 'commission', nation, region: home.region, warships: 4, transports: 1 })
  const fleet = w.warfare!.fleets.at(-1)!
  fleet.cell = target.water
  fleet.region = target.region
  fleet.target = target.region
  fleet.food = 1000
  fleet.arms = 100
  fleet.morale = fleet.supply = fleet.hull = 1
  fleet.mission = 'blockade'
  const legs: RouteLeg[] = [{ mode: 'sea', cells: [target.land, target.water] }]
  return { w, home, target, nation, enemy, neutral, fleet, legs }
}

test('a supplied port blockade closes neutral trade and military entry, while remote or starved fleets cannot', () => {
  const { w, target, neutral, fleet, legs } = navalWorld()
  setBorderPolicy(w, w.regions[target.region].nation, neutral, { trade: 'normal', military: 'basing' })
  assert.equal(portBlockadeView(w)(neutral, target.region), 0)
  assert.equal(seaPassageView(w)(neutral, legs), 0)
  assert(!friendlyPort(w, neutral, target.region))
  fleet.supply = 0
  w.warfare!.revision++
  assert.equal(seaPassageView(w)(neutral, legs), 1)
  fleet.supply = 1
  const reachable = fleetReach(w, fleet)
  fleet.cell = w.cells.find((c) => c.terrain === 'water' && !reachable.has(c.id))!.id
  w.warfare!.revision++
  assert.equal(portBlockadeView(w)(neutral, target.region), 1)
})

test('peace cancels a port cordon immediately and transport-only ships cannot be ordered to blockade or raid', () => {
  const { w, nation, enemy, neutral, fleet, target } = navalWorld()
  relation(w, nation, enemy)!.treaty = 'truce'
  assert.equal(portBlockadeView(w)(neutral, target.region), 1)
  assert.throws(() => orderFleet(w, fleet.id, target.region, 'raid'), /requires war/)
  relation(w, nation, enemy)!.treaty = 'war'
  fleet.warships = 0
  assert.throws(() => orderFleet(w, fleet.id, target.region, 'blockade'), /warships/)
  assert.throws(() => orderFleet(w, fleet.id, target.region, 'raid'), /warships/)
})

test('land sacking conserves captured provisions, records destruction, and cannot exceed a formation budget', () => {
  const w = generateWorld('land convoy sacking', 3, 4)
  ensureWarfare(w)
  const a = w.armies[0],
    buyer = w.regions.find((r) => r.nation !== a.nation)!
  const seller = w.regions.find((r) => r.nation === buyer.nation && r.id !== buyer.id)!
  relation(w, a.nation, buyer.nation)!.treaty = 'war'
  for (const guard of w.armies) if (guard.nation !== a.nation) guard.region = seller.id
  a.region = buyer.id
  a.supply = a.morale = a.operations!.cohesion = 1
  a.operations!.conduct = 'raid'
  a.operations!.fatigue = a.operations!.food = a.operations!.arms = 0
  buyer.stocks.food = buyer.stocks.coal = 10000
  rebaseEndowments(w)
  beginEconomyMonth(w)
  const legs: RouteLeg[] = [{ mode: 'land', cells: [buyer.center] }],
    before = physicalStocks(w),
    raid = tradeRaidView(w)
  const arrived = raid(seller.id, buyer.id, 'food', 1000, legs)
  assert(arrived < 1000)
  assert(a.operations!.food > 0)
  for (let i = 0; i < 10; i++) tradeRaidView(w)(seller.id, buyer.id, 'coal', 1000, legs)
  const taken = w.warfare!.raids!.reduce((sum, r) => sum + r.captured + r.destroyed, 0)
  assert(taken <= a.soldiers * 0.03 + 1e-8)
  const after = physicalStocks(w)
  for (const good of ['food', 'coal'] as const)
    assert(Math.abs(before[good] - after[good] - w.economy!.goods!.destruction[good]) < 1e-7)
  auditGoods(w)
  auditNationalAccounts(w)
  relation(w, a.nation, buyer.nation)!.treaty = 'neutral'
  assert.equal(tradeRaidView(w)(seller.id, buyer.id, 'food', 100, legs), 100)
})

test('naval raids spare neutral-only cargo and an escort can protect hostile shipping', () => {
  const { w, fleet, target, enemy, neutral, legs } = navalWorld()
  fleet.mission = 'raid'
  w.warfare!.revision++
  assert(
    seaPassageView(w)(enemy, legs) > 0,
    'raiders leave traffic to intercept rather than closing the lane',
  )
  const buyer = w.regions[target.region],
    source = w.regions.find((r) => r.nation === enemy && r.id !== buyer.id)!,
    neutralPorts = w.regions.filter((r) => r.nation === neutral)
  buyer.stocks.food = 10000
  const escort = {
    ...fleet,
    id: w.nextArmy++,
    nation: enemy,
    mission: 'escort' as const,
    warships: 12,
    soldiers: 1200,
    supply: 0,
    food: 0,
  }
  w.warfare!.fleets.push(escort)
  rebaseEndowments(w)
  beginEconomyMonth(w)
  assert.equal(tradeRaidView(w)(neutralPorts[0].id, neutralPorts[1].id, 'food', 100, legs), 100)
  assert(tradeRaidView(w)(source.id, buyer.id, 'food', 100, legs) < 100)
  escort.supply = 1
  w.warfare!.revision++
  assert.equal(tradeRaidView(w)(source.id, buyer.id, 'food', 100, legs), 100)
  auditGoods(w)
})

test('a closed route retains paid in-flight cargo and delivers exactly once after reopening', () => {
  const { w, fleet, home, target, neutral, legs } = navalWorld()
  ensureDistrictEconomy(w)
  const from = home.region,
    to = target.region
  w.localEconomy!.units[from].nation = neutral
  const cargo = {
    id: 0,
    from,
    to,
    owner: `producer:${to}`,
    dispatched: 0,
    arrives: w.month,
    goods: { ...inventory(), food: 25 },
    legs,
  }
  w.adaptive = { ...w.adaptive, transit: [cargo], nextTransit: 1 } as NonNullable<typeof w.adaptive>
  beginEconomyMonth(w)
  const initial = w.localEconomy!.units[to].stocks.food
  arriveFreight(w)
  assert.equal(cargo.goods.food, 25)
  assert.equal(w.localEconomy!.units[to].stocks.food, initial)
  fleet.mission = 'return'
  fleet.cell = home.water
  w.warfare!.revision++
  arriveFreight(w)
  assert.equal(cargo.goods.food, 0)
  assert.equal(w.localEconomy!.units[to].stocks.food, initial + 25)
  arriveFreight(w)
  assert.equal(w.localEconomy!.units[to].stocks.food, initial + 25)
  auditGoods(w)
})

test('raid missions and temporary deployment records round-trip and reject malformed quantities', () => {
  const { w, fleet, target } = navalWorld()
  orderFleet(w, fleet.id, target.region, 'raid')
  fleet.foreignStay = { host: w.regions[target.region].nation, months: 2 }
  const restored = restoreWorld(JSON.parse(JSON.stringify(w)))
  assert.equal(restored.warfare!.fleets.at(-1)!.mission, 'raid')
  assert.deepEqual(restored.warfare!.fleets.at(-1)!.foreignStay, fleet.foreignStay)
  restored.warfare!.fleets.at(-1)!.foreignStay!.months = -1
  assert.throws(() => validateWorld(restored), /fleet/)
})
