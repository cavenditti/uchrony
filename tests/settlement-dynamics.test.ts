import test from 'node:test'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { ensureAdaptiveWorld, refreshAdaptiveTotals, rebuildAdaptiveMesh } from '../src/sim/adaptive-world'
import { ensureFirms } from '../src/sim/firms'
import {
  ensureResidentialSites,
  residentialSites,
  residentialPools,
  syncResidentialPopulation,
  createResidentialParcel,
  findResidentialParcel,
} from '../src/sim/residential-sites'
import { evolveCities } from '../src/sim/cities'
import { refreshSpatial } from '../src/sim/spatial'
import { settlementPlaces } from '../src/map/settlement-scenery'
import { describeCity } from '../src/map/city-layout'
import { population } from '../src/sim/types'
import { balances, auditLedger } from '../src/sim/ledger'
import { physicalStocks } from '../src/sim/goods-accounting'
import { validateWorld, restoreWorld } from '../src/sim/persistence'
import { packWorldSave } from '../src/sim/save-codec'
import { beginEconomyMonth } from '../src/sim/macroeconomy'
import { advanceLandUse } from '../src/sim/land-use'
import { rebaseEndowments } from './fixtures/endowment'
import { viewSnapshot } from '../src/sim/view-snapshot'
import { optimizeResidentialLocations, settlementAccess } from '../src/sim/settlement-access'
import { cellPosition } from '../src/sim/physical-space'
import { participatingLabor } from '../src/sim/age-cohorts'

function fixture(seed = 'Physical settlements') {
  const w = generateWorld(seed, 3, 8, undefined, 'regional')
  ensureFirms(w)
  ensureAdaptiveWorld(w)
  ensureResidentialSites(w)
  refreshAdaptiveTotals(w)
  return w
}
const holdings = (w: ReturnType<typeof fixture>) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        census: w.regions.map((r) => r.communities?.map((g) => ({ ...g, urban: undefined }))),
        money: balances(w),
        loans: w.economy!.credit.loans,
        goods: physicalStocks(w),
        firms: w.economy!.firms,
        reserves: w.localEconomy!.reserves,
        rng: w.rng,
      }),
    )
    .digest('hex')
function prepareTwinParcels() {
  const w = fixture(),
    local = w.localEconomy!
  for (const c of Object.keys(local.built)) local.built[+c] = 0
  local.cities = []
  w.spatial!.settlements = []
  const unit = local.active.map((id) => local.units[id]).find((u) => population(u) >= 5000)!
  const root = w.adaptive!.sites[`home:${unit.center}`],
    center = cellPosition(w, unit.center)
  for (const home of residentialPools(w).get(unit.id)!) home.residents = 0
  const make = (offset: number, people: number) => {
    const point = { x: center.x + offset, y: center.y }
    const site = createResidentialParcel(w, unit.id, unit.center, point, {
      x: point.x - 64,
      y: point.y - 64,
      size: 128,
    })
    site.capacity = people * 1.2
    site.investedValue = 1
    site.residents = people
    return site
  }
  const total = population(unit),
    first = make(-250, Math.floor(total / 2)),
    second = make(250, total - Math.floor(total / 2))
  syncResidentialPopulation(w)
  refreshAdaptiveTotals(w)
  return { w, unit, root, make, first, second, total }
}

test('rural spare capacity and empty parcels do not become towns or municipal catchments', () => {
  const w = fixture('Rural housing is not a town')
  for (const key of Object.keys(w.localEconomy!.built)) w.localEconomy!.built[+key] = 0
  w.localEconomy!.cities = []
  w.spatial!.settlements = []
  evolveCities(w, true)
  refreshSpatial(w)
  assert.equal(settlementPlaces(w).length, 0)
  assert.equal(w.spatial!.settlements.length, 0)
  assert(residentialSites(w).some((s) => s.capacity > 5000))
  assert(Object.values(w.adaptive!.jurisdictions).some((j) => j.level === 'municipality'))
  validateWorld(w)
})

test('two settlements can occupy one source hex; occupied infill merges identities without moving assets', () => {
  const { w, make, first, second, total } = prepareTwinParcels()
  const before = holdings(w)
  evolveCities(w, true)
  refreshSpatial(w)
  const initial = w.localEconomy!.cities.filter((c) => c.population)
  assert.equal(initial.length, 2)
  assert.equal(initial[0].nucleus, initial[1].nucleus)
  assert.notEqual(initial[0].nucleusSite, initial[1].nucleusSite)
  assert.equal(settlementPlaces(w).length, 2)
  assert.notEqual(describeCity(w, settlementPlaces(w)[0]).x, describeCity(w, settlementPlaces(w)[1]).x)
  const bridge = make(0, 0)
  bridge.capacity = 500
  refreshAdaptiveTotals(w)
  evolveCities(w, true)
  assert.equal(
    w.localEconomy!.cities.filter((c) => c.population && c.absorbedBy === undefined).length,
    2,
    'empty capacity cannot merge towns',
  )
  first.residents! -= 250
  bridge.residents = 250
  syncResidentialPopulation(w)
  evolveCities(w, true)
  refreshSpatial(w)
  const active = w.localEconomy!.cities.filter((c) => c.population && c.absorbedBy === undefined)
  assert.equal(active.length, 1)
  assert.equal(active[0].population, total)
  assert(active[0].sites!.includes(second.id) && active[0].sites!.includes(bridge.id))
  assert.equal(active[0].parents.length, 1)
  assert(active[0].aliases.length > 0)
  assert.equal(holdings(w), before)
  validateWorld(w)
})

test('numerical coarsening and refinement retain every physical parcel, occupant and capacity', () => {
  const { w } = prepareTwinParcels()
  evolveCities(w, true)
  refreshSpatial(w)
  const before = JSON.stringify(w.adaptive!.sites),
    assets = holdings(w)
  const plot = findResidentialParcel(w, residentialSites(w)[0])
  for (const mode of ['coarse', 'fine', 'adaptive', 'coarse'] as const) {
    rebuildAdaptiveMesh(w, mode)
    assert.equal(JSON.stringify(w.adaptive!.sites), before)
    assert.equal(holdings(w), assets)
    assert.deepEqual(findResidentialParcel(w, residentialSites(w)[0]), plot)
    validateWorld(w)
  }
})

test('subhex locations and settlement identities survive compressed save and compact display exactly', () => {
  const { w } = prepareTwinParcels()
  evolveCities(w, true)
  refreshSpatial(w)
  const restored = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(w))))
  assert.deepEqual(restored.adaptive!.sites, w.adaptive!.sites)
  assert.deepEqual(restored.localEconomy!.cities, w.localEconomy!.cities)
  const view = { ...viewSnapshot(w, null), cells: w.cells }
  assert.deepEqual(settlementPlaces(view), settlementPlaces(w))
  assert.deepEqual(
    settlementPlaces(view).map((s) => describeCity(view, s)),
    settlementPlaces(w).map((s) => describeCity(w, s)),
  )
  const forged = structuredClone(w)
  forged.adaptive!.sites[Object.keys(forged.adaptive!.sites).find((id) => id.startsWith('residence:'))!]
    .residents!++
  assert.throws(() => validateWorld(forged), /residential|city occupied/)
  const repeated = structuredClone(w)
  repeated.adaptive!.nextResidence = 0
  assert.throws(() => validateWorld(repeated), /sequence/)
})

test('funded expansion creates a subhex parcel only after payment; capacity waits for construction', () => {
  const w = fixture('Funded subhex homes')
  beginEconomyMonth(w)
  const home = residentialSites(w).find(
    (s) => (s.residents ?? 0) > 1000 && w.localEconomy!.units[s.pool].cells.length === 1,
  )!
  assert(home)
  const r = w.localEconomy!.units[home.pool],
    sponsor = w.economy!.producers[home.pool]
  home.capacity = home.residents! * 1.15 - 100
  home.parcel = { x: home.x - 32, y: home.y - 32, size: 64 }
  for (const p of Object.values(w.economy!.producers)) p.cash = 0
  const h = w.economy!.households[home.pool].laborer
  h.laborForce = 1000
  h.employed = 0
  r.stocks.timber = r.stocks.stone = 100
  rebaseEndowments(w)
  const sites = Object.keys(w.adaptive!.sites).length
  advanceLandUse(w)
  assert.equal(Object.keys(w.adaptive!.sites).length, sites)
  sponsor.cash = 10
  rebaseEndowments(w)
  const beforeCash = Object.values(balances(w)).reduce((a, b) => a + b, 0),
    beforePeople = population(r)
  advanceLandUse(w)
  const added = residentialPools(w)
    .get(r.id)!
    .filter((s) => s.id.startsWith('residence:'))
  assert.equal(added.length, 1)
  assert.equal(added[0].residents, 0)
  assert.equal(added[0].capacity, 0)
  assert.notEqual(added[0].x, home.x)
  assert.equal(auditLedger(w) < 1e-7, true)
  assert(Math.abs(Object.values(balances(w)).reduce((a, b) => a + b, 0) - beforeCash) < 1e-7)
  const project = w.adaptive!.construction!.find((p) => p.site === added[0].id)!
  assert(Math.abs(project.capacity - 100) < 1e-7)
  advanceLandUse(w)
  advanceLandUse(w)
  assert.equal(added[0].capacity, 0)
  advanceLandUse(w)
  assert(Math.abs(added[0].capacity - 100) < 1e-7)
  assert.equal(population(r), beforePeople)
  assert.equal(
    residentialPools(w)
      .get(r.id)!
      .filter((s) => s.id.startsWith('residence:')).length,
    1,
    'completed vacant housing prevents duplicate investment',
  )
  refreshAdaptiveTotals(w)
  optimizeResidentialLocations(w)
  assert(added[0].residents! > 0)
  assert.equal(
    residentialPools(w)
      .get(r.id)!
      .reduce((sum, s) => sum + s.residents!, 0),
    beforePeople,
  )
})

test('location optimization concentrates residents without per-cell rounding freeze or lost claims', () => {
  const { w, unit, first, second } = prepareTwinParcels()
  for (const home of residentialPools(w).get(unit.id)!)
    if (home !== first && home !== second) home.capacity = 0
  first.capacity = first.residents! * 0.6
  second.capacity = second.residents! * 5
  const before = holdings(w),
    old = second.residents!
  optimizeResidentialLocations(w)
  assert(second.residents! > old)
  assert.equal(first.residents! + second.residents!, population(unit))
  assert.equal(holdings(w), before)
  assert(second.residents! <= second.capacity)
})

test('one administrative review can fund several mergers while retaining local service offices', async () => {
  const { reviewAdministration, activeJurisdictions } = await import('../src/sim/jurisdictions')
  const w = fixture('Polycentric administration')
  w.month = 12
  beginEconomyMonth(w)
  for (const nation of w.nations) {
    nation.stability = 100
    nation.treasury = 100
  }
  // This review is isolated from production: make the actual participating
  // census available to hire, as the production phase normally does.
  for (const id of w.localEconomy!.active)
    for (const cohort of w.localEconomy!.units[id].communities ?? [])
      w.economy!.households[id][cohort.stratum ?? 'laborer'].laborForce += participatingLabor(cohort)
  rebaseEndowments(w)
  const before = activeJurisdictions(w, 'municipality').length
  const money = Object.values(balances(w)).reduce((a, b) => a + b, 0)
  const census = JSON.stringify(w.regions.map((r) => r.communities)),
    goods = physicalStocks(w)
  reviewAdministration(w)
  const mergers = w.adaptive!.boundaries.filter(
    (r) => r.level === 'municipality' && r.from.length > r.to.length,
  )
  assert(mergers.length > 1)
  const perNation = new Map<number, number>()
  for (const change of mergers) {
    const next = w.adaptive!.jurisdictions[change.to[0]]
    perNation.set(next.nation, (perNation.get(next.nation) ?? 0) + 1)
    for (const old of change.from) assert(next.serviceSeats!.includes(w.adaptive!.jurisdictions[old].seat))
    assert(change.cost > 0)
  }
  assert(
    [...perNation.values()].some((n) => n > 1),
    'no one-reform-per-state quota',
  )
  const reforms = w.adaptive!.boundaries.filter((r) => r.level === 'municipality')
  assert.equal(
    activeJurisdictions(w, 'municipality').length,
    before + reforms.reduce((delta, r) => delta + r.to.length - r.from.length, 0),
  )
  assert.equal(JSON.stringify(w.regions.map((r) => r.communities)), census)
  assert.deepEqual(physicalStocks(w), goods)
  assert(Math.abs(Object.values(balances(w)).reduce((a, b) => a + b, 0) - money) < 1e-7)
  assert(auditLedger(w) < 1e-7)
})

test('nonfarm workplace access attracts residents even with equal initial crowding', () => {
  const w = fixture('Job access concentration')
  const pairs = [...residentialPools(w)].flatMap(([id, homes]) =>
    homes.flatMap((from) =>
      homes
        .filter((to) => {
          const distance = Math.hypot(from.x - to.x, from.y - to.y)
          return distance > 2200 && distance < 4000
        })
        .map((to) => ({ id, homes, from, to })),
    ),
  )
  assert(pairs.length)
  const { id, homes, from, to } = pairs[0]
  for (const home of homes) {
    home.residents = 0
    home.capacity = 0
  }
  const total = population(w.localEconomy!.units[id])
  from.residents = Math.floor(total / 2)
  to.residents = total - from.residents
  from.capacity = from.residents * 2
  to.capacity = to.residents * 2
  // Isolate the location mechanism: one established industrial workplace,
  // with unchanged employment and finance throughout the subsequent relocation.
  for (const firm of w.economy!.firms) {
    firm.employment = 0
    if (firm.labor) firm.labor.unfilled = 0
  }
  const firm = w.economy!.firms.find((f) => f.active)!
  const workplace = w.adaptive!.sites[`firm:${firm.id}`]
  Object.assign(workplace, { pool: id, cell: to.cell, x: to.x, y: to.y })
  firm.employment = 10000
  firm.laborMix = { food: 0, timber: 0, stone: 0, iron: 0, coal: 0, tools: 1, textiles: 0, arms: 0 }
  syncResidentialPopulation(w)
  refreshAdaptiveTotals(w)
  const access = settlementAccess(w),
    before = holdings(w),
    old = to.residents
  assert(access.utility(to) > access.utility(from) + 0.08)
  optimizeResidentialLocations(w)
  assert(to.residents! > old!)
  assert.equal(from.residents! + to.residents!, total)
  assert.equal(holdings(w), before)
})
