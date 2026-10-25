import test from 'node:test'
import assert from 'node:assert/strict'
import { matchJobs, bargainWage, retainedJobs, reservationWage } from '../src/sim/labor-market'
import { newMonetaryPolicy, observePrices, policyRate, realFinancingRate } from '../src/sim/monetary-policy'
import { generateWorld } from '../src/sim/generate'
import { beginEconomyMonth } from '../src/sim/macroeconomy'
import { hireFirms, regionalFirms, finishFirms, WAGE_SKILL } from '../src/sim/firms'
import { auditBanks, settleBanks, updateMonetaryPolicy } from '../src/sim/banking'
import {
  auditLedger,
  borrow,
  firmAccount,
  householdAccount,
  producerAccount,
  transfer,
} from '../src/sim/ledger'
import { validateWorld } from '../src/sim/persistence'
import { STRATA } from '../src/sim/economic-types'
import { GOODS } from '../src/sim/types'

const near = (a: number, b: number) =>
  assert(Math.abs(a - b) < 1e-7 * Math.max(1, Math.abs(a)), `${a} != ${b}`)
const fixture = () => generateWorld('Labor monetary contracts', 3, 4)

test('matching has constant returns, respects both pools, and leaves frictional vacancies', () => {
  const m = matchJobs(100, 100, 0.65)
  near(m, 65)
  near(matchJobs(1000, 1000, 0.65), 10 * m)
  near(matchJobs(0, 100, 0.65), 0)
  near(matchJobs(100, 0, 0.65), 0)
  assert(matchJobs(2, 1000, 0.65) <= 2)
  assert(matchJobs(1000, 2, 0.65) <= 2)
  near(retainedJobs(100, 120, 0.015), 98.5)
  near(retainedJobs(100, 60, 0.015), 60)
})
test('wage bargaining is nominal-scale invariant and reacts to productivity and bargaining power', () => {
  const w = bargainWage(2, 1, 4, 0.5, 1 / 12)
  near(bargainWage(200, 100, 400, 0.5, 1 / 12), w * 100)
  assert(bargainWage(2, 1, 5, 0.5, 1 / 12) > w)
  assert(bargainWage(2, 1, 4, 0.1, 1 / 12) < w)
  assert(bargainWage(0.000001, 0.0000001, 0.000002, 0.5, 1 / 12) < 0.00005)
})
test('reservation compensation follows actual consumption, not unfunded subsistence income', () => {
  near(reservationWage(1, 1, 0.65, 2), 0.65)
  near(reservationWage(1, 0.5, 0.65, 2), 0.1625)
  near(reservationWage(1, 0, 0.65, 2), 0)
  near(reservationWage(100, 0.5, 0.65, 2), 100 * reservationWage(1, 0.5, 0.65, 2))
})
test('persistent firm contracts survive month opening; only paid workers enter household employment', () => {
  const w = fixture(),
    r = w.regions[0]
  beginEconomyMonth(w)
  hireFirms(w, r)
  const firms = regionalFirms(w, r.id).filter((f) => f.active)
  const old = firms.map((f) => f.employment)
  assert(old.some((n) => n > 0))
  beginEconomyMonth(w)
  assert.deepEqual(
    firms.map((f) => f.employment),
    old,
  )
  hireFirms(w, r)
  for (const [i, f] of firms.entries()) {
    near(f.labor!.opening, old[i])
    near(f.labor!.opening - f.labor!.separations + f.labor!.hires, f.employment)
    near(f.labor!.vacancies, f.labor!.hires + f.labor!.unfilled)
  }
  const households = w.economy!.households[r.id]
  near(
    STRATA.reduce((sum, s) => sum + households[s].employed, 0),
    firms.reduce((sum, f) => sum + f.employment, 0),
  )
  for (const s of STRATA) assert(households[s].employed <= households[s].laborForce + 1e-7)
  auditBanks(w)
  auditLedger(w)
})
test('unfunded firms lay off workers without manufacturing wages or employment', () => {
  const w = fixture(),
    r = w.regions[0]
  beginEconomyMonth(w)
  const firms = regionalFirms(w, r.id).filter((f) => f.active)
  for (const f of firms) {
    f.employment = 100
    for (const g of GOODS) f.forecast[g] = 0
    transfer(w, firmAccount(f.id), householdAccount(r.id, 'owner'), f.cash, 'test withdrawal')
  }
  hireFirms(w, r)
  for (const f of firms) {
    near(f.employment, 0)
    near(f.payroll, 0)
    near(f.labor!.separations, 100)
  }
  auditLedger(w)
  auditBanks(w)
})
test('policy uses a rolling price window, annual/monthly units, and no upper-rate cap', () => {
  const p = newMonetaryPolicy(0)
  for (let i = 0; i < 12; i++) observePrices(p, 0.06 / 12)
  near(p.inflation, 0.06)
  observePrices(p, 0.06 / 12)
  assert.equal(p.logChanges.length, 12)
  const normal = policyRate(0.04, 0.02, 0.04, p)
  near(normal, 0.04)
  assert(policyRate(0.04, 0.08, 0.04, p) > normal)
  assert(policyRate(0.04, 0.02, 0.1, p) < normal)
  assert(policyRate(0.5, 0.5, 0.04, p) > 0.144)
  assert(realFinancingRate(0.01, 0.02) > realFinancingRate(0.002, 0.02))
})
test('floating loans reprice on contract dates; legacy fixed loans and accounting survive', () => {
  const w = fixture(),
    e = w.economy!
  const a = producerAccount(0),
    b = producerAccount(1)
  borrow(w, a, 10, 100)
  borrow(w, b, 10, 100)
  const floating = e.credit.loans.find((l) => l.borrower === a)!
  const fixed = e.credit.loans.find((l) => l.borrower === b)!
  fixed.rateType = 'fixed'
  const old = fixed.rate!
  e.banking!.centralBank.rate = 0.01
  w.month = 1
  settleBanks(w)
  near(floating.rate!, old)
  w.month = 3
  settleBanks(w)
  near(floating.rate!, 0.0115)
  near(fixed.rate!, old)
  assert.equal(floating.nextReset, 6)
  const outstanding = fixed.principal
  borrow(w, b, 10, 100)
  near(fixed.rate!, (outstanding * old + 10 * 0.0115) / (outstanding + 10))
  auditLedger(w)
  auditBanks(w)
})
test('policy announcement is idempotent within a completed month and malformed policy saves are rejected', () => {
  const w = fixture()
  w.month = 1
  w.economy!.totals.priceIndex = 1.01
  updateMonetaryPolicy(w)
  const first = JSON.stringify(w.economy!.banking)
  updateMonetaryPolicy(w)
  assert.equal(JSON.stringify(w.economy!.banking), first)
  const malformed = structuredClone(w)
  malformed.economy!.banking!.policy!.inertia = 1
  assert.throws(() => validateWorld(malformed), /monetary policy/)
})

test('a higher real financing cost stops otherwise funded low-return investment', () => {
  const projects = (rate: number) => {
    const w = fixture(),
      r = w.regions[0]
    beginEconomyMonth(w)
    const f = regionalFirms(w, r.id)[0]
    w.economy!.banking!.centralBank.rate = rate
    f.employment = f.desiredEmployment = 100
    const unitCost =
      (300 * r.prices.timber + 400 * r.prices.stone + 40 * r.prices.tools) / 1000 +
      1000 * f.wage * WAGE_SKILL.artisan
    f.sales = Math.max(unitCost, f.capital * unitCost) * 0.01
    w.economy!.households[r.id].artisan.laborForce = 100
    finishFirms(w)
    auditLedger(w)
    auditBanks(w)
    return f.projects.length
  }
  assert(projects(0) > 0)
  assert.equal(projects(0.03), 0)
})
