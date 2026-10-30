import { campaignReadiness } from '../src/sim/campaign-ai'
import { intelligenceService } from '../src/sim/intelligence'
import { commissionQuote } from '../src/sim/navy'
import { availableTransport } from '../src/sim/maritime-routing'
import { advanceArmies } from '../src/sim/military'
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { applyCommand } from '../src/sim/engine'
import { orderArmyJourney, advanceArmyJourneys } from '../src/sim/army-journeys'
import { advanceNavy, commissionFleet, waterPath, portAt } from '../src/sim/navy'
import { transportNetwork } from '../src/sim/transport'
import { landComponents } from '../src/sim/land-connectivity'
import { relation } from '../src/sim/types'
import { rebaseEndowments } from './fixtures/endowment'
import { validateWarfare } from '../src/sim/military-persistence'

function fixture() {
  const w = generateWorld('Maritime journeys', 5, 8, undefined, 'regional', 'settled')
  for (const n of w.nations) {
    n.ai = false
    n.treasury = 100000
  }
  for (const r of w.regions)
    r.stocks.food = r.stocks.timber = r.stocks.iron = r.stocks.tools = r.stocks.arms = 100000
  for (const r of w.relations) r.treaty = 'alliance'
  const land = landComponents(w),
    ports = transportNetwork(w).harbors
  let pair: { a: (typeof ports)[number]; b: (typeof ports)[number] } | undefined
  search: for (const a of ports)
    for (const b of ports)
      if (
        land[w.regions[a.region].center] !== land[w.regions[b.region].center] &&
        waterPath(w, a.water, b.water).length
      ) {
        pair = { a, b }
        break search
      }
  assert(pair, 'fixture needs two islands on one ocean')
  const army = w.armies.find((a) => a.nation === w.regions[pair.a.region].nation)!
  army.region = pair.a.region
  army.operations!.food = army.soldiers * 0.034 * 4
  commissionFleet(w, army.nation, pair.a.region, 0, Math.max(1, Math.ceil(army.soldiers / 800)))
  const fleet = availableTransport(w, army.nation, pair.a.region, army.soldiers)!
  w.warfare!.fleets = [fleet]
  fleet.food = fleet.soldiers * 0.034 * 20
  rebaseEndowments(w)
  return { w, army, fleet, departure: pair.a.region, destination: pair.b.region }
}

test('one destination order embarks, sails and lands without manual fleet orders', () => {
  const { w, army, fleet, destination } = fixture()
  assert.match(orderArmyJourney(w, army, destination), /Sea journey/)
  assert.equal(army.operations!.journey!.fleet, fleet.id)
  for (let i = 0; i < 20 && army.region !== destination; i++) {
    w.month++
    advanceArmyJourneys(w)
    advanceNavy(w)
    advanceArmies(w)
  }
  assert.equal(army.region, destination)
  assert.equal(army.operations!.embarkedOn, null)
  advanceArmyJourneys(w)
  assert.equal(army.operations!.journey, undefined)
})

test('fleet reservation prevents two independent journeys booking the same berths', () => {
  const { w, army, fleet, destination, departure } = fixture()
  w.warfare!.fleets = [fleet]
  orderArmyJourney(w, army, destination)
  const other = {
    ...army,
    id: w.nextArmy++,
    operations: { ...army.operations!, journey: undefined },
    region: departure,
  }
  w.armies.push(other)
  orderArmyJourney(w, other, destination)
  assert.equal(other.operations!.journey!.fleet, null)
  assert.match(other.operations!.journey!.obstacle, /Waiting/)
  applyCommand(w, { type: 'army-orders', army: army.id, stance: 'hold', conduct: 'restrained' })
  advanceArmyJourneys(w)
  assert.equal(other.operations!.journey!.fleet, fleet.id)
})

test('revoked landing rights pause an unembarked journey and invalid save references fail', () => {
  const { w, army, destination, fleet } = fixture()
  orderArmyJourney(w, army, destination)
  const owner = w.regions[destination].nation
  if (owner !== army.nation) {
    relation(w, army.nation, owner)!.treaty = 'neutral'
    advanceArmyJourneys(w)
    assert.match(army.operations!.journey!.obstacle, /access/)
    assert.equal(army.operations!.embarkedOn, null)
  }
  army.operations!.journey!.fleet = 999999
  assert.throws(() => validateWarfare(w, () => {}), /journey/)
  assert.equal(fleet.embarked.length, 0)
})

test('a hungry fleet leaves an empty harbor for a port with usable food', () => {
  const { w, fleet, departure } = fixture()
  w.regions[departure].stocks.food = 0
  w.warfare!.fleets = [fleet]
  fleet.food = 0
  fleet.mission = 'return'
  fleet.target = departure
  fleet.course = []
  advanceNavy(w)
  assert.notEqual(fleet.target, departure)
  assert(fleet.course.length > 0)
  assert(w.regions[fleet.target!].stocks.food > 0)
})

test('shipbuilding quotes match execution and reject an occupied shipyard', () => {
  const { w, army, departure } = fixture(),
    n = w.nations[army.nation]
  const q = commissionQuote(w, n.id, departure, 1, 2),
    before = n.treasury
  commissionFleet(w, n.id, departure, q.warships, q.transports)
  assert(Math.abs(n.treasury - (before - q.cost)) < 1e-8)
  assert.equal(w.warfare!.fleets.at(-1)!.soldiers, q.crew)
  w.regions[departure].control = { nation: (n.id + 1) % w.nations.length, since: w.month } as never
  assert.throws(() => commissionQuote(w, n.id, departure, 0, 1), /owned coastal port/)
})

test('a reserved passenger carrier cannot be commandeered and lost reservations clear', () => {
  const { w, army, fleet, destination, departure } = fixture()
  orderArmyJourney(w, army, destination)
  assert.throws(
    () => applyCommand(w, { type: 'fleet-order', fleet: fleet.id, target: departure, mission: 'escort' }),
    /reserved/,
  )
  fleet.warships = fleet.transports = 0
  advanceNavy(w)
  assert.equal(army.operations!.journey!.fleet, null)
  assert.match(army.operations!.journey!.obstacle, /lost/)
})

test('overseas campaign readiness requires whole formations and supplied physical carriers', () => {
  const { w, army, fleet, departure, destination } = fixture(),
    nation = w.nations[army.nation]
  const rival = (nation.id + 1) % w.nations.length
  w.regions[destination].nation = rival
  for (const r of w.regions)
    if (r.nation === nation.id) r.neighbors = r.neighbors.filter((id) => w.regions[id].nation !== rival)
  intelligenceService(w, nation.id).chart = w.regions.map((r) => ({
    id: r.id,
    name: r.name,
    nation: r.nation,
    neighbors: r.neighbors,
    coastal: r.coastal,
    terrain: r.terrain,
    month: w.month,
  }))
  w.armies = [army]
  fleet.cell = portAt(w, departure)!.water
  army.supply = army.morale = 1
  const ready = campaignReadiness(w, nation, rival)
  assert(ready.border.some((r) => r.id === departure))
  assert(ready.deployed > 0)
  fleet.food = 0
  assert.equal(campaignReadiness(w, nation, rival).deployed, 0)
  fleet.food = 100
  fleet.transports = fleet.warships = 0
  assert.equal(campaignReadiness(w, nation, rival).deployed, 0)
})
