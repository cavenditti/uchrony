import { withSimulationPeriod } from '../src/sim/simulation-period'
import { claimIndependentProvince } from '../src/sim/territorial-expansion'
import { transferSovereignty } from '../src/sim/military-control'
import {
  ensureStatecraft,
  submitStandingOffer,
  admitDiplomaticConsent,
  settleConventionalOffers,
} from '../src/sim/statecraft'
import { diplomaticAccess } from '../src/sim/agreements'
import { advanceFounding, foundingOptions } from '../src/sim/founding'
import { populationIdentitySummary } from '../src/sim/identities'
import { statecraftAffordances } from '../src/sim/statecraft-affordances'
import { transferStateTerritory, settleStateEstate } from '../src/sim/state-succession'
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { prepareSpatialWorld, summarize, tick, advanceCoarsePeriod } from '../src/sim/engine'
import {
  prepareOverseasExpeditions,
  advanceOverseasExpeditions,
  overseasOptions,
  startOverseasExpedition,
  cancelOverseasExpedition,
  settlementPermission,
} from '../src/sim/overseas'
import { advanceNavy, commissionFleet, cargoCapacity } from '../src/sim/navy'
import { transportNetwork } from '../src/sim/transport'
import { aggregateDistricts } from '../src/sim/districts'
import { intelligenceService } from '../src/sim/intelligence'
import { physicalStocks } from '../src/sim/goods-accounting'
import { balances, auditLedger } from '../src/sim/ledger'
import { rebaseEndowments } from './fixtures/endowment'
import { population, GOODS } from '../src/sim/types'
import { validateWorld, restoreWorld } from '../src/sim/persistence'
import { packWorldSave } from '../src/sim/save-codec'
import { activeExpedition, expeditionMigration } from '../src/sim/overseas-types'
import { syncResidentialPopulation } from '../src/sim/residential-sites'
import { refreshSpatial } from '../src/sim/spatial'
import { refreshPlaces } from '../src/sim/places'
import { refreshAdaptiveTotals } from '../src/sim/adaptive-world'
import { viewSnapshot } from '../src/sim/view-snapshot'
const total = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0)
const near = (a: number, b: number) => assert(Math.abs(a - b) < 1e-6, `${a} != ${b}`)

function reconcile(w: ReturnType<typeof generateWorld>) {
  syncResidentialPopulation(w)
  refreshPlaces(w)
  aggregateDistricts(w)
  refreshAdaptiveTotals(w)
  refreshSpatial(w)
  summarize(w, false)
}

function fixture() {
  const w = generateWorld('Overseas families', 5, 8, undefined, 'regional', 'frontier')
  prepareSpatialWorld(w)
  for (const n of w.nations) {
    n.ai = false
    n.treasury = 100000
    intelligenceService(w, n.id).chart = w.regions.map((r) => ({
      id: r.id,
      name: r.name,
      nation: r.nation,
      neighbors: r.neighbors,
      coastal: r.coastal,
      terrain: r.terrain,
      month: w.month,
    }))
  }
  for (const id of w.localEconomy!.active) {
    const u = w.localEconomy!.units[id]
    if (u.nation >= 0) for (const g of GOODS) u.stocks[g] = 100000
  }
  aggregateDistricts(w)
  rebaseEndowments(w)
  for (const h of transportNetwork(w).harbors) {
    const r = w.regions[h.region]
    if (r.nation < 0 || population(r) < 1000) continue
    commissionFleet(w, r.nation, r.id, 0, 2)
  }
  aggregateDistricts(w)
  reconcile(w)
  for (const n of w.nations) {
    const q = overseasOptions(w, n.id, 1)[0]
    if (q) {
      rebaseEndowments(w)
      return { w, nation: n.id, q }
    }
  }
  throw new Error('Fixture has no eligible overseas coast')
}

test('funded expedition preserves people, cash and cargo in transit and creates only a foothold', () => {
  const { w, nation, q } = fixture(),
    people = w.totals.population,
    money = total(balances(w)),
    goods = physicalStocks(w)
  startOverseasExpedition(w, nation, q.cell)
  const e = w.overseas!.expeditions[0]
  assert.equal(e.people, 0)
  near(total(balances(w)), money)
  prepareOverseasExpeditions(w)
  assert.equal(e.stage, 'sailing')
  assert.equal(e.people, q.people)
  assert.equal(expeditionMigration(w), q.people)
  summarize(w, false)
  assert.equal(w.totals.population, people)
  for (const g of GOODS) near(physicalStocks(w)[g], goods[g])
  near(total(balances(w)), money)
  reconcile(w)
  validateWorld(w)
  const restored = restoreWorld(packWorldSave(w))
  assert.deepEqual(restored.overseas, w.overseas)
  assert.equal(viewSnapshot(w).overseas!.expeditions[0].communities, undefined)
  for (let i = 0; i < 20 && activeExpedition(e); i++) {
    w.month++
    advanceNavy(w)
    advanceOverseasExpeditions(w)
  }
  assert.equal(e.stage, 'settled', e.obstacle)
  assert.equal(w.regions[q.province].nation, -1)
  assert.equal(w.overseas!.footholds.length, 1)
  assert.equal(e.people, 0)
  summarize(w, false)
  assert.equal(w.totals.population + w.totals.deaths, people)
  near(total(balances(w)), money)
  auditLedger(w)
  reconcile(w)
  validateWorld(w)
})

test('cancellation before embarkation restores all funding without moving families', () => {
  const { w, nation, q } = fixture(),
    money = w.nations[nation].treasury,
    people = w.totals.population
  startOverseasExpedition(w, nation, q.cell)
  cancelOverseasExpedition(w, nation, w.overseas!.expeditions[0].id)
  near(w.nations[nation].treasury, money)
  assert.equal(w.totals.population, people)
  assert.equal(w.overseas!.expeditions[0].stage, 'returned')
  reconcile(w)
  validateWorld(w)
})

test('sinking records passenger deaths and cargo loss exactly once, preserving household property', () => {
  const { w, nation, q } = fixture()
  startOverseasExpedition(w, nation, q.cell)
  prepareOverseasExpeditions(w)
  const e = w.overseas!.expeditions[0],
    money = total(balances(w)),
    people = e.people
  w.warfare!.fleets = w.warfare!.fleets.filter((f) => f.id !== e.fleet)
  w.month++
  advanceOverseasExpeditions(w)
  assert.equal(e.stage, 'lost')
  assert.equal(e.people, 0)
  assert.equal(w.totals.deaths, people)
  near(total(balances(w)), money)
  assert(GOODS.every((g) => e.goods[g] === 0))
  advanceOverseasExpeditions(w)
  assert.equal(w.totals.deaths, people)
  const malformed = structuredClone(w)
  malformed.overseas!.expeditions[0].goods.food = -1
  assert.throws(() => validateWorld(malformed), /overseas/)
})

test('trade or military transit alone never grants settlement rights in a foreign state', () => {
  const { w, nation, q } = fixture(),
    r = w.regions.find((r) => r.nation >= 0 && r.nation !== nation)!
  assert.equal(settlementPermission(w, nation, r.id), false)
  w.regions[q.departure].control = { nation: r.nation } as never
  assert.equal(settlementPermission(w, nation, q.departure), false)
})

test('a recalled sailing expedition returns physically and releases its carrier', () => {
  const { w, nation, q } = fixture()
  startOverseasExpedition(w, nation, q.cell)
  prepareOverseasExpeditions(w)
  const e = w.overseas!.expeditions[0],
    fleet = w.warfare!.fleets.find((f) => f.id === e.fleet)!
  w.month++
  advanceNavy(w)
  advanceOverseasExpeditions(w)
  assert.equal(e.stage, 'sailing')
  const passengers = e.people
  cancelOverseasExpedition(w, nation, e.id)
  assert.equal(e.people, passengers)
  assert.equal(e.stage, 'returning')
  for (let i = 0; i < 25 && activeExpedition(e); i++) {
    w.month++
    advanceNavy(w)
    advanceOverseasExpeditions(w)
  }
  assert.equal(e.stage, 'returned', e.obstacle)
  assert.equal(expeditionMigration(w), -e.arrived!.people)
  assert.equal(e.fleet, null)
  assert.equal(fleet.mission, 'escort')
  assert.equal(w.overseas!.footholds.length, 0)
  reconcile(w)
  validateWorld(w)
})

test('the ordinary monthly engine keeps a sailing census and save valid', () => {
  const { w, nation, q } = fixture()
  const offers = statecraftAffordances(w, nation)
  assert(offers.canSettleOverseas.some((o) => o.cell === q.cell))
  assert(offers.canCommissionIn.length)
  const view = viewSnapshot(w, nation)
  assert.equal(view.viewOverseas?.nation, nation)
  assert.deepEqual(view.viewOverseas?.options, offers.canSettleOverseas)
  assert.equal(viewSnapshot(w, null).viewOverseas, undefined)
  startOverseasExpedition(w, nation, q.cell)
  prepareOverseasExpeditions(w)
  tick(w)
  const e = w.overseas!.expeditions[0]
  assert.equal(e.stage, 'sailing', e.obstacle)
  assert(e.people > 0)
  assert.equal(populationIdentitySummary(w, nation).people, w.nations[nation].population)
  validateWorld(w)
  assert.equal(restoreWorld(packWorldSave(w)).overseas!.expeditions[0].people, e.people)
  auditLedger(w)
})

test('succession preserves civilian passengers and their actual carrier', () => {
  const { w, nation, q } = fixture(),
    successor = (nation + 1) % w.nations.length
  startOverseasExpedition(w, nation, q.cell)
  prepareOverseasExpeditions(w)
  const e = w.overseas!.expeditions[0],
    passengers = e.people,
    fleet = e.fleet
  transferStateTerritory(w, nation, successor, false)
  settleStateEstate(w, nation, successor, 'demobilize')
  assert.equal(e.nation, successor)
  assert.equal(e.people, passengers)
  assert(w.warfare!.fleets.some((f) => f.id === fleet && f.nation === successor))
})

test('settlement grants require host consent and remain separate from army access', () => {
  const { w, nation } = fixture(),
    host = (nation + 1) % w.nations.length
  ensureStatecraft(w)
  const region = w.regions.find((r) => r.nation === host)!
  w.nations[host].policies.migration = 'open'
  const offer = submitStandingOffer(
    w,
    host,
    {
      title: 'Civilian settlement permission',
      parties: [host, nation],
      visibility: 'public',
      duration: 24,
      supersedes: 0,
      terms: [
        {
          kind: 'settlement',
          from: host,
          to: nation,
          regions: [region.id],
          amount: 0,
          good: '',
          field: '',
          duration: 24,
          text: 'Civilian families may establish homes.',
        },
      ],
    },
    true,
  )
  assert.equal(settlementPermission(w, nation, region.id), false)
  for (const party of offer.parties) admitDiplomaticConsent(w, party, offer)
  w.month = Math.max(w.month, offer.notBefore ?? w.month)
  settleConventionalOffers(w)
  assert.equal(offer.status, 'ratified', offer.ruling)
  assert.equal(settlementPermission(w, nation, region.id), true)
  assert.equal(diplomaticAccess(w, nation, host, 'transit', region.id), false)
  w.nations[host].policies.migration = 'closed'
  assert.equal(settlementPermission(w, nation, region.id), false)
})

test('native maritime expansion buys a real carrier when land expansion is unavailable', () => {
  const { w, nation } = fixture(),
    n = w.nations[nation]
  w.warfare!.fleets = []
  n.ai = true
  n.foodCoverage = 1
  n.stability = 80
  const treasury = n.treasury
  const owned = new Set(w.regions.filter((r) => r.nation === nation).map((r) => r.id))
  for (const r of w.regions)
    if (r.nation === -1 && r.neighbors.some((id) => owned.has(id))) r.nation = (nation + 1) % w.nations.length
  delete n.cabinet
  assert.equal(foundingOptions(w, nation).length, 0)
  for (let i = 0; i < 12 && !w.warfare!.fleets.length; i++) {
    w.month++
    advanceFounding(w)
  }
  assert(w.warfare!.fleets.some((f) => f.nation === nation && f.transports === 2))
  assert.equal(n.treasury, treasury - 700)
})

test('damaged holds lose real cargo rather than allowing an overloaded landing', () => {
  const { w, nation, q } = fixture()
  startOverseasExpedition(w, nation, q.cell)
  prepareOverseasExpeditions(w)
  const e = w.overseas!.expeditions[0],
    f = w.warfare!.fleets.find((f) => f.id === e.fleet)!
  const before = GOODS.reduce((sum, g) => sum + e.goods[g], 0)
  f.hull = 0.08
  w.month++
  advanceOverseasExpeditions(w)
  const after = GOODS.reduce((sum, g) => sum + e.goods[g], 0)
  assert(after < before)
  assert(after <= cargoCapacity(f, e.people) + 1e-7)
  assert(GOODS.every((g) => e.goods[g] >= 0))
})

test('coarse advancement retains monthly passenger phases and migration accounting', () => {
  const { w, nation, q } = fixture()
  startOverseasExpedition(w, nation, q.cell)
  prepareOverseasExpeditions(w)
  const e = w.overseas!.expeditions[0],
    start = w.month
  for (const invalid of [0, 7, NaN])
    assert.throws(() => advanceCoarsePeriod(w, invalid), /Invalid simulation interval/)
  withSimulationPeriod(6, () => advanceCoarsePeriod(w, 2))
  assert.equal(w.month, start + 2)
  assert.equal(e.updated, w.month)
  assert.equal(w.economy!.periodMonths ?? 1, 1)
  assert(Math.abs(w.regions.reduce((sum, r) => sum + r.migration, 0) + expeditionMigration(w)) < 1e-7)
  validateWorld(w)
})

test('recall finds another real home port if the departure province changes hands', () => {
  const { w, nation, q } = fixture()
  startOverseasExpedition(w, nation, q.cell)
  prepareOverseasExpeditions(w)
  // The government loses its port after the provisioned carrier has sailed.
  w.month++
  advanceNavy(w)
  advanceOverseasExpeditions(w)
  const e = w.overseas!.expeditions[0],
    people = e.people
  claimIndependentProvince(w, w.regions[q.province], nation, true)
  transferSovereignty(w, q.departure, (nation + 1) % w.nations.length)
  cancelOverseasExpedition(w, nation, e.id)
  assert.equal(e.returnPort, q.province)
  assert.equal(e.people, people, 'a changed return order must not teleport the households')
  for (let i = 0; i < 25 && activeExpedition(e); i++) {
    w.month++
    advanceNavy(w)
    advanceOverseasExpeditions(w)
  }
  assert.equal(e.stage, 'returned', e.obstacle)
  assert.equal(w.overseas!.footholds.length, 0)
  reconcile(w)
  validateWorld(w)
})
