import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DECISION_POLICIES,
  decisionPolicy,
  withDecisionPolicy,
  recruitmentCost,
} from '../src/sim/decision-policy'
import { householdDemand, beginEconomyMonth, consumeHouseholds } from '../src/sim/macroeconomy'
import { generateWorld } from '../src/sim/generate'
import { GOODS, inventory, population } from '../src/sim/types'
import { withSimulationPeriod } from '../src/sim/simulation-period'
import { reinforceArmies } from '../src/sim/military-personnel'
import { ensureWarfare } from '../src/sim/navy'
import { auditLedger } from '../src/sim/ledger'
import { auditBanks } from '../src/sim/banking'
import { auditGoods } from '../src/sim/goods-accounting'
import { rebaseEndowments } from './fixtures/endowment'
import { ensureFirms, investProductiveCapital, regionalFirms, retailDecay } from '../src/sim/firms'

test('food demand saturates without exceeding the budget or changing poor households’ subsistence priority', () => {
  const prices = inventory(100),
    subsistence = inventory(2)
  const cost = (basket: ReturnType<typeof inventory>) =>
    GOODS.reduce((s, g) => s + (basket[g] * prices[g]) / 1000, 0)
  const poor = withDecisionPolicy(DECISION_POLICIES.legacy, () => householdDemand(prices, subsistence, 0.1))
  withDecisionPolicy(DECISION_POLICIES.renewal, () => {
    assert.deepEqual(householdDemand(prices, subsistence, 0.1), poor)
    for (const budget of [0, 0.1, 1, 10, 10000]) {
      const demand = householdDemand(prices, subsistence, budget)
      assert(demand.food <= subsistence.food * 1.5)
      assert(Math.abs(cost(demand) - budget) < 1e-7)
      assert(GOODS.every((g) => demand[g] >= 0))
    }
  })
})

test('policy experiments restore the original configuration even on failure', () => {
  const before = decisionPolicy()
  assert.throws(() =>
    withDecisionPolicy(DECISION_POLICIES.renewal, () => {
      throw Error('experiment')
    }),
  )
  assert.equal(decisionPolicy(), before)
  assert.throws(() => withDecisionPolicy({ ...before, merchantRelease: NaN }, () => {}))
  assert.throws(() => withDecisionPolicy({ ...before, foodSatiation: 0.5 }, () => {}))
})

test('recruitment obligations follow domestic wages and retain monthly units at Max speed', () => {
  const w = generateWorld('nominal recruitment', 3, 4)
  withDecisionPolicy(DECISION_POLICIES.renewal, () => {
    const normal = recruitmentCost(w, 0)
    for (const f of Object.values(w.economy!.producers)) f.wage *= 0.01
    assert(Math.abs(recruitmentCost(w, 0) - normal * 0.01) < 1e-12)
    withSimulationPeriod(6, () => {
      beginEconomyMonth(w)
      assert(Math.abs(recruitmentCost(w, 0) - normal * 0.01) < 1e-12)
    })
  })
})

test('a small funded cadre uses real residents and supplies; an empty treasury cannot recruit', () => {
  const build = (funded: boolean) => {
    const w = generateWorld('small cadre', 3, 4)
    // Isolate recruitment, rebasing only the fixture endowments before accounting opens.
    w.armies = []
    for (const n of w.nations) {
      n.treasury = funded ? 10 : 0
      n.budget.military = 10
      n.policies.conscription = 2
      n.policies.military = 20
    }
    for (const r of w.regions) {
      r.foodCoverage = 1
      r.unrest = 0
      r.stocks.food = population(r)
      r.stocks.arms = 100
    }
    rebaseEndowments(w)
    beginEconomyMonth(w)
    ensureWarfare(w)
    const before = w.regions.reduce((s, r) => s + population(r), 0)
    withDecisionPolicy(DECISION_POLICIES.renewal, () => reinforceArmies(w))
    assert.equal(
      w.regions.reduce((s, r) => s + population(r), 0) + w.armies.reduce((s, a) => s + a.soldiers, 0),
      before,
    )
    auditLedger(w)
    auditBanks(w)
    auditGoods(w)
    return w
  }
  assert(build(true).armies.some((a) => a.soldiers >= 20))
  assert.equal(build(false).armies.length, 0)
})

test('retail preserves a bounded workshop-input buffer, while food remains available to residents', () => {
  const w = generateWorld('working inventory', 3, 4),
    r = w.regions[0]
  r.stocks = inventory(1)
  r.prices = inventory(0.01)
  for (const firm of regionalFirms(w, r.id)) firm.stocks = inventory()
  const merchant = w.economy!.producers[r.id]
  merchant.inputTargets = inventory(100)
  beginEconomyMonth(w)
  withDecisionPolicy(DECISION_POLICIES.renewal, () => consumeHouseholds(w))
  for (const g of ['timber', 'iron', 'coal', 'tools'] as const) {
    assert(r.stocks[g] >= 0.5 * (1 - retailDecay(g)) - 1e-9, `${g} must retain working inputs`)
    assert(r.consumption[g] > 0, `${g} must still be sold to households`)
  }
  assert(r.stocks.food < 1e-9, 'workshops cannot withhold food from hungry residents')
  auditLedger(w)
  auditBanks(w)
  auditGoods(w)
})

test('early investment counts inventory-backed retail forecasts without counting sold or absent goods twice', () => {
  const projects = (stock: number, sold: number, costs: number) => {
    const w = generateWorld('retail investment', 3, 4)
    ensureFirms(w)
    const r = w.regions.find((r) => regionalFirms(w, r.id).length > 0)!,
      f = regionalFirms(w, r.id)[0]
    r.stocks = inventory(1000)
    f.stocks = inventory()
    f.stocks.textiles = stock
    rebaseEndowments(w)
    beginEconomyMonth(w)
    f.forecast = inventory()
    f.forecast.textiles = 1000
    f.prices.textiles = 10
    f.sold.textiles = sold
    f.sales = 0
    f.purchases = costs
    f.employment = f.desiredEmployment = 100
    w.economy!.households[r.id].artisan.laborForce = 100
    withDecisionPolicy(DECISION_POLICIES.dynamic, () => investProductiveCapital(w))
    auditLedger(w)
    auditBanks(w)
    auditGoods(w)
    return f.projects.length
  }
  assert(projects(1000, 0, 0) > 0, 'stock available for profitable retail can fund capital')
  assert.equal(projects(0, 0, 0), 0, 'a forecast without goods cannot justify returns')
  assert.equal(projects(1000, 1000, 0), 0, 'fulfilled forecasts cannot be counted again')
  assert.equal(projects(1000, 0, 20), 0, 'expected revenue must still cover operating costs')
})
