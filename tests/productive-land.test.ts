import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { beginEconomyMonth } from '../src/sim/macroeconomy'
import { ensureFirms, firmCapacity, regionalFirms } from '../src/sim/firms'
import {
  buildLandDevelopment,
  fundLandDevelopmentProgram,
  fundLandDevelopment,
  landDevelopmentQuote,
} from '../src/sim/land-investment'
import {
  completeLandProjects,
  LAND_WORK,
  landDevelopmentLimit,
  landProductivity,
  MAX_LAND_LEVEL,
  regionalLandProductivity,
  provinceLandDevelopment,
} from '../src/sim/productive-land'
import { advanceProductiveInvestment } from '../src/sim/productive-investment'
import { withConfigurationValues } from '../src/sim/configuration-context'
import { DEFAULT_CONFIGURATION_VALUES } from '../src/sim/configuration-defaults'
import { validateWorld, restoreWorld } from '../src/sim/persistence'
import { packWorldSave } from '../src/sim/save-codec'
import { STRATA } from '../src/sim/economic-types'
import { GOODS, inventory, population, type World } from '../src/sim/types'
import { auditBanks } from '../src/sim/banking'
import { auditLedger, balances } from '../src/sim/ledger'
import { auditGoods } from '../src/sim/goods-accounting'
import { reconcileGDP } from '../src/sim/national-accounts'
import { rebaseEndowments } from './fixtures/endowment'
import { applyCommand } from '../src/sim/commands'
import { supplierDebt } from '../src/sim/supplier-credit'

function fixture() {
  const w = generateWorld('productive land investment', 3, 4)
  ensureFirms(w)
  const r = w.regions.find((r) => r.nation >= 0 && population(r) > 10000)!,
    n = w.nations[r.nation]
  for (const state of w.nations) state.ai = false
  n.treasury = 10000
  n.technologies.agriculture = n.technologies.industry = n.technologies.logistics = 2
  n.foodCoverage = r.foodCoverage = 1
  r.stocks = inventory(100000)
  rebaseEndowments(w)
  beginEconomyMonth(w)
  for (const s of STRATA) {
    w.economy!.households[r.id][s].laborForce = 10000
    w.economy!.households[r.id][s].employed = 0
  }
  return { w, r, n, cell: r.cells[0] }
}

function audit(w: World) {
  reconcileGDP(w)
  auditLedger(w)
  auditBanks(w)
  auditGoods(w)
  validateWorld(w)
}

test('tile refinements pay real costs, conserve accounts and commission once after construction', () => {
  const { w, r, n, cell } = fixture(),
    timber = r.stocks.timber,
    money = Object.values(balances(w)).reduce((s, v) => s + v, 0),
    before = regionalLandProductivity(w, r)
  const quote = landDevelopmentQuote(w, r, cell),
    cost = fundLandDevelopment(w, r, cell, 1000)
  assert(cost > 0)
  assert(Math.abs(cost - quote.cost) < 1e-9)
  assert(Math.abs(timber - r.stocks.timber - LAND_WORK.timber) < 1e-9)
  assert.equal(regionalLandProductivity(w, r), before)
  assert.equal(n.capitalSpending, cost)
  assert.equal(fundLandDevelopment(w, r, cell, 1000), 0, 'pending work cannot be purchased twice')
  for (const s of STRATA) {
    const h = w.economy!.households[r.id][s]
    assert(h.employed >= 0 && h.employed <= h.laborForce)
  }
  assert(Math.abs(Object.values(balances(w)).reduce((s, v) => s + v, 0) - money) < 1e-8)
  // Production is only an investment-ranking observation here, not newly created goods.
  audit(w)
  const restored = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(w))))
  w.month = LAND_WORK.duration - 1
  completeLandProjects(w)
  assert.equal(regionalLandProductivity(w, r), before)
  w.month = restored.month = LAND_WORK.duration
  completeLandProjects(w)
  completeLandProjects(restored)
  assert.equal(w.productiveLand!.levels[cell], 1)
  assert.equal(restored.productiveLand!.levels[cell], 1)
  assert.equal(w.productiveLand!.projects.length, 0)
  assert(regionalLandProductivity(w, r) > before, 'commissioning invalidates cached capacity')
  const after = regionalLandProductivity(w, r)
  completeLandProjects(w)
  assert.equal(regionalLandProductivity(w, r), after)
})

test('completed land boosts all output sectors with diminishing returns and requires workers', () => {
  const { w, r } = fixture(),
    f = regionalFirms(w, r.id).find((f) => f.active)!
  r.deposits = { timber: 1, stone: 1, iron: 1, coal: 1 }
  f.employment = 100
  f.capital = 2
  f.laborMix = inventory(1 / GOODS.length)
  const active = regionalFirms(w, r.id).filter((f) => f.active).length,
    before = firmCapacity(w, r, f, active).q
  w.productiveLand = { levels: Object.fromEntries(r.cells.map((c) => [c, 1])), projects: [] }
  const first = firmCapacity(w, r, f, active).q
  w.productiveLand = { levels: Object.fromEntries(r.cells.map((c) => [c, 2])), projects: [] }
  const second = firmCapacity(w, r, f, active).q
  for (const g of GOODS) {
    assert(first[g] > before[g], g)
    assert(second[g] - first[g] < first[g] - before[g], `${g}: diminishing returns`)
  }
  f.employment = 0
  assert.deepEqual(firmCapacity(w, r, f, active).q, inventory())
})

test('supplier-financed site works retain the real material liability without creating money', () => {
  const { w, r, n, cell } = fixture(),
    q = landDevelopmentQuote(w, r, cell),
    money = Object.values(balances(w)).reduce((sum, value) => sum + value, 0)
  const cost = fundLandDevelopment(w, r, cell, q.laborCost + 1e-6)
  assert(Math.abs(cost - q.cost) < 1e-9)
  assert(supplierDebt(w, n.id) > 0)
  assert(Math.abs(n.debt - supplierDebt(w, n.id)) < 1e-9)
  assert(Math.abs(Object.values(balances(w)).reduce((sum, value) => sum + value, 0) - money) < 1e-8)
  audit(w)
})

test('technology unlocks paid levels, each costs more, and the hard ceiling cannot be bypassed', () => {
  const { w, r, n, cell } = fixture()
  n.technologies.agriculture = 0
  assert.equal(landDevelopmentLimit(n), 1, 'the least advanced complementary technology limits works')
  w.productiveLand = { levels: { [cell]: 1 }, projects: [] }
  assert.equal(fundLandDevelopment(w, r, cell, 1000), 0)
  const before = regionalLandProductivity(w, r)
  n.technologies.agriculture = 2
  assert.equal(regionalLandProductivity(w, r), before, 'research alone does not commission capital')
  const quote = landDevelopmentQuote(w, r, cell)
  const bare = landDevelopmentQuote(w, r, r.cells[1])
  assert(Math.abs(quote.cost / bare.cost - (1 + LAND_WORK.costGrowth)) < 1e-9)
  assert(fundLandDevelopment(w, r, cell, 1000) > 0)
  n.technologies.agriculture = n.technologies.industry = n.technologies.logistics = 100
  assert.equal(landDevelopmentLimit(n), MAX_LAND_LEVEL)
  w.productiveLand = { levels: { [cell]: MAX_LAND_LEVEL }, projects: [] }
  assert.equal(fundLandDevelopment(w, r, cell, 1000), 0)
})

test('insufficient cash, materials, workers, occupation and foreign cells cannot start partial levels', () => {
  for (const constraint of ['cash', 'goods', 'workers', 'occupation', 'foreign'] as const) {
    const { w, r, n, cell } = fixture()
    if (constraint === 'cash') n.treasury = 0
    if (constraint === 'goods') r.stocks.tools = 0
    if (constraint === 'workers')
      for (const s of STRATA) {
        const h = w.economy!.households[r.id][s]
        h.employed = h.laborForce
      }
    if (constraint === 'occupation')
      r.control = { nation: (n.id + 1) % w.nations.length } as NonNullable<typeof r.control>
    const target = constraint === 'foreign' ? w.regions.find((other) => other.id !== r.id)!.cells[0] : cell
    assert.equal(fundLandDevelopment(w, r, target, 1000), 0, constraint)
    assert.equal(w.productiveLand, undefined)
  }
  const { w, r, cell } = fixture(),
    q = landDevelopmentQuote(w, r, cell)
  assert.equal(fundLandDevelopment(w, r, cell, q.laborCost * 0.5), 0, 'credit cannot pay construction wages')
})

test('states reinvest in developed land without food or inventory shortages and preserve manual control', () => {
  const { w, r, n } = fixture()
  n.ai = true
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
  r.production.food = 1000
  w.month = 6 + (n.id % 3)
  advanceProductiveInvestment(w)
  assert(w.productiveLand!.projects.some((p) => p.nation === n.id))
  assert(n.development.appropriation < 1000)
  const count = w.productiveLand!.projects.length
  n.ai = false
  w.month += 3
  advanceProductiveInvestment(w)
  assert.equal(w.productiveLand!.projects.length, count)
  assert.match(buildLandDevelopment(w, r.id), /funded/)
})

test('physical tile capital survives conquest and district splits with an area-conserving multiplier', () => {
  const { w, r, n, cell } = fixture()
  fundLandDevelopment(w, r, cell, 1000)
  r.nation = (n.id + 1) % w.nations.length
  w.month = LAND_WORK.duration
  completeLandProjects(w)
  assert.equal(w.productiveLand!.levels[cell], 1)
  const first = { ...r, cells: r.cells.slice(0, 1) },
    rest = { ...r, cells: r.cells.slice(1) }
  assert.equal(regionalLandProductivity(w, first), landProductivity(1))
  const weighted =
    (regionalLandProductivity(w, first) + regionalLandProductivity(w, rest) * rest.cells.length) /
    r.cells.length
  assert(Math.abs(regionalLandProductivity(w, r) - weighted) < 1e-12)
})

test('live productivity tuning updates cached means and zero-material recipes still pay workers', () => {
  const { w, r, n } = fixture()
  w.productiveLand = { levels: { [r.cells[0]]: 1 }, projects: [] }
  const before = regionalLandProductivity(w, r),
    values = structuredClone(DEFAULT_CONFIGURATION_VALUES)
  values.productiveLand.productivity *= 2
  values.productiveLand.timber = values.productiveLand.stone = values.productiveLand.tools = 0
  r.stocks = inventory()
  r.production.food = 1000
  withConfigurationValues(values, () => {
    assert(Math.abs((regionalLandProductivity(w, r) - 1) / (before - 1) - 2) < 1e-10)
    assert(fundLandDevelopmentProgram(w, n, [r], 1000) > 0)
  })
  values.productiveLand.productivity = 0
  withConfigurationValues(values, () => {
    assert.equal(
      fundLandDevelopmentProgram(w, n, [r], 1000),
      0,
      'automatic funding requires a positive capacity gain',
    )
  })
})

test('province build commands use the paid tile-development path', () => {
  const { w, r } = fixture()
  r.production.food = 1000
  assert.match(applyCommand(w, { type: 'build', region: r.id, building: 'land-works' }), /funded/)
  assert.equal(w.productiveLand!.projects.length, 1)
  assert(w.productiveLand!.projects[0].cost > 0)
})

test('repeated capacity queries reuse the district area mean until commissioning', () => {
  const { w, r } = fixture()
  let visits = 0
  const cells = new Proxy(r.cells, {
    get: (target, property, receiver) => {
      if (typeof property === 'string' && /^\d+$/.test(property)) visits++
      return Reflect.get(target, property, receiver)
    },
  })
  const district = { ...r, cells }
  w.productiveLand = { levels: { [cells[0]]: 1 }, projects: [] }
  const value = regionalLandProductivity(w, district),
    initialVisits = visits
  for (let i = 0; i < 100000; i++) assert.equal(regionalLandProductivity(w, district), value)
  assert.equal(visits, initialVisits, 'hiring and production must not rescan cell geometry')
  w.productiveLand.projects.push({
    nation: r.nation,
    cell: cells[0],
    funded: 0,
    completes: 6,
    level: 2,
    cost: 1,
  })
  w.month = 6
  completeLandProjects(w)
  assert(regionalLandProductivity(w, district) > value)
  assert.equal(visits, initialVisits + 1 + cells.length)
})

test('fully improved, advanced economies can fund six successive levels without exceeding the ceiling', () => {
  const { w, r, n, cell } = fixture()
  r.fertility = 1.2
  n.technologies.agriculture = n.technologies.industry = n.technologies.logistics = 6
  let previousCost = 0
  for (let level = 1; level <= MAX_LAND_LEVEL; level++) {
    const cost = fundLandDevelopment(w, r, cell, 1000)
    assert(cost > previousCost)
    assert.equal(provinceLandDevelopment(w, r).pending, 1)
    previousCost = cost
    w.month += LAND_WORK.duration
    completeLandProjects(w)
    assert.equal(w.productiveLand!.levels[cell], level)
  }
  const summary = provinceLandDevelopment(w, r)
  assert.equal(summary.pending, 0)
  assert.equal(summary.limit, MAX_LAND_LEVEL)
  assert.equal(summary.level, MAX_LAND_LEVEL / r.cells.length)
  assert(summary.multiplier > 1)
  assert(landProductivity(MAX_LAND_LEVEL) < 1.9)
  assert.equal(fundLandDevelopment(w, r, cell, 1000), 0)
})

test('a large state can develop multiple districts in one review while respecting its shared budget', () => {
  const { w, r, n } = fixture(),
    other = w.regions.find((p) => p.nation === n.id && p.id !== r.id && population(p) > 1000)!
  assert(other)
  other.stocks = inventory(100000)
  for (const unit of [r, other]) {
    unit.production.food = 1000
    for (const h of Object.values(w.economy!.households[unit.id])) {
      h.laborForce = 10000
      h.employed = 0
    }
  }
  const budget =
    landDevelopmentQuote(w, r, r.cells[0]).cost + landDevelopmentQuote(w, other, other.cells[0]).cost + 1e-6
  const spent = fundLandDevelopmentProgram(w, n, [r, other], budget)
  assert.equal(w.productiveLand!.projects.length, 2)
  assert(spent > 0 && spent <= budget)
  assert(w.productiveLand!.projects.some((p) => r.cells.includes(p.cell)))
  assert(w.productiveLand!.projects.some((p) => other.cells.includes(p.cell)))
  const firstQuote = landDevelopmentQuote(w, r, r.cells[1])
  const count = w.productiveLand!.projects.length
  assert.equal(
    fundLandDevelopmentProgram(w, n, [r], firstQuote.cost * 0.99),
    0,
    'supplier credit must not take an automatic program over its total capital appropriation',
  )
  assert.equal(w.productiveLand!.projects.length, count)
})

test('malformed, overlapping and impossible saved land projects are rejected while legacy saves remain valid', () => {
  const { w, r, cell } = fixture()
  validateWorld(w)
  fundLandDevelopment(w, r, cell, 1000)
  for (const change of [
    (bad: World) => {
      bad.productiveLand!.levels[cell] = MAX_LAND_LEVEL + 1
    },
    (bad: World) => {
      bad.productiveLand!.projects[0].cell = w.cells.length
    },
    (bad: World) => {
      bad.productiveLand!.projects[0].cost = -1
    },
    (bad: World) => {
      bad.productiveLand!.projects[0].level = 2
    },
    (bad: World) => {
      bad.productiveLand!.projects[0].completes = 0
    },
    (bad: World) => {
      bad.productiveLand!.projects.push({ ...bad.productiveLand!.projects[0] })
    },
    (bad: World) => {
      bad.productiveLand!.levels[w.cells.find((c) => c.terrain === 'water')!.id] = 1
    },
  ]) {
    const bad = structuredClone(w)
    change(bad)
    assert.throws(() => validateWorld(bad), /productive land/)
  }
})
