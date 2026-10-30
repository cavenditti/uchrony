import {
  withSimulationPeriod,
  simulationMonths,
  periodRate,
  periodInterest,
  crossedPeriodMonth,
} from '../src/sim/simulation-period'
import { householdNeed } from '../src/sim/economy'
import { firmCapacity, ensureFirms } from '../src/sim/firms'
import { beginEconomyMonth } from '../src/sim/macroeconomy'
import { MODEL_PARAMETERS as P } from '../src/sim/model-parameters'
import { cohortBirths, cohortDeaths, annualMortality } from '../src/sim/age-cohorts'
import { viewSnapshot } from '../src/sim/view-snapshot'
import { borrow, producerAccount } from '../src/sim/ledger'
import { withLoanOriginationBatch, loansForBorrower, bankLoans, accountBank } from '../src/sim/banking'

const near = (actual: number, expected: number) =>
  assert(Math.abs(actual - expected) < 1e-8 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`)

import { ensureHistory } from '../src/sim/history'
import { ensureStatecraft } from '../src/sim/statecraft'
import test from 'node:test'
import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'
import { generateWorld } from '../src/sim/generate'
import { prepareSpatialWorld, tick } from '../src/sim/engine'
import { fastForwardStep } from '../src/sim/fast-forward'
import { validateWorld, restoreWorld } from '../src/sim/persistence'
import { auditLedger } from '../src/sim/ledger'
import { auditBanks } from '../src/sim/banking'
import { auditGoods } from '../src/sim/goods-accounting'
import { population, type World } from '../src/sim/types'
import { packWorldSave } from '../src/sim/save-codec'

function check(w: World) {
  validateWorld(w)
  auditLedger(w)
  auditBanks(w)
  auditGoods(w)
  const census =
    w.regions.reduce((sum, r) => sum + population(r), 0) +
    [...w.armies, ...(w.warfare?.fleets ?? [])].reduce((sum, force) => sum + force.soldiers, 0)
  assert.equal(w.totals.population, census)
  for (const pools of Object.values(w.economy!.households))
    for (const h of Object.values(pools))
      assert(h.employed <= h.laborForce + 1e-6, 'a worker cannot hold more than one paid FTE')
}

test('one clearing advances six months, conserves accounts/census and resumes exactly from a save', () => {
  const w = generateWorld('fast-forward-ledgers', 3, 4, undefined, 'regional')
  prepareSpatialWorld(w)
  const populationBefore = w.totals.population
  fastForwardStep(w)
  assert.equal(w.month, 6)
  assert.equal(w.economy!.periodMonths, 6)
  assert(w.totals.births > 0 && w.totals.deaths > 0)
  assert.equal(w.totals.population, populationBefore + w.totals.births - w.totals.deaths)
  assert.deepEqual(
    w.history.slice(-1).map((h) => h.month),
    [6],
  )
  check(w)
  const resumed = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(w))))
  for (let i = 12; i <= 18; i += 6) {
    fastForwardStep(w)
    fastForwardStep(resumed)
    assert.equal(w.month, i)
    assert(
      isDeepStrictEqual(JSON.parse(JSON.stringify(w)), JSON.parse(JSON.stringify(resumed))),
      `saved continuation at month ${i}`,
    )
    check(w)
  }
  assert.deepEqual(w.fastForward, { months: 18, lastMonth: 18 })
  tick(w)
  assert.equal(w.month, 19)
  assert.equal(w.economy!.periodMonths, 1)
  assert.equal(w.fastForward?.lastMonth, 18)
  check(w)
})

test('fast-forward provenance rejects retired partial intervals and impossible dates', () => {
  const w = generateWorld('fast-forward-provenance', 3, 4, undefined, 'regional', 'frontier')
  fastForwardStep(w)
  assert.deepEqual(w.fastForward, { months: 6, lastMonth: 6 })
  check(w)
  tick(w)
  assert.equal(w.month, 7)
  check(w)
  assert.throws(() => validateWorld({ ...w, fastForward: { ...w.fastForward, phase: 1 } }), /provenance/)
  assert.throws(() => validateWorld({ ...w, fastForward: { ...w.fastForward, months: 100 } }), /provenance/)
  assert.throws(
    () => validateWorld({ ...w, fastForward: { ...w.fastForward, lastMonth: 100 } }),
    /provenance/,
  )
})

test('coarse production, needs, mortality, fertility and construction use elapsed months, not one monthly tick', () => {
  const w = generateWorld('macro-units', 3, 4, undefined, 'regional')
  prepareSpatialWorld(w)
  ensureFirms(w)
  const f = w.economy!.firms!.find((f) => f.active)!
  const r = w.localEconomy!.units[f.locality ?? f.region]
  const monthly = firmCapacity(w, r, f, 1).q
  const food = householdNeed(r, 'food')
  const sample = structuredClone(r.communities![0])
  sample.ageCohorts = [[-300, 100000, 100000]]
  sample.ageMonth = 0
  sample.population = { children: 0, adults: 200000, elders: 0 }
  const singleBirths = cohortBirths(structuredClone(sample), 6, { rng: 42 }, 0)
  const capital = f.capital,
    wage = f.wage
  f.projects.push({ remaining: 3, capital: 2, cost: 0 })
  withSimulationPeriod(6, () => {
    near(householdNeed(r, 'food'), food * 6)
    const q = firmCapacity(w, r, f, 1).q
    for (const good of Object.keys(q) as (keyof typeof q)[]) near(q[good], monthly[good] * 6)
    const deaths = cohortDeaths(structuredClone(sample), 6, { rng: 42 }, 0)
    const expected = 200000 * -Math.expm1((-annualMortality(25.5, sample.health, 0) * 6) / 12)
    assert(Math.abs(deaths - expected) < 2)
    const children = structuredClone(sample)
    const births = cohortBirths(children, 6, { rng: 42 }, 0)
    assert(Math.abs(births - singleBirths * 6) <= 6)
    assert.deepEqual(
      children.ageCohorts!.filter((c) => c[0] > 0).map((c) => c[0]),
      [1, 2, 3, 4, 5, 6],
    )
    beginEconomyMonth(w)
    near(f.capital, capital * (1 - P.depreciationMonthly) ** 6 + 2)
    near(f.wage, wage * 6)
    assert.equal(f.projects.length, 0)
    near(periodInterest(0.01), 1.01 ** 6 - 1)
    near(periodRate(0.02), 1 - 0.98 ** 6)
    for (let offset = 1; offset <= 6; offset++) assert(crossedPeriodMonth(6, offset, 12))
    assert(!crossedPeriodMonth(6, 7, 12))
  })
  assert.equal(simulationMonths(), 1)
  assert.throws(
    () =>
      withSimulationPeriod(6, () => {
        throw new Error('abort')
      }),
    /abort/,
  )
  assert.equal(simulationMonths(), 1, 'a failed Max integration cannot leak into normal playback')
})

test('displayed monthly incomes and GDP remain rates; snapshots never alter six-month ledgers or stocks', () => {
  const w = generateWorld('macro-display', 3, 4, undefined, 'regional')
  fastForwardStep(w)
  const before = JSON.stringify(w)
  const view = viewSnapshot(w)
  const id = w.localEconomy!.active[0]
  near(view.economy!.households[id].laborer.income, w.economy!.households[id].laborer.income / 6)
  near(view.economy!.producers[id].wage, w.economy!.producers[id].wage)
  near(view.localEconomy!.units[id].production.food, w.localEconomy!.units[id].production.food / 6)
  near(view.localEconomy!.units[id].stocks.food, w.localEconomy!.units[id].stocks.food)
  near(view.economy!.accounts!.world.productionGDP, w.economy!.accounts!.world.productionGDP / 6)
  near(w.nations[0].gdp, (w.economy!.accounts!.nations[0]?.productionGDP ?? 0) / 6)
  assert.equal(JSON.stringify(w), before)
  assert.throws(() => validateWorld({ ...w, economy: { ...w.economy!, periodMonths: 0 } }), /interval/)
})

test('batched lending keeps live principal and rate changes and discards its lookup after the phase', () => {
  const w = generateWorld('macro-loans', 3, 4)
  const borrower = producerAccount(0),
    bank = accountBank(w, borrower)
  withLoanOriginationBatch(w, () => {
    assert.equal(borrow(w, borrower, 10, 100), 10)
    const principal = loansForBorrower(w, borrower).reduce((sum, l) => sum + l.principal, 0)
    assert.equal(borrow(w, borrower, 20, 100), 20)
    near(
      loansForBorrower(w, borrower).reduce((sum, l) => sum + l.principal, 0),
      principal + 20,
    )
    near(
      bankLoans(w, bank.id),
      w.economy!.credit.loans.filter((l) => l.bank === bank.id).reduce((sum, l) => sum + l.principal, 0),
    )
  })
  auditLedger(w)
  auditBanks(w)
  w.economy!.credit.loans = []
  assert.equal(loansForBorrower(w, borrower).length, 0)
  assert.equal(bankLoans(w, bank.id), 0)
})

test('frontier Max with the browser cabinet setup survives repeated intervals and compressed saves', () => {
  const w = generateWorld('A world unwritten', 3, 4, undefined, 'regional', 'frontier')
  prepareSpatialWorld(w)
  ensureHistory(w)
  ensureStatecraft(w)
  fastForwardStep(w)
  check(w)
  const resumed = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(w))))
  for (let month = 12; month <= 24; month += 6) {
    fastForwardStep(w)
    fastForwardStep(resumed)
    assert.equal(w.month, month)
    check(w)
    assert(isDeepStrictEqual(JSON.parse(JSON.stringify(w)), JSON.parse(JSON.stringify(resumed))))
  }
})
