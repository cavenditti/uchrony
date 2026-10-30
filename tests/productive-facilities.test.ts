import test from 'node:test'
import assert from 'node:assert/strict'
import { facilityFixture } from './fixtures/productive-facilities'
import {
  facilityQuote,
  facilitySitePotential,
  facilityOpportunities,
  fundFacility,
  fundFacilityProgram,
  buildFacility,
} from '../src/sim/facility-investment'
import {
  completeFacilityProjects,
  facilityDistrictActivity,
  facilityLevelLimit,
  pendingFacilityCells,
  regionalFacilityLevels,
  publicWorkshopJobs,
  weightFacilityLabor,
} from '../src/sim/productive-facilities'
import {
  FACILITY_DEFINITIONS,
  FACILITY_KINDS,
  GOOD_FACILITY,
  MAX_FACILITY_LEVELS,
  type FacilityKind,
} from '../src/sim/facility-types'
import { auditBanks } from '../src/sim/banking'
import { auditLedger, balances } from '../src/sim/ledger'
import { auditGoods, physicalStocks } from '../src/sim/goods-accounting'
import { reconcileGDP } from '../src/sim/national-accounts'
import { validateWorld, restoreWorld } from '../src/sim/persistence'
import { packWorldSave } from '../src/sim/save-codec'
import { firmCapacity, hireFirms, produceFirms, regionalFirms } from '../src/sim/firms'
import { retailDecay, retailMarkup } from '../src/sim/retail-pricing'
import { beginEconomyMonth, consumeHouseholds } from '../src/sim/macroeconomy'
import { applyCommand } from '../src/sim/commands'
import { advanceProductiveInvestment } from '../src/sim/productive-investment'
import { cellResourcePotential } from '../src/sim/landscape'
import { habitableLand } from '../src/sim/terrain-access'
import { GOODS, inventory, type World, type Region } from '../src/sim/types'
import { canonicalHash } from './fixtures/world-hash'
import { rebaseEndowments } from './fixtures/endowment'
import { DEFAULT_CONFIGURATION_VALUES } from '../src/sim/configuration-defaults'
import { acceptStatePlan } from '../src/sim/statecraft'
import { statecraftAffordances } from '../src/sim/statecraft-affordances'
import { ensureAdaptiveWorld } from '../src/sim/adaptive-world'
import { economicRegions } from '../src/sim/local-units'
import { aggregateDistricts } from '../src/sim/districts'
import { householdNeed } from '../src/sim/economy'

function audit(w: World) {
  reconcileGDP(w)
  auditLedger(w)
  auditBanks(w)
  auditGoods(w)
  validateWorld(w)
}
const cash = (w: World) => Object.values(balances(w)).reduce((sum, n) => sum + n, 0)

test('every facility kind uses real paid construction and grants no immediate productive capacity', () => {
  for (const good of GOODS)
    assert.equal(
      FACILITY_DEFINITIONS[GOOD_FACILITY[good]].sector,
      good,
      'the construction catalogue must cover every productive good exactly once',
    )
  for (const kind of FACILITY_KINDS) {
    const { w, r, n, cell } = facilityFixture(kind),
      before = cash(w),
      quote = facilityQuote(w, r, kind, cell),
      timber = r.stocks.timber,
      capital = regionalFacilityLevels(w, r)
    assert.equal(quote.obstacle, '', kind)
    const cost = fundFacility(w, r, kind, 1000, cell)
    assert(cost > 0, kind)
    assert(Math.abs(cost - quote.cost) < 1e-9)
    assert(Math.abs(cash(w) - before) < 1e-8)
    assert(r.stocks.timber < timber)
    assert.equal(regionalFacilityLevels(w, r)[kind], capital[kind])
    assert.equal(n.capitalSpending, cost)
    assert.equal(w.facilities!.projects[0].kind, kind)
    assert.equal(fundFacility(w, r, 'market', 1000, cell), 0, 'a pending site cannot be double-booked')
    for (const h of Object.values(w.economy!.households[r.id])) assert(h.employed <= h.laborForce + 1e-9)
    audit(w)
  }
})

test('commissioning is delayed, idempotent, save-stable and preserves inventories and cash', () => {
  const { w, r, cell } = facilityFixture()
  fundFacility(w, r, 'iron-mine', 1000, cell)
  audit(w)
  const restored = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(w)))),
    money = cash(w),
    stock = physicalStocks(w)
  regionalFacilityLevels(w, r)
  w.month = 5
  completeFacilityProjects(w)
  assert.equal(w.facilities!.sites[cell], undefined)
  w.month = restored.month = 6
  completeFacilityProjects(w)
  completeFacilityProjects(restored)
  assert.equal(w.facilities!.sites[cell]['iron-mine'], 1)
  assert.deepEqual(restored.facilities, w.facilities)
  assert.equal(cash(w), money)
  assert.deepEqual(physicalStocks(w), stock)
  assert(regionalFacilityLevels(w, r)['iron-mine'] > 0)
  const levels = structuredClone(w.facilities)
  completeFacilityProjects(w)
  assert.deepEqual(w.facilities, levels)
  assert.equal(pendingFacilityCells(w).size, 0)
})

test('mines require real remaining ore and site selection prefers the richer deposit', () => {
  const { w, r, cell } = facilityFixture(),
    usable = r.cells.filter((c) => habitableLand(w.cells[c]))
  assert(usable.length >= 2)
  for (const id of r.cells) if (w.cells[id].landscape) w.cells[id].landscape!.resources.iron = 0
  assert.match(facilityQuote(w, r, 'iron-mine').obstacle, /deposit/)
  w.cells[usable[0]].landscape!.resources.iron = 0.1
  w.cells[usable[1]].landscape!.resources.iron = 2
  assert.equal(facilityQuote(w, r, 'iron-mine').cell, usable[1])
  // The pure endowment accessor also reads depletion rather than reopening a
  // worked-out mine merely because its terrain still carries an ore label.
  w.localEconomy = { reserves: { [usable[1]]: { iron: 0 } } } as unknown as NonNullable<World['localEconomy']>
  assert.equal(cellResourcePotential(w, usable[1], 'iron'), 0)
  assert.equal(facilitySitePotential(w, usable[1], 'iron-mine'), 0)
  assert.equal(facilitySitePotential(w, w.cells.find((c) => c.terrain === 'water')!.id, 'market'), 0)
  assert(cell >= 0)
})

test('technology unlocks tiers, construction gets dearer, and all sectors share finite land slots', () => {
  const { w, r, n, cell } = facilityFixture()
  n.technologies.industry = 0
  assert.equal(facilityLevelLimit(n, 'coal-mine'), 0)
  assert.match(facilityQuote(w, r, 'coal-mine', cell).obstacle, /research/)
  n.technologies.industry = 6
  let previous = 0
  for (let tier = 1; tier <= MAX_FACILITY_LEVELS; tier++) {
    const cost = fundFacility(w, r, 'iron-mine', 1000, cell)
    assert(cost > previous)
    previous = cost
    w.month += 6
    completeFacilityProjects(w)
  }
  assert.equal(fundFacility(w, r, 'market', 1000, cell), 0)
  assert.equal(fundFacility(w, r, 'iron-mine', 1000, cell), 0)
  assert.equal(w.facilities!.sites[cell]['iron-mine'], MAX_FACILITY_LEVELS)
})

test('cash, material, labor, occupation and exact district boundaries constrain building orders', () => {
  for (const constraint of ['cash', 'materials', 'workers', 'wage', 'occupation', 'foreign'] as const) {
    const { w, r, n, cell } = facilityFixture()
    if (constraint === 'cash') n.treasury = 0
    if (constraint === 'materials') r.stocks.tools = 0
    if (constraint === 'wage') w.economy!.producers[r.id].wage = 0
    if (constraint === 'workers')
      for (const h of Object.values(w.economy!.households[r.id])) h.employed = h.laborForce
    if (constraint === 'occupation')
      r.control = { nation: (n.id + 1) % w.nations.length } as NonNullable<Region['control']>
    const target = constraint === 'foreign' ? w.regions.find((p) => p.nation !== r.nation)!.cells[0] : cell
    assert.equal(fundFacility(w, r, 'market', 1000, target), 0, constraint)
    assert.equal(w.facilities, undefined)
  }
  const { w, r } = facilityFixture()
  assert.match(buildFacility(w, r.id, 'market', w.regions.find((p) => p.nation !== r.nation)!.id), /inside/)
})

test('matching facilities bias sector labor and capacity without granting output to empty workforces or barren ground', () => {
  const { w, r, cell } = facilityFixture(),
    f = regionalFirms(w, r.id).find((f) => f.active)!
  const district = { ...r, cells: [cell] },
    active = 3
  f.employment = 100
  f.capital = 0
  w.economy!.producers[r.id].capital = 0
  f.laborMix = inventory(1 / GOODS.length)
  const bare = firmCapacity(w, district, f, active).q
  w.facilities = { sites: { [cell]: { 'iron-mine': 1, 'tool-industry': 1 } }, projects: [] }
  const developed = firmCapacity(w, district, f, active).q
  assert(developed.ironOre > bare.ironOre)
  assert(
    developed.tools > 0 && bare.tools === 0,
    'paid workshops can establish industry without legacy equipment',
  )
  assert.equal(developed.coal, bare.coal)
  const mix = weightFacilityLabor(w, district, inventory(1))
  assert(mix.ironOre > mix.coal && mix.tools > mix.textiles)
  assert.equal(
    facilityDistrictActivity(w, district),
    'mixed',
    'equal sector footprints are not a majority specialization',
  )
  assert(Math.abs(GOODS.reduce((sum, g) => sum + mix[g], 0) - 1) < 1e-12)
  f.employment = 0
  assert.deepEqual(firmCapacity(w, district, f, active).q, inventory())
  f.employment = 100
  district.deposits = { ...r.deposits, iron: 0 }
  assert.equal(firmCapacity(w, district, f, active).q.ironOre, 0)
})

test('an equipped industrial district still needs its actual manufacturing inputs', () => {
  for (const supplied of [false, true]) {
    const { w, r } = facilityFixture()
    w.facilities = {
      sites: Object.fromEntries(
        r.cells.filter((c) => habitableLand(w.cells[c])).map((c) => [c, { 'tool-industry': 3 }]),
      ),
      projects: [],
    }
    r.stocks.iron = r.stocks.coal = supplied ? 100000 : 0
    for (const f of regionalFirms(w, r.id)) {
      f.capital = 0
      f.activity = 'tools'
    }
    w.economy!.producers[r.id].capital = 0
    rebaseEndowments(w)
    beginEconomyMonth(w)
    produceFirms(w, r)
    assert.equal(r.production.tools > 0, supplied)
    for (const g of GOODS) assert(r.stocks[g] >= -1e-9)
    audit(w)
  }
})

test('paid public workshops add finite usable premises even when all private workshops are closed', () => {
  const { w, r } = facilityFixture()
  ensureAdaptiveWorld(w)
  const unit = economicRegions(w).find((u) => u.nation === r.nation && u.population.adults > 10000)!
  assert(unit)
  const firms = regionalFirms(w, unit.id).filter((f) => f.active)
  for (const f of firms) {
    f.capital = 0
    f.activity = 'tools'
    f.forecast.tools = 100000
    w.adaptive!.sites[`firm:${f.id}`].capacity = 0
  }
  w.economy!.producers[unit.id].capital = 0
  unit.stocks = inventory(100000)
  rebaseEndowments(w)
  beginEconomyMonth(w)
  hireFirms(w, unit)
  assert(fundFacility(w, unit, 'tool-industry', 1000) > 0)
  w.month = 6
  beginEconomyMonth(w)
  completeFacilityProjects(w)
  assert(Math.abs(publicWorkshopJobs(w, unit, 1) - publicWorkshopJobs(w, unit, 10) * 10) < 1e-9)
  produceFirms(w, unit)
  assert(unit.production.tools > 0)
  const indoor = firms.reduce(
    (sum, f) => sum + f.employment * (f.laborMix!.tools + f.laborMix!.textiles + f.laborMix!.arms),
    0,
  )
  assert(indoor <= publicWorkshopJobs(w, unit, 1) + 1e-7)
  aggregateDistricts(w)
  audit(w)
})

test('markets reduce physical storage losses and handling margins while retaining financing costs', () => {
  const { w, r, cell } = facilityFixture(),
    district = { ...r, cells: [cell] },
    before = retailMarkup(w, district, 'food'),
    decay = retailDecay('food', w, district)
  w.facilities = { sites: { [cell]: { market: 3 } }, projects: [] }
  assert(retailDecay('food', w, district) < decay)
  assert(retailMarkup(w, district, 'food') < before)
  assert(retailMarkup(w, district, 'food') > 0)
  assert.equal(retailDecay('food'), decay, 'unconditioned compatibility quotes keep their original decay')
})

test('commissioned markets reduce actual merchant spoilage in the household-clearing pipeline', () => {
  const { w, r } = facilityFixture()
  for (const h of Object.values(w.economy!.households[r.id])) h.cash = 0
  rebaseEndowments(w)
  beginEconomyMonth(w)
  const improved = structuredClone(w)
  improved.facilities = { sites: Object.fromEntries(r.cells.map((c) => [c, { market: 3 }])), projects: [] }
  consumeHouseholds(w)
  consumeHouseholds(improved)
  assert(improved.economy!.producers[r.id].losses.food < w.economy!.producers[r.id].losses.food)
  audit(w)
  audit(improved)
})

test('economic conditions change investment rankings: resources, inputs and customers all matter', () => {
  const { w, r, cell } = facilityFixture()
  // Ore mines serve smelters, rather than fictitious household ore consumption.
  r.plannedProduction = { ...inventory(), iron: 100 }
  const rich = facilityQuote(w, r, 'iron-mine', cell).score
  assert(rich > 0)
  w.cells[cell].landscape!.resources.iron = 0.1
  assert(facilityQuote(w, r, 'iron-mine', cell).score < rich)
  const industrial = facilityQuote(w, r, 'tool-industry', cell).score
  for (const g of ['iron', 'coal', 'timber'] as const) {
    r.stocks[g] = 0
    for (const id of r.neighbors) if (w.regions[id]?.nation === r.nation) w.regions[id].stocks[g] = 0
  }
  const noInputs = facilityQuote(w, r, 'tool-industry', cell)
  assert(noInputs.score < industrial)
  assert.match(noInputs.reason, /scarce/)
})

test('native facility programs select ranked prospects, cap commitments and preserve human control', () => {
  const { w, r, n } = facilityFixture(),
    alternatives = facilityOpportunities(w, n, [r])
  assert(alternatives.length > 1)
  const first = alternatives[0],
    spent = fundFacilityProgram(w, n, [r], first.cost + 1e-6)
  assert(spent > 0 && spent <= first.cost + 1e-6)
  assert.equal(w.facilities!.projects[0].kind, first.kind)
  assert.equal(w.facilities!.projects.length, 1)
  const count = w.facilities!.projects.length
  n.ai = false
  w.month = 6 + (n.id % 3)
  n.development = {
    focus: 'industry',
    started: 0,
    review: 60,
    baselineOutput: 1,
    targetOutput: 1.1,
    currentOutput: 1,
    revenue: 1,
    appropriation: 1000,
    borrowed: 0,
  }
  advanceProductiveInvestment(w)
  assert.equal(w.facilities!.projects.length, count)
  n.ai = true
  advanceProductiveInvestment(w)
  assert(w.facilities!.projects.length > count)
  assert(n.development.appropriation < 1000)
})

test('native portfolios choose an ore mine in a deposit-rich valley and tool works in an input-supplied industrial district', () => {
  for (const desired of ['iron-mine', 'tool-industry'] as const) {
    const { w, r, n } = facilityFixture()
    r.fertility = 0.05
    r.urban = desired === 'iron-mine' ? 0.05 : 1
    r.literacy = desired === 'iron-mine' ? 0.15 : 0.9
    r.infrastructure = desired === 'iron-mine' ? 0.05 : 1.2
    r.deposits = { timber: 0, stone: 0, iron: desired === 'iron-mine' ? 3 : 0, coal: 0 }
    for (const cell of r.cells)
      if (w.cells[cell].landscape) {
        w.cells[cell].landscape!.habitat = 0.05
        w.cells[cell].landscape!.resources = { ...r.deposits }
      }
    r.stocks = {
      ...inventory(),
      food: householdNeed(r, 'food') * 2,
      timber: 120,
      stone: 120,
      iron: desired === 'iron-mine' ? 16 : 120,
      coal: desired === 'iron-mine' ? 12 : 60,
      tools: 12,
      textiles: 400,
      arms: 100,
    }
    r.plannedProduction = { ...inventory(), iron: desired === 'iron-mine' ? 100 : 0 }
    rebaseEndowments(w)
    beginEconomyMonth(w)
    hireFirms(w, r)
    const opportunities = facilityOpportunities(w, n, [r])
    assert.equal(opportunities[0]?.kind, desired)
    assert(fundFacilityProgram(w, n, [r], 1000) > 0)
    assert.equal(w.facilities!.projects[0].kind, desired)
    audit(w)
  }
})

test('facility construction follows its cell through conquest and district refinement', () => {
  const { w, r, n, cell } = facilityFixture()
  fundFacility(w, r, 'iron-mine', 1000, cell)
  r.nation = (n.id + 1) % w.nations.length
  w.month = 6
  completeFacilityProjects(w)
  const first = { ...r, cells: [cell] },
    remaining = { ...r, cells: r.cells.filter((id) => id !== cell) },
    whole = regionalFacilityLevels(w, r)['iron-mine']
  assert.equal(regionalFacilityLevels(w, first)['iron-mine'], 1)
  assert.equal(regionalFacilityLevels(w, remaining)['iron-mine'], 0)
  assert(Math.abs(whole - 1 / r.cells.length) < 1e-12)
  assert.equal(facilityDistrictActivity(w, first), 'mining')
})

test('equal sector tier counts remain mixed regardless of how they are spread across sites', () => {
  const { w, r } = facilityFixture(),
    cells = r.cells.filter((c) => habitableLand(w.cells[c]))
  assert(cells.length >= 3)
  w.facilities = {
    sites: {
      [cells[0]]: { 'iron-mine': 1, 'tool-industry': 3 },
      [cells[1]]: { 'iron-mine': 1 },
      [cells[2]]: { 'iron-mine': 1 },
    },
    projects: [],
  }
  assert.equal(facilityDistrictActivity(w, r), 'mixed')
})

test('every commissioned facility contributes to the district specialization of its productive sector', () => {
  const { w, r, cell } = facilityFixture()
  const groups = {
    agricultural: [
      'farm-estate',
      'sheep-farm',
      'grain-farm',
      'flax-farm',
      'cotton-farm',
      'hemp-farm',
      'fishery',
    ],
    mining: ['timber-yard', 'quarry', 'iron-mine', 'coal-mine', 'clay-pit', 'salt-works', 'precious-mine'],
    industrial: [
      'smelter',
      'charcoal-kiln',
      'tool-industry',
      'textile-industry',
      'arms-industry',
      'brick-kiln',
      'flour-mill',
      'bakery',
      'preserving-works',
      'coking-works',
      'steel-works',
      'rope-works',
      'precious-refinery',
      'jeweler',
    ],
    urban: ['market'],
  } as const
  assert.deepEqual(Object.values(groups).flat().sort(), [...FACILITY_KINDS].sort())
  for (const [activity, kinds] of Object.entries(groups))
    for (const kind of kinds) {
      w.facilities = { sites: { [cell]: { [kind]: 1 } }, projects: [] }
      assert.equal(facilityDistrictActivity(w, r), activity, kind)
      assert.equal(publicWorkshopJobs(w, r, 1) > 0, activity === 'industrial', kind)
    }
})

test('new primary facilities preserve exact majority ties and follow their own physical cells', () => {
  const { w, r } = facilityFixture(),
    cells = r.cells.filter((id) => habitableLand(w.cells[id]))
  assert(cells.length >= 3)
  w.facilities = {
    sites: {
      [cells[0]]: { 'grain-farm': 1, 'clay-pit': 3 },
      [cells[1]]: { 'flax-farm': 1 },
      [cells[2]]: { fishery: 1 },
    },
    projects: [],
  }
  assert.equal(facilityDistrictActivity(w, r), 'mixed')
  assert.equal(facilityDistrictActivity(w, { ...r, cells: [cells[0]] }), 'mining')
  assert.equal(facilityDistrictActivity(w, { ...r, cells: cells.slice(1) }), 'agricultural')
})

test('quotes and 100,000 repeated capacity reads do not mutate the world or rescan its terrain', () => {
  const { w, r, cell } = facilityFixture(),
    before = canonicalHash(w)
  facilityQuote(w, r, 'iron-mine', cell)
  facilityOpportunities(w, w.nations[r.nation], [r])
  assert.equal(canonicalHash(w), before)
  let visits = 0
  const cells = new Proxy(r.cells, {
    get: (target, property, receiver) => {
      if (typeof property === 'string' && /^\d+$/.test(property)) visits++
      return Reflect.get(target, property, receiver)
    },
  })
  w.facilities = { sites: { [cell]: { 'iron-mine': 1 } }, projects: [] }
  const district = { ...r, cells },
    first = regionalFacilityLevels(w, district),
    count = visits
  for (let i = 0; i < 100000; i++) {
    assert.equal(regionalFacilityLevels(w, district), first)
    assert.equal(facilityDistrictActivity(w, district), 'mining')
  }
  assert.equal(visits, count)
})

test('legacy and configured saves retain facilities and reject impossible, overlapping or unknown records', () => {
  const { w, r, cell } = facilityFixture()
  validateWorld(w)
  const values = structuredClone(DEFAULT_CONFIGURATION_VALUES)
  values.facilities.duration = 9
  w.configuration = { version: 1, revision: 0, values }
  fundFacility(w, r, 'market', 1000, cell)
  assert.equal(w.facilities!.projects[0].completes, 9)
  audit(w)
  for (const change of [
    (bad: World) => {
      bad.facilities!.sites[cell] = { market: 7 }
    },
    (bad: World) => {
      bad.facilities!.sites[cell] = { market: 4, 'iron-mine': 3 }
    },
    (bad: World) => {
      bad.facilities!.projects[0].level = 2
    },
    (bad: World) => {
      bad.facilities!.projects[0].kind = 'gold-mine' as FacilityKind
    },
    (bad: World) => {
      bad.facilities!.projects[0].cell = w.cells.length
    },
    (bad: World) => {
      bad.facilities!.projects[0].cost = -1
    },
    (bad: World) => {
      bad.facilities!.projects.push({ ...bad.facilities!.projects[0] })
    },
  ]) {
    const bad = structuredClone(w)
    change(bad)
    assert.throws(() => validateWorld(bad), /facility/)
  }
})

test('player and model-issued construction orders use the same facility funding path', () => {
  const { w, r, n } = facilityFixture()
  assert.match(
    applyCommand(w, { type: 'build-facility', region: r.id, district: r.id, facility: 'market' }),
    /funded/,
  )
  n.ai = true
  acceptStatePlan(
    w,
    n.id,
    {
      assessment: 'Develop local resources.',
      strategy: '',
      memory: '',
      goals: [],
      escalate: false,
      reason: '',
      orders: [{ kind: 'build', target: r.id, key: 'district', value: r.id, text: 'iron-mine' }],
      offers: [],
      messages: [],
      answers: [],
    },
    false,
    'fixture',
    0,
  )
  assert(w.facilities!.projects.some((p) => p.kind === 'iron-mine'))
  assert(statecraftAffordances(w, n.id).canBuildIn.every((q) => w.regions[q.id].nation === n.id))
})
