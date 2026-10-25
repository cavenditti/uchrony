import { rebaseEndowments } from './fixtures/endowment'
import { ensureFirms, regionalFirms } from '../src/sim/firms'
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { tick, applyCommand } from '../src/sim/engine'
import { produce, reserveTarget, consume, trade, BASE_PRICE } from '../src/sim/economy'
import {
  beginEconomyMonth,
  fundGovernment,
  settleCredit,
  finishProduction,
  householdDemand,
  hireLabor,
  finishEconomyMonth,
  collectedTaxRate,
} from '../src/sim/macroeconomy'
import { auditGoods } from '../src/sim/goods-accounting'
import { advanceEconomicStrata, communitySize } from '../src/sim/population'
import {
  ensureEconomy,
  transfer,
  balances,
  auditLedger,
  borrow,
  householdAccount,
  producerAccount,
  stratumPeople,
} from '../src/sim/ledger'
import { STRATA } from '../src/sim/economic-types'
import { ensureAges, refreshAges, extractAges, mergeAges, cohortBirths } from '../src/sim/age-cohorts'
import { MODEL_PARAMETERS as P } from '../src/sim/model-parameters'
import { validateWorld, parseSave } from '../src/sim/persistence'
import { GOODS, inventory } from '../src/sim/types'
const fixture = () => generateWorld('economic-model-contract', 3, 4)
const cash = (w: ReturnType<typeof fixture>) => Object.values(balances(w)).reduce((a, b) => a + b, 0)

test('every payment has a counterparty, cannot overdraw, and reconciles after save restoration', () => {
  const w = fixture(),
    e = ensureEconomy(w),
    before = cash(w),
    from = producerAccount(0),
    to = householdAccount(0, 'laborer'),
    available = e.producers[0].cash
  const paid = transfer(w, from, to, available * 2, 'test wages')
  assert.equal(paid, available)
  assert.equal(e.producers[0].cash, 0)
  assert(Math.abs(cash(w) - before) < 1e-7)
  assert(auditLedger(w) < 1e-7)
  assert.throws(() => transfer(w, from, to, NaN, 'bad amount'))
  validateWorld(w)
  assert.deepEqual(parseSave(JSON.stringify(w)), w)
})
test('bank credit creates deposits and default records a corresponding lender loss', () => {
  const w = fixture(),
    e = ensureEconomy(w)
  rebaseEndowments(w)
  const initial = cash(w)
  const loan = borrow(w, producerAccount(0), 100, 100)
  assert.equal(loan, 100)
  assert.equal(e.credit.cash, 0)
  assert(Math.abs(cash(w) - initial - 100) < 1e-7)
  transfer(w, producerAccount(0), householdAccount(0, 'owner'), e.producers[0].cash, 'funds exhausted')
  for (let i = 0; i < P.defaultAfterMonths; i++) settleCredit(w)
  assert.equal(e.credit.losses, 65)
  assert.equal(e.credit.loans[0].principal, 35)
  assert(Math.abs(cash(w) - initial - e.banking!.created + e.banking!.destroyed) < 1e-7)
  auditLedger(w)
})
test('cash changes and unpaired sovereign debt cannot be smuggled through a save', () => {
  const w = fixture()
  w.nations[0].treasury += 1
  assert.throws(() => validateWorld(w), /unrecorded cash/)
  const v = fixture()
  v.nations[0].debt += 100
  assert.throws(() => validateWorld(v), /matching asset/)
})
test('a newborn cohort enters adulthood on its actual eighteenth birthday', () => {
  const g = structuredClone(fixture().regions[0].communities![0])
  g.ageCohorts = [[0, 50, 50]]
  g.ageMonth = 0
  refreshAges(g, 0)
  for (let month = 1; month < 216; month++) {
    refreshAges(g, month)
    assert.equal(g.population.adults, 0)
    assert.equal(g.population.children, 100)
  }
  refreshAges(g, 216)
  assert.equal(g.population.adults, 100)
  assert.equal(g.population.children, 0)
  refreshAges(g, 780)
  assert.equal(g.population.elders, 100)
})
test('population splits and reunions retain every birth month and sex', () => {
  const g = structuredClone(fixture().regions[0].communities![0])
  ensureAges(g, 0)
  const before = structuredClone(g),
    part = extractAges(g, { children: 17, adults: 29, elders: 5 })
  mergeAges(g, part)
  assert.deepEqual(g.population, before.population)
  assert.deepEqual(
    [...g.ageCohorts!].sort((a, b) => a[0] - b[0]),
    [...before.ageCohorts!].sort((a, b) => a[0] - b[0]),
  )
})
test('births require reproductive-age women and cannot come from male-only or elderly cohorts', () => {
  const g = structuredClone(fixture().regions[0].communities![0]),
    rng = { rng: 71 }
  g.ageCohorts = [[-300, 0, 100000]]
  refreshAges(g, 0)
  assert.equal(cohortBirths(g, 0, rng, 0), 0)
  g.ageCohorts = [[-900, 100000, 0]]
  refreshAges(g, 0)
  assert.equal(cohortBirths(g, 0, rng, 0), 0)
  g.ageCohorts = [[-300, 100000, 0]]
  refreshAges(g, 0)
  assert(cohortBirths(g, 0, rng, 0) > 0)
})
test('economic strata coexist within the same cultural identity and own separate balances', () => {
  const w = fixture(),
    groups = w.regions[0].communities!,
    first = groups[0]
  assert.equal(
    new Set(
      groups
        .filter(
          (g) =>
            g.culture === first.culture &&
            g.language === first.language &&
            g.belief === first.belief &&
            g.movement === first.movement,
        )
        .map((g) => g.stratum),
    ).size,
    5,
  )
  const e = ensureEconomy(w)
  assert.notEqual(
    e.households[0].owner.cash / stratumPeople(w, 0, 'owner'),
    e.households[0].laborer.cash / stratumPeople(w, 0, 'laborer'),
  )
})
test('an input-starved factory continues ordering materials for its planned production', () => {
  const w = fixture(),
    r = w.regions[w.nations[0].capital]
  r.deposits.iron = 0
  r.deposits.coal = 0
  r.stocks.iron = 0
  r.stocks.coal = 0
  r.industry = 1.7
  produce(w)
  assert.equal(r.production.tools, 0)
  assert(r.plannedProduction!.tools > 0)
  const target = reserveTarget(r, 'iron')
  const planned = r.plannedProduction
  r.plannedProduction = inventory()
  assert(target > reserveTarget(r, 'iron'))
  r.plannedProduction = planned
})
test('an unfunded welfare appropriation pays nothing at any policy weight', () => {
  const a = fixture(),
    b = structuredClone(a)
  for (const w of [a, b]) {
    const e = ensureEconomy(w)
    for (const bank of e.banking!.banks) bank.equity = 0
    for (const n of w.nations) {
      n.treasury = 0
      n.income = 0
      n.policies.welfare = 0
    }
    rebaseEndowments(w)
  }
  b.nations[0].policies.welfare = 80
  fundGovernment(a)
  fundGovernment(b)
  assert.equal(a.nations[0].budget.welfare, 0)
  assert.equal(b.nations[0].budget.welfare, 0)
  assert.deepEqual(a.economy!.households, b.economy!.households)
  auditLedger(a)
  auditLedger(b)
})
test('the same available food produces different deprivation when household purchasing power differs', () => {
  const w = fixture(),
    e = ensureEconomy(w),
    r = w.regions[0]
  for (const g of GOODS) {
    r.stocks[g] = 1e7
    r.prices[g] = BASE_PRICE[g]
  }
  e.households[0].laborer.cash = 0
  e.households[0].laborer.income = 0
  e.households[0].owner.cash = 1e6
  rebaseEndowments(w)
  consume(w)
  assert.equal(e.households[0].laborer.foodCoverage, 0)
  assert.equal(e.households[0].owner.foodCoverage, 1)
  auditLedger(w)
})
test('the linear expenditure rule never spends more than the household budget', () => {
  const minimum = { ...inventory(), food: 10, tools: 1, textiles: 2 }
  for (const budget of [0, 0.01, 0.1, 1, 100]) {
    const d = householdDemand(BASE_PRICE, minimum, budget)
    const spent = GOODS.reduce((s, g) => s + (d[g] * BASE_PRICE[g]) / 1000, 0)
    assert(Math.abs(spent - budget) < 1e-8)
  }
})
test('domestic trade transfers purchasing funds as well as physical goods', () => {
  const w = fixture(),
    e = ensureEconomy(w),
    buyer = w.regions.find((r) => r.neighbors.some((id) => w.regions[id].nation === r.nation))!,
    seller = w.regions[buyer.neighbors.find((id) => w.regions[id].nation === buyer.nation)!]
  for (const r of w.regions) {
    r.stocks.food = reserveTarget(r, 'food')
    r.prices.food = 14
  }
  buyer.stocks.food = 0
  seller.stocks.food += 1e6
  for (const f of Object.values(e.producers)) f.cash = 0
  rebaseEndowments(w)
  trade(w)
  assert.equal(
    w.routes.filter((r) => r.to === buyer.id).reduce((s, r) => s + r.goods.food, 0),
    0,
  )
  e.producers[buyer.id].cash = 1000
  rebaseEndowments(w)
  trade(w)
  assert(w.routes.some((r) => r.from === seller.id && r.to === buyer.id && r.goods.food > 0))
  assert(e.producers[buyer.id].cash < 1000)
  auditLedger(w)
})
test('nominal valuation changes do not masquerade as real output growth', () => {
  const w = fixture(),
    r = w.regions[0]
  r.production = { ...inventory(), food: 100, tools: 10 }
  r.prices = { ...BASE_PRICE }
  finishProduction(w, r)
  const nominal = r.gdp,
    real = w.economy!.producers[r.id].realOutput
  for (const g of GOODS) r.prices[g] *= 2
  finishProduction(w, r)
  assert.equal(r.gdp, nominal * 2)
  assert.equal(w.economy!.producers[r.id].realOutput, real)
})
test('industrial investment is queued and unfunded capacity does not grow automatically', () => {
  const w = fixture(),
    r = w.regions[w.nations[0].capital],
    before = r.industry
  applyCommand(w, { type: 'build', region: r.id, building: 'industry' })
  assert.equal(r.industry, before)
  assert.equal(w.economy!.producers[r.id].projects.length, 1)
  for (let i = 0; i < P.constructionMonths - 1; i++) {
    w.month++
    beginEconomyMonth(w)
    assert(r.industry < before)
  }
  w.month++
  beginEconomyMonth(w)
  assert(r.industry > before)
})
test('twelve integrated months conserve people, money, claims and saved continuation', () => {
  const w = fixture(),
    initialCash = cash(w)
  for (let i = 0; i < 12; i++) {
    const before = w.totals.population
    tick(w)
    assert.equal(w.totals.population, before + w.totals.births - w.totals.deaths)
    assert(
      Math.abs(cash(w) - initialCash - w.economy!.banking!.created + w.economy!.banking!.destroyed) < 1e-6,
    )
    validateWorld(w)
  }
  const restored = parseSave(JSON.stringify(w))
  tick(w)
  tick(restored)
  assert.deepEqual(w, restored)
  for (const r of w.regions)
    for (const s of STRATA)
      assert(w.economy!.households[r.id][s].employed <= w.economy!.households[r.id][s].laborForce + 1e-7)
})

test('credit rationing produces unemployment rather than unpaid productive workers', () => {
  const w = fixture(),
    e = ensureEconomy(w),
    r = w.regions[0]
  ensureFirms(w)
  for (const bank of e.banking!.banks) bank.equity = 0
  for (const f of regionalFirms(w, 0)) f.cash = 0
  e.producers[0].cash = 0
  rebaseEndowments(w)
  beginEconomyMonth(w)
  assert.equal(hireLabor(w, r), 0)
  assert(STRATA.reduce((s, k) => s + e.households[0][k].laborForce, 0) > 0)
  assert.equal(
    STRATA.reduce((s, k) => s + e.households[0][k].income, 0),
    0,
  )
  auditLedger(w)
})
test('physical accounting detects missing goods and recognizes explicit observer shocks', () => {
  const w = fixture()
  tick(w)
  applyCommand(w, { type: 'disaster', region: 0, disaster: 'abundance' })
  auditGoods(w)
  applyCommand(w, { type: 'disaster', region: 0, disaster: 'drought' })
  auditGoods(w)
  w.regions[0].stocks.iron += 100
  assert.throws(() => auditGoods(w), /Unreconciled iron/)
})
test('occupational changes preserve the joint census and household cash', () => {
  const w = fixture(),
    before = w.regions.reduce((s, r) => s + r.communities!.reduce((p, g) => p + communitySize(g), 0), 0),
    money = cash(w)
  const original = w.regions[0]
    .communities!.filter((g) => g.stratum === 'laborer')
    .reduce((s, g) => s + communitySize(g), 0)
  for (const r of w.regions) {
    r.urban = 0.8
    for (const g of r.communities!) g.literacy = 0.9
  }
  for (let i = 0; i < 24; i++) advanceEconomicStrata(w)
  assert.equal(
    w.regions.reduce((s, r) => s + r.communities!.reduce((p, g) => p + communitySize(g), 0), 0),
    before,
  )
  assert(Math.abs(cash(w) - money) < 1e-6)
  assert.notEqual(
    w.regions[0]
      .communities!.filter((g) => g.stratum === 'laborer')
      .reduce((s, g) => s + communitySize(g), 0),
    original,
  )
  auditLedger(w)
  validateWorld(w)
})
test('cash-basis producer taxes deduct settled purchases rather than imaginary input payments', () => {
  const w = fixture()
  beginEconomyMonth(w)
  const f = w.economy!.producers[0]
  f.sales = 10
  f.purchases = 20
  f.payroll = 5
  finishEconomyMonth(w)
  assert.equal(f.profit, -10)
  assert.equal(f.taxes, 0)
})
test('a fully paid interest installment ends a consecutive arrears episode', () => {
  const w = fixture()
  borrow(w, producerAccount(0), 100, 100)
  const loan = w.economy!.credit.loans.find((l) => l.borrower === producerAccount(0))!
  loan.arrears = P.defaultAfterMonths - 1
  settleCredit(w)
  assert.equal(loan.arrears, 0)
  assert.equal(w.economy!.credit.losses, 0)
  auditLedger(w)
})
test('private construction pays and taxes labor without creating extra workers or funds', () => {
  const w = fixture(),
    r = w.regions[0],
    e = w.economy!
  r.stocks = inventory(1000)
  beginEconomyMonth(w)
  for (const f of regionalFirms(w, 0)) for (const g of GOODS) f.stocks[g] = 0
  // Reserve labor for construction, as occurs when ordinary production leaves spare capacity.
  for (const s of STRATA) e.households[0][s].laborForce = 1000
  const firm = regionalFirms(w, 0)[0]
  firm.employment = firm.desiredEmployment = 100
  // Positive operating returns are required by the investment financing hurdle.
  firm.sales = 1
  const h = e.households[0].artisan,
    income = h.income,
    taxes = h.taxes
  finishEconomyMonth(w)
  assert(firm.projects.length > 0)
  assert(h.income > income)
  assert(Math.abs(h.taxes - taxes - (h.income - income) * collectedTaxRate(w, r)) < 1e-9)
  assert(h.employed <= h.laborForce)
  auditLedger(w)
})
test('collection capacity changes actual tax withholding within the statutory ceiling', () => {
  const w = fixture(),
    r = w.regions[0],
    n = w.nations[r.nation]
  n.policies.tax = 40
  n.technologies.governance = 0
  n.stability = 20
  const low = collectedTaxRate(w, r)
  n.technologies.governance = 5
  n.stability = 99
  assert(collectedTaxRate(w, r) > low)
  assert(collectedTaxRate(w, r) <= 0.4)
  beginEconomyMonth(w)
  hireLabor(w, r)
  for (const s of STRATA) {
    const h = w.economy!.households[r.id][s]
    assert(Math.abs(h.taxes - h.income * collectedTaxRate(w, r)) < 1e-9)
  }
  auditLedger(w)
  r.plannedProduction = { ...inventory(), iron: -1 }
  assert.throws(() => validateWorld(w), /planned production/)
})
