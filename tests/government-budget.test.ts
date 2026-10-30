import test from 'node:test'
import assert from 'node:assert/strict'
import {
  developmentBudget,
  developmentCreditLimit,
  governmentDebtPayments,
} from '../src/sim/government-budget'
import { advanceDevelopment } from '../src/sim/development'
import { generateWorld } from '../src/sim/generate'
import { beginEconomyMonth, fundGovernment } from '../src/sim/macroeconomy'
import { borrow, governmentAccount } from '../src/sim/ledger'
import { scheduledLoanPayments, settleBanks, auditBanks } from '../src/sim/banking'
import { rebaseEndowments } from './fixtures/endowment'
import { withSimulationPeriod } from '../src/sim/simulation-period'

function fixture() {
  const w = generateWorld('government cash budget', 3, 4)
  for (const n of w.nations) n.ai = false
  const n = w.nations[0]
  n.ai = true
  n.income = 10
  n.treasury = 0
  rebaseEndowments(w)
  advanceDevelopment(w)
  return { w, n }
}

test('stimulus tapers before the actual credit ceiling and leaves cash for debt service', () => {
  const { w } = fixture()
  w.economy!.banking!.centralBank.rate = 0.02
  const limit = developmentCreditLimit(w, 10)
  assert(limit < 10 * 24, 'the old austerity threshold was beyond the lending ceiling')
  const fresh = developmentBudget(10, 0, 0, limit, 0, 0.3)
  const indebted = developmentBudget(10, 0, limit * 0.9, limit, 2, 0.3)
  assert(fresh > 10)
  assert.equal(indebted, 7)
  assert.equal(developmentBudget(0, 0, 10, 0, 2, 0.3), 0)
  assert.equal(developmentBudget(10, 0, 20, limit, 20, 0.3), 0)
  assert(
    developmentBudget(10, 1000, limit, limit, 2, 0.3) > indebted,
    'existing reserves may fund investment',
  )
})

test('tax-funded services do not take a loan before those taxes arrive', () => {
  const { w, n } = fixture()
  assert.equal(n.debt, 0)
  assert.equal(n.development!.borrowed, 0)
  n.treasury = n.development!.appropriation + 1
  rebaseEndowments(w)
  fundGovernment(w)
  assert.equal(n.debt, 0)
  assert.equal(n.development!.borrowed, 0)
})

test('public hiring leaves scheduled interest and principal in cash, including new loans', () => {
  const { w, n } = fixture()
  beginEconomyMonth(w)
  n.income = 10
  fundGovernment(w)
  assert(n.debt > 0)
  const due = governmentDebtPayments(w).get(n.id)!
  assert(n.treasury + 1e-9 >= due)
  const loan = w.economy!.credit.loans.find((l) => l.borrower === governmentAccount(0))!
  const principal = loan.principal,
    planned = scheduledLoanPayments(w, loan)
  settleBanks(w)
  assert.equal(loan.arrears, 0)
  assert(Math.abs(loan.principal - (principal - planned.principal)) < 1e-8)
  auditBanks(w)
})

test('budget quotes use an imminent floating-rate reset and the actual integration interval', () => {
  const { w } = fixture()
  borrow(w, governmentAccount(0), 20, 20)
  const loan = w.economy!.credit.loans.find((l) => l.borrower === governmentAccount(0))!
  loan.nextReset = w.month
  loan.spread = 0.002
  w.economy!.banking!.centralBank.rate = 0.01
  withSimulationPeriod(6, () => {
    const payment = scheduledLoanPayments(w, loan)
    assert(Math.abs(payment.interest - loan.principal * (1.012 ** 6 - 1)) < 1e-9)
    assert(Math.abs(payment.principal - loan.principal * (1 - (1 - 1 / 240) ** 6)) < 1e-9)
  })
})

test('observed weak tax receipts cannot be replaced by hypothetical payroll revenue', () => {
  const { w, n } = fixture()
  w.month = 10
  n.development!.revenue = 0
  n.development!.review = 60
  n.treasury = 0
  advanceDevelopment(w)
  assert.equal(n.development!.appropriation, 0)
  assert.equal(n.debt, 0)
})

test('a revenue collapse and prior spending constrain funding without waiting for the moving average', () => {
  const { w, n } = fixture()
  n.income = 1
  n.spending = 0.4
  n.treasury = 1
  rebaseEndowments(w)
  fundGovernment(w)
  assert(n.development!.appropriation <= 1.55 - 0.4 + 1e-9)
  assert(n.debt <= developmentCreditLimit(w, 1))
})

test('sustained unemployment cannot keep the budget borrowing at its ceiling', () => {
  let debt = 15,
    cash = 0
  for (let month = 0; month < 120; month++) {
    const payment = debt * (0.003 + 1 / 240)
    const budget = developmentBudget(1, cash, debt, 20, payment, 0.5)
    cash += 1
    const issued = Math.min(20 - debt, Math.max(0, budget + payment - cash))
    debt += issued
    cash += issued - budget - payment
    debt -= debt / 240
    assert(cash >= -1e-9)
    assert(debt < 20)
  }
  assert(debt < 15, 'an indebted government must amortize rather than borrow its full budget forever')
  assert(cash > 0)
})
