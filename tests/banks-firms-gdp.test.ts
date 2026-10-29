import { investProductiveCapital } from '../src/sim/firms'
import { rebaseEndowments } from './fixtures/endowment'
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { tick, applyCommand } from '../src/sim/engine'
import { inventory } from '../src/sim/types'
import { BASE_PRICE } from '../src/sim/economy'
import { accountBank, auditBanks, payBank, bankDistribution, writeDownLoan } from '../src/sim/banking'
import { auditLedger, balances, borrow, producerAccount, householdAccount, transfer } from '../src/sim/ledger'
import {
  ensureFirms,
  regionalFirms,
  hireFirms,
  restockMarket,
  finishFirms,
  retailMarkup,
} from '../src/sim/firms'
import { beginEconomyMonth, consumeHouseholds } from '../src/sim/macroeconomy'
import {
  beginNationalAccounts,
  marketStore,
  inventoryQuote,
  recordProduction,
  recordGoodsSale,
  recordTransport,
  recordGift,
  firmStore,
  reconcileGDP,
} from '../src/sim/national-accounts'
import { validateWorld, parseSave } from '../src/sim/persistence'

const fixture = () => generateWorld('financial-contract', 3, 4)
const money = (w: ReturnType<typeof fixture>) => Object.values(balances(w)).reduce((a, b) => a + b, 0)
const near = (a: number, b: number) => assert(Math.abs(a - b) < 1e-6, `${a} != ${b}`)

test('loan origination creates matching deposits; principal repayment destroys both', () => {
  const w = fixture(),
    account = producerAccount(0),
    before = money(w),
    bank = accountBank(w, account)
  const reserves = bank.reserves,
    equity = bank.equity
  near(borrow(w, account, 100, 100), 100)
  near(money(w), before + 100)
  near(bank.reserves, reserves)
  near(bank.equity, equity)
  const loan = w.economy!.credit.loans.find((l) => l.borrower === account)!
  loan.principal -= payBank(w, account, loan.bank!, 100, 'test principal')
  near(money(w), before)
  near(loan.principal, 0)
  auditLedger(w)
  auditBanks(w)
})
test('cross-bank deposits settle in reserves, including collateralized central-bank liquidity', () => {
  const w = fixture(),
    from = producerAccount(0),
    a = accountBank(w, from)
  const to = Object.keys(balances(w)).find((k) => k !== 'credit' && accountBank(w, k) !== a)!,
    b = accountBank(w, to)
  const oldA = a.reserves,
    oldB = b.reserves
  transfer(w, from, to, 10, 'interbank settlement')
  near(a.reserves, oldA - 10)
  near(b.reserves, oldB + 10)
  // Move the remaining reserve stock to another bank through actual account payments.
  for (const [account, id] of Object.entries(w.economy!.banking!.accounts))
    if (id === a.id) transfer(w, account, to, balances(w)[account] ?? 0, 'deposit outflow')
  const available =
    a.equity / 0.1 -
    w.economy!.credit.loans.filter((l) => l.bank === a.id).reduce((s, l) => s + l.principal, 0)
  const credit = borrow(w, from, available * 0.5, available)
  assert(credit > a.reserves)
  transfer(w, from, to, credit, 'new loan spent at another bank')
  assert(a.centralBankDebt > 0)
  near(w.economy!.banking!.centralBank.advances, a.centralBankDebt)
  auditLedger(w)
  auditBanks(w)
})
test('bank capital limits new credit without treating existing deposits as a lending pool', () => {
  const w = fixture(),
    borrower = producerAccount(0),
    bank = accountBank(w, borrower)
  const capacity = bank.equity / 0.1,
    reserves = bank.reserves
  near(borrow(w, borrower, capacity * 2, capacity * 2), capacity)
  near(borrow(w, borrower, 1, capacity * 2), 0)
  near(bank.reserves, reserves)
  auditLedger(w)
  auditBanks(w)
})
test('interest and bank dividends change deposits through matched equity entries', () => {
  const w = fixture(),
    account = producerAccount(0),
    bank = accountBank(w, account),
    initial = money(w),
    equity = bank.equity
  payBank(w, account, bank.id, 1, 'interest', true)
  near(money(w), initial - 1)
  near(bank.equity, equity + 1)
  bankDistribution(w, bank, householdAccount(0, 'owner'), 1, 'dividend')
  near(money(w), initial)
  near(bank.equity, equity)
  auditLedger(w)
})
test('bank failure writes down loans and converts deposit claims into explicit ownership', () => {
  const w = fixture(),
    account = producerAccount(0),
    bank = accountBank(w, account)
  const principal = bank.equity * 2
  borrow(w, account, principal, principal)
  const loan = w.economy!.credit.loans.find((l) => l.borrower === account)!,
    before = money(w)
  writeDownLoan(w, loan, principal)
  near(bank.income, -principal)
  assert.equal(bank.resolutions, 1)
  assert(bank.equity >= -1e-7)
  assert(money(w) < before)
  assert(Object.keys(bank.owners).length > 0)
  near(loan.principal, 0)
  auditLedger(w)
  auditBanks(w)
})
test('a failed bank with exhausted deposits recognizes losses on its central-bank creditor', () => {
  const w = fixture(),
    from = producerAccount(0),
    bank = accountBank(w, from)
  const to = Object.keys(balances(w)).find((k) => k !== 'credit' && accountBank(w, k) !== bank)!
  for (const [account, id] of Object.entries(w.economy!.banking!.accounts))
    if (id === bank.id) transfer(w, account, to, balances(w)[account] ?? 0, 'outflow')
  const principal = bank.equity * 9
  borrow(w, from, principal, principal)
  transfer(w, from, to, principal, 'credit spent outside lending bank')
  const cb = w.economy!.banking!.centralBank,
    equity = cb.equity
  writeDownLoan(
    w,
    w.economy!.credit.loans.find((l) => l.borrower === from)!,
    principal,
  )
  near(bank.equity, 0)
  assert(cb.equity < equity)
  assert.equal(bank.resolutions, 1)
  auditLedger(w)
  auditBanks(w)
})
test('a cash-starved zero-output firm exits and an owner-funded successor can enter', () => {
  const w = fixture()
  w.month = 1
  beginEconomyMonth(w)
  const f = regionalFirms(w, 0)[0],
    before = money(w)
  transfer(w, `firm:${f.id}`, householdAccount(0, 'owner'), f.cash, 'exhausted firm funds')
  f.desiredEmployment = 100
  f.employment = 0
  f.distress = 17
  finishFirms(w)
  assert.equal(f.active, false)
  assert.equal(w.economy!.firmExits, 1)
  near(money(w), before)
  auditLedger(w)
  reconcileGDP(w)
  w.month = 12
  beginEconomyMonth(w)
  finishFirms(w)
  assert.equal(f.active, true)
  assert.equal(f.generation, 1)
  assert(f.cash > 0)
  auditLedger(w)
  reconcileGDP(w)
})
test('firms compete on price and cannot hire the same worker twice', () => {
  const w = fixture()
  beginEconomyMonth(w)
  const r = w.regions[0],
    firms = regionalFirms(w, 0).filter((f) => f.active)
  const before = Object.values(w.economy!.households[0]).reduce((s, h) => s + h.cash, 0)
  hireFirms(w, r)
  for (const h of Object.values(w.economy!.households[0])) assert(h.employed <= h.laborForce + 1e-8)
  assert(firms.some((f) => f.employment > 0))
  assert(new Set(firms.map((f) => f.wage)).size > 1)
  assert(Object.values(w.economy!.households[0]).reduce((s, h) => s + h.cash, 0) > before)
  // Isolate a known competing offer pair and order exactly one tonne.
  delete w.economy!.accounts
  r.stocks.food = 0
  for (const f of firms) f.stocks.food = 0
  firms[0].stocks.food = 1
  firms[0].prices.food = 100
  firms[1].stocks.food = 1
  firms[1].prices.food = 1
  w.economy!.producers[0].cash = 0.001
  for (const bank of w.economy!.banking!.banks) bank.equity = 0
  rebaseEndowments(w)
  restockMarket(w, r)
  near(firms[1].stocks.food, 0)
  near(firms[0].stocks.food, 1)
})
test('product-specific plans retain food work despite unsold arms', () => {
  const w = fixture()
  beginEconomyMonth(w)
  const r = w.regions[0],
    firms = regionalFirms(w, 0)
  for (const f of firms) {
    f.stocks.arms = 1e9
    f.stocks.food = 0
  }
  hireFirms(w, r)
  for (const f of firms.filter((f) => f.active)) {
    assert(f.laborMix!.food > 0)
    near(f.laborMix!.arms, 0)
  }
})
test('funded households can buy available firm food when their wholesaler has no cash', () => {
  const w = fixture()
  w.regions[0].prices = { ...BASE_PRICE }
  beginEconomyMonth(w)
  const r = w.regions[0],
    firm = regionalFirms(w, r.id)[0]
  const food = r.stocks.food
  firm.prices.food = r.prices.food
  recordGift(w, marketStore(r.id), firmStore(firm.id), 'food', food)
  firm.stocks.food += food
  r.stocks.food = 0
  // Matching the merchant's selling offer includes its markup. The gift keeps
  // acquisition cost, so the factory must explicitly quote its own stock first.
  inventoryQuote(w, firmStore(firm.id), 'food', firm.prices.food / 1000)
  transfer(
    w,
    producerAccount(r.id),
    householdAccount(r.id, 'owner'),
    w.economy!.producers[r.id].cash,
    'empty wholesaler',
  )
  const before = money(w),
    created = w.economy!.banking!.created,
    firmCash = firm.cash
  consumeHouseholds(w)
  assert(r.foodCoverage > 0)
  assert(firm.cash > firmCash)
  assert(firm.stocks.food < food)
  near(w.economy!.banking!.created, created)
  near(money(w), before)
  auditLedger(w)
  auditBanks(w)
  reconcileGDP(w)
})
test('retail quotes recover reserve spoilage and inventory financing before their trading margin', () => {
  const w = fixture(),
    r = w.regions[0]
  r.plannedProduction = inventory()
  w.economy!.producers[r.id].forecast.food = 0
  near(retailMarkup(w, r, 'food'), 0.04 + 2.4 * 0.035 + 3.4 * 0.003)
})
test('construction cannot overdraw a limiting stock through floating-point multiplication', () => {
  const w = fixture(),
    r = w.regions[0]
  r.prices = { ...BASE_PRICE }
  r.stocks.timber = 0.1
  beginEconomyMonth(w)
  const firm = regionalFirms(w, 0)[0]
  firm.employment = firm.desiredEmployment = 100
  // Investment now also needs a positive return above its financing cost.
  firm.sales = 1
  w.economy!.households[0].artisan.laborForce = 100
  investProductiveCapital(w)
  finishFirms(w)
  assert(firm.projects.length > 0)
  assert.equal(r.stocks.timber, 0)
  assert(r.consumption.timber <= 0.1)
  reconcileGDP(w)
  auditLedger(w)
})
test('inventory revaluation is a holding gain, not production, expenditure or income', () => {
  const w = fixture(),
    r = w.regions[0]
  r.stocks = inventory()
  r.stocks.food = 10
  r.prices.food = 2000
  beginNationalAccounts(w)
  inventoryQuote(w, marketStore(r.id), 'food', 3)
  const result = reconcileGDP(w)!
  near(result.productionGDP, 0)
  near(result.expenditureGDP, 0)
  near(result.incomeGDP, 0)
  near(result.holdingGains, 10)
})
test('production, final sales and unsold output reconcile independently', () => {
  const w = fixture(),
    r = w.regions[0]
  r.stocks = inventory()
  beginNationalAccounts(w)
  r.stocks.food = 10
  recordProduction(w, marketStore(r.id), 'food', 10, 2)
  recordGoodsSale(w, marketStore(r.id), 'food', 3, 6, { kind: 'household', nation: r.nation })
  r.stocks.food -= 3
  const result = reconcileGDP(w)!
  near(result.productionGDP, 20)
  near(result.consumption, 6)
  near(result.inventoryChange, 14)
  near(result.incomeGDP, 20)
  w.economy!.accounts!.nations[r.nation].output += 1
  assert.throws(() => reconcileGDP(w), /GDP approaches disagree/)
})
test('inventory carried into the next month retains acquisition cost and recognizes the retail margin on sale', () => {
  const w = fixture(),
    r = w.regions[0]
  r.stocks = inventory()
  beginNationalAccounts(w)
  r.stocks.food = 10
  recordProduction(w, marketStore(r.id), 'food', 10, 2)
  reconcileGDP(w)
  r.prices.food = 2080
  w.month++
  beginNationalAccounts(w)
  recordGoodsSale(w, marketStore(r.id), 'food', 3, 6.24, { kind: 'household', nation: r.nation })
  r.stocks.food -= 3
  const result = reconcileGDP(w)!
  near(result.productionGDP, 0.24)
  near(result.expenditureGDP, 0.24)
  near(result.incomeGDP, 0.24)
  near(result.holdingGains, 0)
})
test('imports capitalize freight and tariffs while exports and imports cancel globally', () => {
  const w = fixture(),
    a = w.regions[0],
    b = w.regions.find((r) => r.nation !== a.nation)!
  a.stocks = inventory()
  b.stocks = inventory()
  a.stocks.food = 10
  a.prices.food = 2000
  beginNationalAccounts(w)
  recordGoodsSale(
    w,
    marketStore(a.id),
    'food',
    1,
    2,
    { kind: 'business', nation: b.nation, account: producerAccount(b.id), store: marketStore(b.id) },
    0.7,
  )
  recordTransport(w, a.id, b.id, 0.5, 0.2)
  a.stocks.food--
  b.stocks.food++
  const result = reconcileGDP(w)!
  near(result.productionGDP, 0.7)
  near(result.expenditureGDP, 0.7)
  near(result.incomeGDP, 0.7)
  near(result.exports, result.imports)
  near(result.productTaxes, 0.2)
  near(result.mixedIncome, 0.5)
})
test('missing physical entries, manipulated banks and manipulated GDP are rejected', () => {
  const w = fixture()
  tick(w)
  const altered = structuredClone(w)
  altered.economy!.banking!.banks[0].equity += 10
  assert.throws(() => validateWorld(altered), /bank balance sheet/)
  const changed = structuredClone(w)
  changed.economy!.accounts!.world.consumption += 10
  assert.throws(() => validateWorld(changed), /GDP reconciliation/)
  for (const key of ['expenditureGDP', 'incomeGDP'] as const) {
    const corrupted = structuredClone(w)
    corrupted.economy!.accounts!.world[key] += 10
    assert.throws(() => validateWorld(corrupted), /GDP reconciliation/)
  }
  const falsified = structuredClone(w)
  falsified.economy!.accounts!.world.holdingGains += 10
  assert.throws(() => validateWorld(falsified), /GDP aggregation/)
  const malformed = structuredClone(w)
  Object.values(malformed.economy!.accounts!.businesses)[0].receipts = 'not a number' as never
  assert.throws(() => validateWorld(malformed), /GDP business records/)
  w.regions[0].stocks.food += 10
  assert.throws(() => validateWorld(w), /Unrecorded inventory/)
  assert.throws(() => reconcileGDP(w), /Unrecorded inventory/)
})
test('firms, banks and GDP survive deterministic save continuation and paid construction', () => {
  const w = fixture()
  ensureFirms(w)
  for (let i = 0; i < 6; i++) tick(w)
  const copy = parseSave(JSON.stringify(w))
  tick(w)
  tick(copy)
  assert.deepEqual(w, copy)
  applyCommand(w, { type: 'build', region: w.nations[0].capital, building: 'industry' })
  reconcileGDP(w)
  auditLedger(w)
  validateWorld(w)
})
