import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { annualMortality, desiredFertility } from '../src/sim/age-cohorts'
import { beginEconomyMonth, hireLabor, purchasePublicLabor, fundGovernment } from '../src/sim/macroeconomy'
import { ensureFirms, regionalFirms } from '../src/sim/firms'
import { advanceSovereignty } from '../src/sim/sovereignty'
import { ensureDistrictEconomy } from '../src/sim/districts'
import { landscapeAt } from '../src/sim/landscape'
import { tick } from '../src/sim/engine'
import { economicRegions } from '../src/sim/local-units'
import { realService, previousResearchOutput } from '../src/sim/public-services'
import { STRATA } from '../src/sim/economic-types'
import { auditLedger, transfer } from '../src/sim/ledger'
import { advanceInstitutions } from '../src/sim/institutions'
import { diplomaticCapacity } from '../src/sim/diplomatic-friction'
import { validateWorld } from '../src/sim/persistence'

const fixture = () => generateWorld('Long-run mechanisms', 3, 4)

test('family preferences respond to survival and opportunity costs without imposing replacement births', () => {
  const rural = { literacy: 0.3, urban: 0.1, health: 0.7 }
  const educated = { ...rural, literacy: 0.95 }
  const urban = { ...educated, urban: 0.98, health: 0.95 }
  assert(desiredFertility(rural) > desiredFertility(educated))
  assert(desiredFertility(educated) > 2.1)
  assert(desiredFertility(urban) < 2.1, 'high opportunity costs can still produce natural decline')
  assert(desiredFertility({ ...rural, health: 0.3 }) > desiredFertility(rural))
  const baseline = annualMortality(30, 0.7, 0)
  const mild = annualMortality(30, 0.7, 0.2) - baseline
  const famine = annualMortality(30, 0.7, 0.8) - baseline
  assert(famine > mild * 10, 'severe deprivation must be much more dangerous than a small ration shortfall')
  assert(annualMortality(2, 0.7, 0.8) > annualMortality(30, 0.7, 0.8))
})

test('unfunded planned production does not cause an automatic wage-price ratchet', () => {
  const w = fixture()
  beginEconomyMonth(w)
  ensureFirms(w)
  const r = w.regions[0],
    p = w.economy!.producers[r.id]
  p.previousLabor = 1000
  p.previousJobs = 600
  p.previousPriceIndex = undefined
  const firms = regionalFirms(w, r.id).filter((f) => f.active),
    wages = firms.map((f) => f.wage)
  hireLabor(w, r)
  assert(
    firms.every((f, i) => f.wage < wages[i]),
    'slack labor should temper wage offers despite unfilled goods orders',
  )
  auditLedger(w)
})

test('public services share scarce staff and depend on funded real labor', () => {
  const w = fixture()
  beginEconomyMonth(w)
  for (const r of w.regions) {
    for (const s of STRATA) {
      const h = w.economy!.households[r.id][s]
      h.laborForce = 100
      h.employed = 99.5
    }
  }
  fundGovernment(w)
  const n = w.nations[0]
  assert(n.budget.education > 0 && n.budget.research > 0 && n.budget.administration > 0)
  const r = w.regions.find((r) => r.nation === 0)!
  assert(realService(w, r, 'research') > 0)
  auditLedger(w)
  validateWorld(w)
})

test('doubling the nominal wage and service budget buys the same real service', () => {
  const a = fixture(),
    b = fixture()
  for (const [w, factor] of [
    [a, 1],
    [b, 2],
  ] as const) {
    beginEconomyMonth(w)
    const r = w.regions[0]
    w.economy!.producers[r.id].wage *= factor
    for (const s of STRATA) w.economy!.households[r.id][s].laborForce = 1000
    purchasePublicLabor(w, r, `government:${r.nation}`, factor, 'public education services')
    auditLedger(w)
  }
  assert.equal(realService(a, a.regions[0], 'education'), realService(b, b.regions[0], 'education'))
  assert.equal(b.economy!.producers[0].publicServices, a.economy!.producers[0].publicServices * 2)
})

test('policing and diplomatic staffing are unchanged by a pure nominal wage-budget rescaling', () => {
  const outcomes = [1, 2].map((factor) => {
    const w = fixture(),
      r = w.regions[0]
    r.delegation = {
      autonomy: 0.6,
      powers: ['taxation', 'policing'],
      treasury: 0,
      income: 2 * factor,
      budget: 0,
      since: w.month,
    }
    transfer(w, `government:${r.nation}`, `province:${r.id}`, 10 * factor, 'fund provincial services')
    beginEconomyMonth(w)
    w.economy!.producers[r.id].wage *= factor
    for (const s of STRATA) w.economy!.households[r.id][s].laborForce = 1000
    purchasePublicLabor(w, r, `government:${r.nation}`, factor, 'public administration services')
    advanceInstitutions(w)
    auditLedger(w)
    return { unrest: r.unrest, office: diplomaticCapacity(w, r.nation) }
  })
  assert.deepEqual(outcomes[0], outcomes[1])
})

test('research agreements retain last month’s real output after current service counters reset', () => {
  const w = fixture(),
    r = w.regions[0]
  beginEconomyMonth(w)
  for (const s of STRATA) w.economy!.households[r.id][s].laborForce = 1000
  purchasePublicLabor(w, r, `government:${r.nation}`, 1, 'public research services')
  const output = realService(w, r, 'research')
  assert(output > 0)
  beginEconomyMonth(w)
  assert.equal(realService(w, r, 'research'), 0)
  assert.equal(previousResearchOutput(w, r.nation), output)
})

test('a shared movement among contented loyal people does not manufacture rebellion without a garrison', () => {
  const w = fixture(),
    initial = w.nations.length
  w.armies = []
  for (const n of w.nations) {
    n.stability = 75
    n.legitimacy = 75
  }
  for (const r of w.regions) {
    r.unrest = 20
    r.foodCoverage = 1
    r.materialCoverage = 1
    const movement = r.communities![0].movement
    for (const g of r.communities!) {
      g.movement = movement
      g.loyalty = 0.8
      g.grievance = 0.1
      g.rootedness = 1
    }
  }
  for (let i = 0; i < 120; i++) {
    w.month++
    advanceSovereignty(w)
  }
  assert.equal(w.nations.length, initial)
  assert(w.sovereignty!.provinces.every((p) => p.neglect === 0 && p.mobilizable === 0))
})

test('one month applies forest recovery exactly once and never replenishes mineral reserves', () => {
  const w = fixture()
  ensureDistrictEconomy(w)
  const local = w.localEconomy!
  let capacity = 0
  for (const [id, stock] of Object.entries(local.reserves)) {
    stock.timber *= 0.1 // Below every cell's land-use-adjusted capacity.
    capacity += landscapeAt(w.cells[+id]).resources.timber * 5000 * (1 - (local.built[+id] ?? 0) * 0.8)
  }
  const goods = ['timber', 'iron', 'coal', 'stone'] as const
  const before = goods.map((g) => Object.values(local.reserves).reduce((sum, stock) => sum + stock[g], 0))
  tick(w)
  goods.forEach((g, i) => {
    const remaining = before[i] - economicRegions(w).reduce((sum, r) => sum + r.production[g], 0)
    const expected = remaining + (g === 'timber' ? (capacity - remaining) * 0.002 : 0)
    const actual = Object.values(local.reserves).reduce((sum, stock) => sum + stock[g], 0)
    assert(Math.abs(actual - expected) < Math.max(1, expected) * 1e-12, `${g}: ${actual} vs ${expected}`)
  })
  validateWorld(w)
})

test('scarce food is allocated across simultaneous affordable orders, not by stratum position', async () => {
  const { consumeHouseholds } = await import('../src/sim/macroeconomy')
  const { householdNeed, BASE_PRICE } = await import('../src/sim/economy')
  const { stratumPeople } = await import('../src/sim/ledger')
  const { rebaseEndowments } = await import('./fixtures/endowment')
  const w = fixture(),
    r = w.regions[0]
  r.prices = { ...BASE_PRICE }
  for (const s of STRATA) w.economy!.households[r.id][s].cash = stratumPeople(w, r.id, s) * 0.0004
  for (const g of Object.keys(r.stocks) as (keyof typeof r.stocks)[]) r.stocks[g] = 0
  r.stocks.food = householdNeed(r, 'food') * 0.5
  rebaseEndowments(w)
  beginEconomyMonth(w)
  // Opening firms have no goods, so this isolates the common merchant's scarce lot.
  consumeHouseholds(w)
  const coverage = STRATA.filter((s) => stratumPeople(w, r.id, s) > 0).map(
    (s) => w.economy!.households[r.id][s].foodCoverage,
  )
  assert(
    coverage.every((c) => Math.abs(c - 0.5) < 1e-9),
    JSON.stringify(coverage),
  )
  auditLedger(w)
})

test('a precautionary food reserve can supply neighbors without same-month import resales', async () => {
  const { tradeDistricts } = await import('../src/sim/district-transport')
  const { householdNeed } = await import('../src/sim/economy')
  const { economicRegions } = await import('../src/sim/local-units')
  const { rebaseEndowments } = await import('./fixtures/endowment')
  const w = fixture()
  ensureDistrictEconomy(w)
  const locals = economicRegions(w)
  for (const r of locals) r.stocks.food = householdNeed(r, 'food')
  const source = locals.find((r) => r.neighbors.length && householdNeed(r, 'food') > 10)!
  const keep = householdNeed(source, 'food')
  source.stocks.food = keep * 1.5
  w.localEconomy!.units[source.neighbors[0]].stocks.food = 0
  rebaseEndowments(w)
  beginEconomyMonth(w)
  tradeDistricts(w)
  const trades = w.localEconomy!.shipments.filter((s) => s.good === 'food')
  assert(trades.some((s) => s.from === source.id && s.quantity > 0))
  assert(
    trades.every((s) => s.from === source.id),
    'newly imported food is not relabeled as an opening export lot',
  )
  assert(source.stocks.food >= keep - 1e-8)
  auditLedger(w)
})

test('input shortages release workshop labor without erasing the orders needed to restart production', async () => {
  const { produceFirms } = await import('../src/sim/firms')
  const { BASE_PRICE } = await import('../src/sim/economy')
  const w = fixture(),
    r = w.regions[0]
  r.prices = { ...BASE_PRICE }
  r.stocks.iron = r.stocks.coal = r.stocks.timber = 0
  beginEconomyMonth(w)
  produceFirms(w, r)
  const firms = regionalFirms(w, r.id).filter((f) => f.active)
  assert(firms.every((f) => f.laborMix!.tools === 0 && f.laborMix!.arms === 0 && f.laborMix!.textiles === 0))
  assert(firms.some((f) => f.planned.tools > 0))
  assert(r.plannedProduction!.tools > 0 && w.economy!.producers[r.id].inputTargets.iron > 0)
  assert.equal(r.production.tools, 0)
  assert(r.production.food > 0)
  auditLedger(w)
})
