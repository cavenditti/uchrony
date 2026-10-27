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
import { planHousingInvestment, housingInputs } from '../src/sim/housing-investment'
import { commuteRoute } from '../src/sim/commuting'
import { localWalkingConnection } from '../src/sim/residential-geometry'
import { neighbors } from '../src/sim/grid'
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
  for (const home of residentialSites(w)) home.openingBuilt = 0
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
  for (const home of residentialSites(w)) home.openingBuilt = 0
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

test('occupied infill links two persistent centres without moving assets or resetting their street frames', () => {
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
  assert.equal(active.length, 2)
  assert.equal(
    active.reduce((sum, c) => sum + c.population, 0),
    total,
  )
  assert.equal(new Set(active.flatMap((c) => c.sites!)).size, 3)
  assert.deepEqual(
    active.map((c) => c.id),
    initial.map((c) => c.id),
  )
  assert.equal(active.filter((c) => c.metropolis).length, 1)
  const patches = settlementPlaces(w)
  assert.equal(new Set(patches.map((p) => p.form!.planSeed)).size, 2)
  const labels = JSON.stringify(active)
  evolveCities(w, true)
  assert.equal(JSON.stringify(active), labels, 'same-month refresh does not advance integration')
  const restored = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(w))))
  assert.deepEqual(restored.localEconomy!.cities, w.localEconomy!.cities)
  first.residents! += bridge.residents!
  bridge.residents = 0
  syncResidentialPopulation(w)
  evolveCities(w, true)
  assert.equal(active.filter((c) => c.metropolis).length, 0)
  assert.equal(
    active.reduce((sum, c) => sum + c.population, 0),
    total,
  )
  assert(active.some((c) => c.history?.some((e) => e.kind === 'separated')))
  refreshSpatial(w)
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

test('within-cell locations and settlement identities survive compressed save and compact display exactly', () => {
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

test('funded expansion creates a within-cell parcel only after payment; capacity waits for construction', () => {
  const w = fixture('Funded within-cell homes')
  beginEconomyMonth(w)
  const home = residentialSites(w).find(
    (s) => (s.residents ?? 0) > 1000 && w.localEconomy!.units[s.pool].cells.length === 1,
  )!
  assert(home)
  const r = w.localEconomy!.units[home.pool],
    sponsor = w.economy!.producers[home.pool]
  home.capacity = home.residents! * 1.15 - 100
  home.openingBuilt = 0.1
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

test('several centres in one pool can fund housing without duplicating projects or creating money', () => {
  const { w, unit, first, second } = prepareTwinParcels()
  for (const home of residentialPools(w).get(unit.id)!) home.capacity = home.residents! * 0.8
  for (const producer of Object.values(w.economy!.producers)) producer.cash = 0
  const sponsor = w.economy!.producers[unit.id]
  sponsor.cash = 1e8
  unit.stocks.timber = unit.stocks.stone = 1e7
  beginEconomyMonth(w)
  w.economy!.households[unit.id].laborer.laborForce = 1e7
  w.economy!.households[unit.id].laborer.employed = 0
  rebaseEndowments(w)
  const money = Object.values(balances(w)).reduce((a, b) => a + b, 0)
  const capacities = [first.capacity, second.capacity]
  const access = { ...settlementAccess(w), baseUtility: () => 1, utility: () => 1 }
  advanceLandUse(w, access)
  const projects = w.adaptive!.construction!.filter((p) => w.adaptive!.sites[p.site].pool === unit.id)
  assert.equal(projects.length, 2)
  const nearest = (id: string) => {
    const site = w.adaptive!.sites[id]
    return [first, second].sort(
      (a, b) => Math.hypot(a.x - site.x, a.y - site.y) - Math.hypot(b.x - site.x, b.y - site.y),
    )[0].id
  }
  assert.deepEqual(projects.map((p) => nearest(p.site)).sort(), [first.id, second.id].sort())
  assert.deepEqual([first.capacity, second.capacity], capacities, 'funding does not complete buildings')
  assert(Math.abs(Object.values(balances(w)).reduce((a, b) => a + b, 0) - money) < 1e-6)
  assert(auditLedger(w) < 1e-7)
  advanceLandUse(w, access)
  const pending = w.adaptive!.construction!.filter((p) => w.adaptive!.sites[p.site].pool === unit.id)
  assert.equal(new Set(pending.map((p) => p.site)).size, pending.length)
  assert(
    pending.reduce((sum, p) => sum + p.capacity, 0) <=
      population(unit) * 1.15 - capacities[0] - capacities[1] + 1e-7,
  )
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

test('small rural shortages repair existing homes instead of surveying tiny urban plots', () => {
  const w = fixture('Rural infill cost'),
    home = residentialSites(w).find((s) => s.capacity > 1000)!
  home.openingBuilt = 0
  const unit = w.localEconomy!.units[home.pool],
    sponsor = w.economy!.producers[home.pool]
  unit.stocks.timber = unit.stocks.stone = 1000
  sponsor.cash = 1000
  const before = JSON.stringify(w.adaptive!.sites)
  const plan = planHousingInvestment(w, home, 10, [home], 1000, settlementAccess(w))!
  assert(plan && !plan.plot)
  assert.equal(plan.site.id, home.id)
  assert.equal(plan.spaces, 10)
  assert.equal(JSON.stringify(w.adaptive!.sites), before, 'planning cannot create people, assets or parcels')
  const low = housingInputs(100, 100, 16384),
    high = housingInputs(100, 2000, 16384),
    expansion = housingInputs(10, 0, 16384, 100)
  assert(
    high.stone > low.stone && high.labor > low.labor,
    'vertical development uses increasing marginal inputs',
  )
  assert(expansion.stone > 12 && expansion.labor > 4, 'new land pays real fixed and distance-based works')
})

test('occupied parcels merge across terrain boundaries without a mandatory center detour', () => {
  const w = fixture('Adjacent occupied edges'),
    local = w.localEconomy!
  for (const home of residentialSites(w)) home.openingBuilt = 0
  local.cities = []
  const first = residentialSites(w).find(
    (a) =>
      (a.residents ?? 0) > 1000 &&
      neighbors(a.cell, w.width, w.height).some((id) => {
        const b = w.adaptive!.sites[`home:${id}`]
        return b && (b.residents ?? 0) > 1000 && local.units[a.pool].nation === local.units[b.pool].nation
      }),
  )!
  const second = neighbors(first.cell, w.width, w.height)
    .map((id) => w.adaptive!.sites[`home:${id}`])
    .find(
      (b) => b && (b.residents ?? 0) > 1000 && local.units[b.pool].nation === local.units[first.pool].nation,
    )!
  const pa = cellPosition(w, first.cell),
    pb = cellPosition(w, second.cell),
    length = Math.hypot(pb.x - pa.x, pb.y - pa.y),
    dx = (pb.x - pa.x) / length,
    dy = (pb.y - pa.y) / length
  const added = [first, second].map((home, i) => {
    const point = { x: (pa.x + pb.x) / 2 + (i ? 64 : -64) * dx, y: (pa.y + pb.y) / 2 + (i ? 64 : -64) * dy }
    const s = createResidentialParcel(w, home.pool, home.cell, point, {
      x: point.x - 64,
      y: point.y - 64,
      size: 128,
    })
    s.capacity = 1200
    s.residents = 1000
    s.investedValue = 1
    home.residents! -= 1000
    return s
  })
  syncResidentialPopulation(w)
  refreshAdaptiveTotals(w)
  const before = holdings(w)
  evolveCities(w, true)
  refreshSpatial(w)
  const cities = local.cities.filter((c) => c.population && c.absorbedBy === undefined)
  assert.equal(cities.length, 1)
  assert.equal(cities[0].population, 2000)
  assert(cities[0].sites!.includes(added[0].id) && cities[0].sites!.includes(added[1].id))
  assert.equal(holdings(w), before)
  validateWorld(w)
})

test('direct walks cannot cross water or a zero-width land corner', () => {
  const w = fixture('Corner walking barrier')
  const c = w.cells.find(
    (a) =>
      a.q + 1 < w.width &&
      a.r + 1 < w.height &&
      [a.id, a.id + 1, a.id + w.width, a.id + w.width + 1].every(
        (id) =>
          w.cells[id].terrain !== 'water' &&
          w.regions[w.cells[id].region].nation === w.regions[a.region].nation,
      ),
  )!
  assert(c)
  const a = c.id,
    b = a + w.width + 1,
    nation = w.regions[c.region].nation,
    from = cellPosition(w, a),
    to = cellPosition(w, b)
  assert(localWalkingConnection(w, from, to, nation, [a, b]))
  w.cells[a + 1].terrain = 'water'
  w.cells[a + w.width].terrain = 'water'
  assert.equal(localWalkingConnection(w, from, to, nation, [a, b]), null)
  assert.equal(localWalkingConnection(w, from, cellPosition(w, a + 1), nation, [a, a + 1]), null)
})

test('network fallback cannot cross an inaccessible sovereign corner', () => {
  const w = fixture('Sovereign walking barrier')
  const c = w.cells.find(
    (a) =>
      a.q + 1 < w.width &&
      a.r + 1 < w.height &&
      [a.id, a.id + 1, a.id + w.width, a.id + w.width + 1].every(
        (id) =>
          w.cells[id].terrain !== 'water' &&
          w.regions[w.cells[id].region].nation === w.regions[a.region].nation,
      ),
  )!
  const from = c.id,
    to = from + w.width + 1,
    nation = w.regions[c.region].nation
  w.corridors = []
  for (const id of [from, from + 1, from + w.width, to]) w.cells[id].terrain = 'plains'
  assert(commuteRoute(w, from, to, 23))
  for (const id of [from + 1, from + w.width]) {
    const region = { ...w.regions[w.cells[id].region], nation: (nation + 1) % w.nations.length }
    w.cells[id].region = w.regions.length
    w.regions.push(region)
  }
  w.month++
  assert.equal(commuteRoute(w, from, to, 23), null)
})
