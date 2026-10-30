import { expeditionPeople } from '../src/sim/overseas-types'
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { ensureDistrictEconomy, aggregateDistricts } from '../src/sim/districts'
import { beginEconomyMonth } from '../src/sim/macroeconomy'
import { submitStandingOffer, acceptRefereeDecision } from '../src/sim/statecraft'
import { recordGift, marketStore, armyStore, reconcileGDP } from '../src/sim/national-accounts'
import { physicalStocks, auditGoods } from '../src/sim/goods-accounting'
import { balances, auditLedger, borrow } from '../src/sim/ledger'
import { auditBanks } from '../src/sim/banking'
import { population, type World } from '../src/sim/types'
import { allForces } from '../src/sim/forces'
import type { DiplomaticClause } from '../src/sim/statecraft-types'
const people = (w: World) =>
  w.regions.reduce((sum, r) => sum + population(r), 0) +
  allForces(w).reduce((sum, a) => sum + a.soldiers, 0) +
  expeditionPeople(w)
const clause = (kind: DiplomaticClause['kind'], extra: Partial<DiplomaticClause> = {}): DiplomaticClause => ({
  kind,
  from: 0,
  to: 1,
  amount: 0,
  good: '',
  field: '',
  regions: [],
  duration: 0,
  text: '',
  ...extra,
})
function settle(w: World, terms: DiplomaticClause[], beforeApply = () => {}) {
  const offer = submitStandingOffer(w, 0, {
    title: 'Conservative settlement',
    parties: [0, 1],
    visibility: 'public',
    duration: 12,
    supersedes: 0,
    terms,
  })
  offer.signatures = offer.parties.map((nation) => ({ nation, digest: offer.digest, month: w.month }))
  offer.notBefore = w.month
  beforeApply()
  acceptRefereeDecision(
    w,
    {
      rulings: [
        {
          offer: offer.id,
          digest: offer.digest,
          verdict: 'approve',
          reasoning: 'Execute signed terms.',
          resolved: [],
          effects: [],
          misconduct: [],
        },
      ],
    },
    [{ id: offer.id, digest: offer.digest }],
    'test',
  )
  return offer
}
function fixture() {
  const w = generateWorld('Settlement depot ownership')
  ensureDistrictEconomy(w)
  beginEconomyMonth(w)
  return w
}
test('administrative settlement keeps the provincial depot attached to its market during later procurement', () => {
  const w = fixture(),
    before = physicalStocks(w),
    census = people(w)
  let accounts: ReturnType<typeof balances>
  const offer = settle(
    w,
    [
      clause('devolution', {
        to: 0,
        regions: [w.nations[0].capital],
        amount: 0.3,
        delegation: { powers: ['taxation'] },
      }),
    ],
    () => {
      accounts = balances(w)
    },
  )
  assert.equal(offer.status, 'ratified', offer.ruling)
  for (const r of w.regions) assert.equal(r.stocks, w.localEconomy!.units[r.id].stocks)
  const army = w.armies[0],
    home = w.regions[army.region],
    amount = Math.min(21.06, home.stocks.food)
  recordGift(w, marketStore(home.id), armyStore(army.id), 'food', amount)
  home.stocks.food -= amount
  army.operations!.food += amount
  aggregateDistricts(w)
  reconcileGDP(w)
  auditGoods(w)
  auditLedger(w)
  auditBanks(w)
  assert.equal(people(w), census)
  const afterAccounts = balances(w)
  for (const key of new Set([...Object.keys(accounts!), ...Object.keys(afterAccounts)]))
    assert.equal(afterAccounts[key] ?? 0, accounts![key] ?? 0, key)
  for (const g of Object.keys(before) as (keyof typeof before)[])
    assert(Math.abs(physicalStocks(w)[g] - before[g]) < 1e-6)
})
test('a failed multi-clause settlement leaves bank reserves, ledger entries and deposits unchanged', () => {
  const w = fixture(),
    amount = w.nations[0].treasury * 0.75
  const capture = () =>
    JSON.stringify({
      accounts: balances(w),
      banking: w.economy!.banking,
      ledger: w.economy!.ledger,
      credit: w.economy!.credit,
    })
  let before = ''
  const offer = settle(w, [clause('payment', { amount }), clause('payment', { amount })], () => {
    before = capture()
  })
  assert.equal(offer.status, 'proposed')
  assert.match(offer.ruling, /promised funds/)
  assert.equal(
    JSON.stringify({
      accounts: balances(w),
      banking: w.economy!.banking,
      ledger: w.economy!.ledger,
      credit: w.economy!.credit,
    }),
    before,
  )
  auditLedger(w)
  auditBanks(w)
})
test('state succession retains loan ownership and all military and market goods', () => {
  const w = fixture()
  borrow(w, 'government:0', 100, 100)
  const goods = physicalStocks(w),
    census = people(w),
    cash = Object.values(balances(w)).reduce((a, b) => a + b, 0),
    debt = w.nations[0].debt + w.nations[1].debt
  const loans = w
    .economy!.credit.loans.filter((l) => l.borrower === 'government:0')
    .map((l) => ({ ...l, borrower: 'government:1' }))
  const offer = settle(w, [clause('merge')])
  assert.equal(offer.status, 'ratified', offer.ruling)
  assert.equal(w.nations[0].debt, 0)
  assert.equal(w.nations[1].debt, debt)
  for (const loan of loans)
    assert.deepEqual(
      w.economy!.credit.loans.find((l) => l.id === loan.id),
      loan,
    )
  assert.equal(people(w), census)
  assert(Math.abs(Object.values(balances(w)).reduce((a, b) => a + b, 0) - cash) < 1e-6)
  for (const g of Object.keys(goods) as (keyof typeof goods)[])
    assert(Math.abs(physicalStocks(w)[g] - goods[g]) < 1e-6)
  reconcileGDP(w)
  auditGoods(w)
  auditLedger(w)
  auditBanks(w)
})
