import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { beginEconomyMonth } from '../src/sim/macroeconomy'
import { ensureFirms, firmCapacity, regionalFirms } from '../src/sim/firms'
import { advanceDomesticPolicy } from '../src/sim/domestic-policy'
import {
  advanceAgriculturalInvestment,
  completeFarmProjects,
  farmQuote,
  fundFarm,
} from '../src/sim/agriculture'
import { ensureStatecraft } from '../src/sim/statecraft'
import { withSimulationPeriod } from '../src/sim/simulation-period'
import { DECISION_POLICIES, withDecisionPolicy } from '../src/sim/decision-policy'
import { inventory, population } from '../src/sim/types'
import { STRATA } from '../src/sim/economic-types'
import { auditBanks } from '../src/sim/banking'
import { auditLedger, balances } from '../src/sim/ledger'
import { auditGoods } from '../src/sim/goods-accounting'
import { reconcileGDP } from '../src/sim/national-accounts'
import { restoreWorld, validateWorld } from '../src/sim/persistence'
import { packWorldSave } from '../src/sim/save-codec'
import { rebaseEndowments } from './fixtures/endowment'

function fixture() {
  const w = generateWorld('agricultural renewal', 3, 4)
  ensureFirms(w)
  const r = w.regions.find((r) => r.nation >= 0 && population(r) > 10000)!
  r.fertility = 0.6
  r.stocks = inventory(10000)
  w.nations[r.nation].treasury = 1000
  rebaseEndowments(w)
  beginEconomyMonth(w)
  w.economy!.households[r.id].artisan.laborForce = 10000
  return { w, r }
}
const audit = (w: ReturnType<typeof generateWorld>) => {
  reconcileGDP(w)
  auditLedger(w)
  auditBanks(w)
  auditGoods(w)
}

test('native cabinets respond to hunger with diplomacy records, but preserve human and fresh model decisions', () => {
  const w = generateWorld('hungry cabinets', 3, 4)
  const state = ensureStatecraft(w)
  w.month = 6
  for (const n of w.nations) {
    n.foodCoverage = 0.5
    n.policies.priority = 'balanced'
    n.researchFocus = 'military'
  }
  w.nations[1].ai = false
  state.agents[2].lastModel = 'test model'
  state.agents[2].lastDecision = 5
  withSimulationPeriod(6, () => advanceDomesticPolicy(w))
  for (const id of [0, 3]) {
    assert.equal(w.nations[id].policies.priority, 'agriculture')
    assert.equal(w.nations[id].researchFocus, 'agriculture')
  }
  for (const id of [1, 2]) assert.equal(w.nations[id].policies.priority, 'balanced')
  w.month = 12
  withSimulationPeriod(6, () => advanceDomesticPolicy(w))
  assert.equal(w.nations[2].policies.priority, 'agriculture', 'stale model plans cannot freeze government')
})

test('farm works pay materials and available labor, conserve accounts, and mature only after six months', () => {
  const { w, r } = fixture(),
    before = r.fertility,
    timber = r.stocks.timber,
    cash = Object.values(balances(w)).reduce((a, b) => a + b, 0)
  const spent = fundFarm(w, r, 1000)
  assert(spent > 0 && spent < 450, 'real local cost replaces the fixed opening-world price')
  assert(r.stocks.timber < timber)
  assert.equal(r.fertility, before)
  assert.equal(w.farmProjects!.length, 1)
  assert.equal(w.farmProjects![0].cost, spent)
  assert(w.economy!.households[r.id].artisan.employed > 0)
  for (const s of STRATA)
    assert(w.economy!.households[r.id][s].employed <= w.economy!.households[r.id][s].laborForce + 1e-8)
  assert(Math.abs(Object.values(balances(w)).reduce((a, b) => a + b, 0) - cash) < 1e-8)
  audit(w)
  validateWorld(w)
  const restored = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(w))))
  w.month = restored.month = 5
  completeFarmProjects(w)
  assert.equal(r.fertility, before)
  w.month = restored.month = 6
  completeFarmProjects(w)
  completeFarmProjects(restored)
  assert(r.fertility > before)
  assert.equal(r.fertility, restored.regions[r.id].fertility)
  assert.equal(w.farmProjects!.length, 0)
})

test('unfunded, unsupplied, fully employed and fully improved land cannot gain free projects', () => {
  for (const constraint of ['cash', 'goods', 'workers', 'land'] as const) {
    const { w, r } = fixture()
    if (constraint === 'cash') w.nations[r.nation].treasury = 0
    if (constraint === 'goods') r.stocks.timber = 0
    if (constraint === 'workers')
      for (const s of STRATA)
        w.economy!.households[r.id][s].employed = w.economy!.households[r.id][s].laborForce
    if (constraint === 'land') r.fertility = 1.2
    assert.equal(fundFarm(w, r, 1000), 0, constraint)
    assert.equal(w.farmProjects, undefined)
  }
  const { w, r } = fixture()
  r.fertility = 1.199
  assert.equal(fundFarm(w, r, 1000), 0, 'tiny residuals do not create unbounded project records')
})

test('farm quotes follow nominal prices and wages and retain person-month units at Max', () => {
  const { w, r } = fixture(),
    initial = farmQuote(w, r).cost
  for (const g of ['timber', 'stone'] as const) r.prices[g] *= 0.01
  w.economy!.producers[r.id].wage *= 0.01
  assert(Math.abs(farmQuote(w, r).cost - initial * 0.01) < 1e-10)
  withSimulationPeriod(6, () => {
    w.economy!.producers[r.id].wage *= 6
    assert(Math.abs(farmQuote(w, r).cost - initial * 0.01) < 1e-10)
  })
})

test('native farm investment is bounded by treasury and remains active without external agents', () => {
  const { w, r } = fixture()
  ensureStatecraft(w)
  for (const n of w.nations) n.ai = false
  const n = w.nations[r.nation]
  n.ai = true
  n.foodCoverage = r.foodCoverage = 0.5
  w.month = 6
  const cash = n.treasury
  withSimulationPeriod(6, () => advanceAgriculturalInvestment(w))
  assert(w.farmProjects!.some((p) => p.nation === n.id))
  assert(w.farmProjects!.reduce((s, p) => s + p.cost, 0) <= cash * (1 - 0.98 ** 6) + 1e-9)
  audit(w)
})

test('equipment raises harvests with diminishing returns, but does not replace workers or multiply existing stock', () => {
  const { w, r } = fixture(),
    f = regionalFirms(w, r.id)[0],
    active = regionalFirms(w, r.id).filter((f) => f.active).length
  w.economy!.producers[r.id].capital = 0
  f.employment = 100
  f.laborMix = inventory()
  f.laborMix.food = 1
  const harvest = (capital: number) => {
    f.capital = capital
    return withDecisionPolicy(DECISION_POLICIES.dynamic, () => firmCapacity(w, r, f, active).q.food)
  }
  const bare = harvest(0),
    first = harvest(1),
    second = harvest(2)
  assert(first > bare)
  assert(second - first < first - bare)
  f.employment = 0
  assert.equal(harvest(10), 0)
})

test('farm project imports reject impossible land, invalid costs and unbounded fertility', () => {
  const { w, r } = fixture()
  fundFarm(w, r, 1000)
  audit(w)
  for (const change of [
    (p: NonNullable<typeof w.farmProjects>[number]) => {
      p.fertility = 10
    },
    (p: NonNullable<typeof w.farmProjects>[number]) => {
      p.cells = [w.cells.length]
    },
    (p: NonNullable<typeof w.farmProjects>[number]) => {
      p.cells.push(p.cells[0])
    },
    (p: NonNullable<typeof w.farmProjects>[number]) => {
      p.cost = -1
    },
    (p: NonNullable<typeof w.farmProjects>[number]) => {
      p.completes = 0
    },
  ]) {
    const bad = structuredClone(w)
    change(bad.farmProjects![0])
    assert.throws(() => validateWorld(bad), /farm project/)
  }
})

test('funded soil improvements follow their cells across a boundary change and conquest', () => {
  const { w, r } = fixture()
  fundFarm(w, r, 1000)
  const project = w.farmProjects![0],
    cells = project.cells
  const split = Math.max(1, Math.floor(cells.length / 2))
  const first = { ...r, id: 10000, nation: (r.nation + 1) % w.nations.length, cells: cells.slice(0, split) }
  const second = { ...r, id: 10001, cells: cells.slice(split) }
  assert(second.cells.length > 0)
  // Isolate only the cell-addressed completion operation from remeshing machinery.
  w.localEconomy = {
    active: [first.id, second.id],
    units: { [first.id]: first, [second.id]: second },
  } as unknown as NonNullable<typeof w.localEconomy>
  const before = r.fertility
  w.month = project.completes
  completeFarmProjects(w)
  assert.equal(first.fertility, Math.min(1.2, before + project.fertility))
  assert.equal(second.fertility, first.fertility)
  const completedFertility = first.fertility
  completeFarmProjects(w)
  assert.equal(first.fertility, completedFertility, 'completion cannot be credited twice')
})
