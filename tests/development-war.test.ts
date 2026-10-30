import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { applyCommand, summarize } from '../src/sim/engine'
import { beginEconomyMonth, fundGovernment } from '../src/sim/macroeconomy'
import { cabinetResearchFocus } from '../src/sim/cabinet-policy'
import { advanceDevelopment, recordDevelopment } from '../src/sim/development'
import {
  annexProvince,
  establishControl,
  maintainControl,
  pillageProvince,
} from '../src/sim/military-control'
import { proposePeace, advancePeaceNegotiations } from '../src/sim/peace'
import { admitDiplomaticConsent, settleConventionalOffers, ensureStatecraft } from '../src/sim/statecraft'
import { ensureWarfare } from '../src/sim/navy'
import { advanceArmies } from '../src/sim/military'
import { balances, auditLedger, borrow, governmentAccount } from '../src/sim/ledger'
import { auditBanks, settleBanks } from '../src/sim/banking'
import { auditGoods } from '../src/sim/goods-accounting'
import { reconcileGDP } from '../src/sim/national-accounts'
import { relation, population } from '../src/sim/types'
import { validateWorld, restoreWorld } from '../src/sim/persistence'
import { packWorldSave } from '../src/sim/save-codec'
import { rebaseEndowments } from './fixtures/endowment'
import { withSimulationPeriod } from '../src/sim/simulation-period'
import { fundProductiveActivity } from '../src/sim/productive-investment'
import { beginFirmMonth, finishFirms, regionalFirms } from '../src/sim/firms'
import { firmAccount, householdAccount, transfer } from '../src/sim/ledger'
import { recordGoodsSale, firmStore } from '../src/sim/national-accounts'
import {
  supplierDebt,
  repaySuppliers,
  quoteMaterialFinancing,
  materialSurplus,
  issueSupplierCredit,
} from '../src/sim/supplier-credit'
import { advanceNativeAccords } from '../src/sim/geopolitics'
import { reserveTaxRelief, targetInventoryMonths } from '../src/sim/strategic-reserves'
import { ensureDistrictEconomy, remeshDistricts } from '../src/sim/districts'
import { refreshSpatial, type SpatialDistrict } from '../src/sim/spatial'
import { releaseSoldiers } from '../src/sim/population'

test('supplier compensation remains owned after local markets are merged', () => {
  const { w } = fixture()
  ensureDistrictEconomy(w)
  const r = w
    .localEconomy!.active.map((id) => w.localEconomy!.units[id])
    .find((r) => r.nation === 0 && r.id !== r.province)!
  assert(r)
  w.nations[0].income = 1
  issueSupplierCredit(w, r, 0.5)
  const before = supplierDebt(w, 0)
  const span = 2 ** Math.ceil(Math.log2(Math.max(w.width, w.height)))
  const districts: SpatialDistrict[] = w.regions.map((r) => ({
    id: `credit:${r.id}`,
    region: r.id,
    node: 'r',
    span,
    cells: [...r.cells],
    population: population(r),
    urbanPopulation: 0,
    industrialEmployment: 0,
    capital: r.industry,
  }))
  remeshDistricts(w, districts)
  refreshSpatial(w)
  assert(Math.abs(supplierDebt(w, 0) - before) < 1e-9)
  for (const creditor of Object.keys(w.economy!.supplierCredit![0]))
    assert(w.localEconomy!.active.includes(Number(creditor.split(':')[1])))
  audit(w)
  validateWorld(w)
})

test('public workshops buy real capital, preserve private ownership and return earned dividends', () => {
  const { w } = fixture()
  const r = w.regions.find((r) => r.nation === 0)!
  for (const g of ['timber', 'stone', 'tools'] as const) r.stocks[g] = 1000
  const firms = regionalFirms(w, r.id)
  for (const f of firms) f.stocks.food = 100
  rebaseEndowments(w)
  beginEconomyMonth(w)
  w.economy!.households[r.id].artisan.laborForce = 1000
  const cash = money(w),
    opening = w.nations[0].treasury
  const spent = fundProductiveActivity(w, r.id, 'tools', 100)
  assert(spent > 0 && spent <= 100)
  const f = firms.find((f) => f.activity === 'tools')!
  assert(f.owners![governmentAccount(0)] > 0)
  assert(f.owners![householdAccount(r.id, 'owner')] > 0)
  assert.equal(f.projects.length, 1)
  assert.equal(w.nations[0].capitalSpending, spent)
  assert(w.nations[0].treasury < opening)
  assert(Math.abs(money(w) - cash) < 1e-7)
  const paid = transfer(
    w,
    householdAccount(r.id, 'owner'),
    firmAccount(f.id),
    f.prices.food / 1000,
    'test final purchase',
  )
  recordGoodsSale(w, firmStore(f.id), 'food', 1, paid, { kind: 'household', nation: 0 })
  f.stocks.food--
  r.consumption.food++
  f.sales += paid
  finishFirms(w)
  assert((w.nations[0].enterpriseIncome ?? 0) > 0)
  assert(Math.abs(money(w) - cash) < 1e-7)
  audit(w)
  const oldCapital = f.capital
  withSimulationPeriod(6, () => beginFirmMonth(w))
  assert(f.capital > oldCapital)
  assert.equal(f.projects.length, 0)
  validateWorld(restoreWorld(packWorldSave(w)))
})

test('supplier credit consumes surplus without minting cash, records debt and later pays its owner', () => {
  const { w } = fixture(),
    r = w.regions.find((r) => r.nation === 0)!,
    n = w.nations[0]
  for (const g of ['timber', 'stone', 'tools'] as const) r.stocks[g] = 100000
  n.treasury = 0.05
  rebaseEndowments(w)
  beginEconomyMonth(w)
  n.income = 1
  w.economy!.households[r.id].artisan.laborForce = 1000
  const moneyBefore = money(w),
    debtBefore = n.debt,
    timber = r.stocks.timber
  const cost = fundProductiveActivity(w, r.id, 'textiles', n.treasury)
  const owed = supplierDebt(w, 0)
  assert(cost > 0.05 && owed > 0)
  assert(Math.abs(n.debt - debtBefore - owed) < 1e-8)
  assert(r.stocks.timber < timber)
  assert(Math.abs(money(w) - moneyBefore) < 1e-7)
  audit(w)
  const restored = restoreWorld(packWorldSave(w))
  assert.equal(supplierDebt(restored, 0), owed)
  const creditor = Object.keys(w.economy!.supplierCredit![0])[0]
  const oldCash = balances(w)[creditor]
  repaySuppliers(w)
  const paid = owed - supplierDebt(w, 0)
  assert(paid > 0)
  assert(Math.abs(balances(w)[creditor] - oldCash - paid) < 1e-8)
  assert(Math.abs(money(w) - moneyBefore) < 1e-7)
  audit(w)
  restored.nations[0].debt += 1
  assert.throws(() => validateWorld(restored), /matching asset/)
})

test('supplier financing protects ordinary stocks and cannot replace wages with IOUs', () => {
  const { w } = fixture(),
    r = w.regions.find((r) => r.nation === 0)!,
    n = w.nations[0]
  n.income = 10
  n.treasury = 0
  r.stocks.timber = 100000
  const q = quoteMaterialFinancing(w, r, { timber: 100 }, 1, 1, 0)
  assert(q.amount < 1e-10, 'cash wages are still required')
  n.treasury = 0.01
  r.stocks.timber = 1
  assert.equal(materialSurplus(w, r, 'timber'), 0)
  const cashOnly = quoteMaterialFinancing(w, r, { timber: 1 }, 1, 1, 0.01)
  assert.equal(cashOnly.credit, 0)
})

test('strategic reserves have a finite target and tax relief requires new useful production', () => {
  const { w } = fixture(),
    r = w.regions.find((r) => r.nation === 0)!,
    n = w.nations[0]
  n.ai = true
  n.foodCoverage = 1
  advanceDevelopment(w)
  const f = regionalFirms(w, r.id)[0]
  assert.equal(targetInventoryMonths(w, r, 'timber'), 6)
  for (const g of Object.keys(f.production) as (keyof typeof f.production)[]) f.production[g] = 0
  f.production.timber = 100
  f.forecast.timber = 50
  f.sold.timber = 0
  f.stocks.timber = 100
  assert.equal(reserveTaxRelief(w, r, f), 0.25)
  f.sold.timber = 100
  assert.equal(reserveTaxRelief(w, r, f), 0, 'sold output does not also earn a reserve incentive')
  f.sold.timber = 50
  assert.equal(reserveTaxRelief(w, r, f), 0.125, 'only the retained addition earns relief')
  f.sold.timber = 0
  n.foodCoverage = 0.8
  assert.equal(reserveTaxRelief(w, r, f), 0, 'food insecurity suspends reserve incentives')
  n.foodCoverage = 1
  f.production.timber = 0
  assert.equal(reserveTaxRelief(w, r, f), 0, 'old stocks earn no new relief')
  f.production.timber = 100
  f.stocks.timber = 1000
  assert.equal(reserveTaxRelief(w, r, f), 0, 'overfilled reserves earn no relief')
})

test('productive investment cannot bypass funds, local materials or military occupation', () => {
  const { w, r } = fixture()
  const own = w.regions.find((p) => p.nation === 0)!
  w.nations[0].treasury = 0
  assert.equal(fundProductiveActivity(w, own.id, 'textiles', 100), 0)
  w.nations[0].treasury = 10
  own.stocks.tools = 0
  assert.equal(fundProductiveActivity(w, own.id, 'textiles', 10), 0)
  establishControl(w, r.id, 0)
  assert.equal(fundProductiveActivity(w, r.id, 'tools', 10), 0)
})

function fixture() {
  const w = generateWorld('development war contracts', 3, 4)
  ensureStatecraft(w)
  ensureWarfare(w)
  for (const n of w.nations) {
    n.ai = false
    n.treasury = 1000
  }
  const a = w.armies.find((a) => a.nation === 0)!
  const r = w.regions.find((r) => r.nation === 1 && r.id !== w.nations[1].capital)!
  a.region = r.id
  a.target = null
  a.morale = a.supply = 1
  a.operations!.cohesion = 1
  a.operations!.stance = 'hold'
  for (const enemy of w.armies.filter((x) => x.nation === 1)) enemy.region = w.nations[1].capital
  relation(w, 0, 1)!.treaty = 'war'
  relation(w, 0, 1)!.warExhaustion = 60
  rebaseEndowments(w)
  beginEconomyMonth(w)
  return { w, a, r }
}
const money = (w: ReturnType<typeof generateWorld>) => Object.values(balances(w)).reduce((s, v) => s + v, 0)
function audit(w: ReturnType<typeof generateWorld>) {
  reconcileGDP(w)
  auditLedger(w)
  auditBanks(w)
  auditGoods(w)
}

test('development programs persist for five years and borrow only within current revenue and bank constraints', () => {
  const { w } = fixture(),
    n = w.nations[0]
  n.ai = true
  n.treasury = 0
  n.income = 2
  n.foodCoverage = 0.9
  rebaseEndowments(w)
  advanceDevelopment(w)
  assert(n.development)
  assert.equal(
    n.development.focus,
    cabinetResearchFocus(
      w,
      n,
      w.regions.filter((r) => r.nation === n.id),
    ),
  )
  assert.equal(n.debt, 0, 'planning must wait for tax receipts before taking a loan')
  fundGovernment(w)
  assert(n.debt > 0 && n.debt <= 72)
  const plan = n.development,
    borrowed = plan.borrowed
  assert(borrowed > 0)
  w.month = 12
  n.foodCoverage = 1
  advanceDevelopment(w)
  assert.equal(n.development, plan, 'a short recovery must not discard the program')
  assert.equal(
    n.researchFocus,
    cabinetResearchFocus(
      w,
      n,
      w.regions.filter((r) => r.nation === n.id),
    ),
  )
  n.ai = false
  const appropriation = plan.appropriation
  advanceDevelopment(w)
  assert.equal(plan.appropriation, appropriation)
  audit(w)
})

test('government borrowing has a longer repayment horizon while keeping matching bank liabilities', () => {
  const { w } = fixture(),
    n = w.nations[0]
  borrow(w, governmentAccount(0), 100, 100)
  const loan = w.economy!.credit.loans.find((l) => l.borrower === governmentAccount(0))!
  const before = loan.principal
  settleBanks(w)
  assert(Math.abs(loan.principal - before * (1 - 1 / 240)) < 1e-8)
  assert(Math.abs(n.debt - loan.principal) < 1e-8)
  audit(w)
})

test('occupation preserves sovereignty, ends without a garrison, and annexation is a separate paid decision', () => {
  const { w, a, r } = fixture(),
    people = w.regions.reduce((s, r) => s + population(r), 0)
  establishControl(w, r.id, 0)
  assert.equal(r.nation, 1)
  assert.match(annexProvince(w, 0, r.id), /six months/)
  a.region = w.nations[0].capital
  maintainControl(w)
  assert.equal(r.control, undefined)
  a.region = r.id
  establishControl(w, r.id, 0)
  w.month = 6
  const before = w.nations[0].treasury
  assert.match(annexProvince(w, 0, r.id), /annexed/)
  assert.equal(r.nation, 0)
  assert.equal(r.control, undefined)
  assert.equal(r.occupation!.former, 1)
  assert(w.nations[0].treasury < before)
  assert.equal(
    w.regions.reduce((s, r) => s + population(r), 0),
    people,
  )
  audit(w)
})

test('winning an actual battle establishes military control without changing the legal border', () => {
  const { w, a } = fixture()
  const home = w.regions.find(
    (r) =>
      r.nation === 0 && r.neighbors.some((id) => w.regions[id].nation >= 0 && w.regions[id].nation !== 0),
  )!
  const target =
    w.regions[home.neighbors.find((id) => w.regions[id].nation >= 0 && w.regions[id].nation !== 0)!]
  const defender = target.nation
  relation(w, 0, defender)!.treaty = 'war'
  assert(home && target)
  for (const army of w.armies) {
    army.operations!.stance = 'hold'
    if (army.nation === defender && army.region === target.id)
      army.region = w.regions.find((r) => r.nation === defender && r.id !== target.id)!.id
  }
  target.stocks.arms = 0
  releaseSoldiers(w, a, home, a.soldiers - 80)
  assert.equal(a.soldiers, 80, 'a funded small army can occupy a small province')
  a.region = home.id
  a.target = target.id
  a.operations!.stance = 'march'
  a.operations!.progress = 1e6
  a.operations!.food = a.soldiers
  a.operations!.arms = a.soldiers
  rebaseEndowments(w)
  beginEconomyMonth(w)
  advanceArmies(w)
  assert.equal(a.region, target.id)
  assert.equal(target.nation, defender)
  assert.equal(target.control?.nation, 0)
  assert.equal(a.operations!.stance, 'hold')
  audit(w)
})

test('pillage transfers existing wealth once per province and period, causing local damage and opposition', () => {
  const { w, a, r } = fixture()
  establishControl(w, r.id, 0)
  a.operations!.conduct = 'pillage'
  const cash = money(w),
    treasury = w.nations[0].treasury,
    merchant = w.economy!.producers[r.id].cash
  const taken = withSimulationPeriod(6, () => pillageProvince(w, a))
  assert(taken > 0)
  assert(Math.abs(w.nations[0].treasury - treasury - taken) < 1e-8)
  assert(w.economy!.producers[r.id].cash < merchant)
  assert(Math.abs(money(w) - cash) < 1e-7)
  assert(r.devastation > 0)
  assert(w.influence!.military.some((x) => x.actor === 0 && x.observer === 1 && x.opposition > 0))
  assert.equal(pillageProvince(w, a), 0, 'splitting armies cannot repeat a levy')
  relation(w, 0, 1)!.treaty = 'truce'
  w.month++
  assert.equal(pillageProvince(w, a), 0)
  audit(w)
})

test('a signed peace exchanges money and territory and releases other occupied land', () => {
  const { w, r } = fixture()
  establishControl(w, r.id, 0)
  const offer = proposePeace(w, 1, 0, 1, 10, [r.id], true)!
  assert(offer)
  admitDiplomaticConsent(w, 0, offer)
  w.month = offer.notBefore!
  const before = money(w),
    cash = w.nations[0].treasury
  settleConventionalOffers(w)
  assert.equal(offer.status, 'ratified', offer.ruling)
  assert.equal(relation(w, 0, 1)!.treaty, 'truce')
  assert.equal(w.regions[r.id].nation, 0)
  assert.equal(w.regions[r.id].control, undefined)
  assert.equal(w.nations[0].treasury, cash + 10)
  assert(Math.abs(money(w) - before) < 1e-7)
  audit(w)
})

test('an unaffordable peace rolls back its truce, occupation release and territorial promises', () => {
  for (const territorial of [false, true]) {
    const { w, r } = fixture()
    establishControl(w, r.id, 0)
    const offer = proposePeace(w, 1, 0, 1, 1e6, territorial ? [r.id] : [], true)!
    admitDiplomaticConsent(w, 0, offer)
    w.month = offer.notBefore!
    const before = money(w),
      control = structuredClone(r.control)
    settleConventionalOffers(w)
    assert.notEqual(offer.status, 'ratified')
    assert.equal(relation(w, 0, 1)!.treaty, 'war')
    assert.equal(w.regions[r.id].nation, 1)
    assert.deepEqual(w.regions[r.id].control, control)
    assert.equal(money(w), before)
    audit(w)
  }
})

test('native cabinets negotiate occupied territory without signing for a human government', () => {
  const { w, r } = fixture()
  establishControl(w, r.id, 0)
  w.nations[1].ai = true
  advancePeaceNegotiations(w)
  const offer = w.statecraft!.offers.find((p) => p.terms.some((t) => t.kind === 'peace'))!
  assert(offer)
  assert(offer.terms.some((t) => t.kind === 'cede' && t.regions.includes(r.id)))
  assert(!offer.signatures.some((s) => s.nation === 0))
  w.nations[0].ai = true
  w.month = offer.notBefore!
  advancePeaceNegotiations(w)
  assert.equal(offer.status, 'ratified', offer.ruling)
})

test('programs and military control survive saves; invalid control and objectives are rejected', () => {
  const { w, r } = fixture()
  establishControl(w, r.id, 0)
  w.nations[0].ai = true
  advanceDevelopment(w)
  recordDevelopment(w)
  summarize(w, false)
  audit(w)
  validateWorld(w)
  const restored = restoreWorld(packWorldSave(w))
  assert.deepEqual(restored.regions[r.id].control, r.control)
  assert.deepEqual(restored.nations[0].development, w.nations[0].development)
  restored.regions[r.id].control!.nation = 9999
  assert.throws(() => validateWorld(restored), /occupation/)
  restored.regions[r.id].control!.nation = 0
  restored.nations[0].development!.review = -1
  assert.throws(() => validateWorld(restored), /occupation/)
  assert.throws(
    () => applyCommand(w, { type: 'peace-proposal', nation: 0, target: 1, payer: 2, payment: 10, cede: [] }),
    /payer/,
  )
})

test('war cabinets can initiate peace without prior diplomacy bookkeeping', () => {
  const { w } = fixture()
  delete w.statecraft
  w.nations[0].ai = w.nations[1].ai = true
  advanceNativeAccords(w)
  assert(ensureStatecraft(w).offers.some((p) => p.terms.some((t) => t.kind === 'peace')))
})

test('an industrial mandate retains its objective while redirecting labor during a food shortage', () => {
  const { w } = fixture(),
    n = w.nations[0]
  n.ai = true
  n.foodCoverage = 1
  advanceDevelopment(w)
  n.development!.focus = 'industry'
  n.foodCoverage = 0.9
  const plan = n.development
  advanceDevelopment(w)
  assert.equal(n.development, plan)
  assert.equal(n.development!.focus, 'industry')
  assert.equal(n.policies.priority, 'agriculture')
})
