/** Regression coverage for the loss-making merchant offers behind negative GDP. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { ensureFirms, regionalFirms, restockMarket } from '../src/sim/firms'
import { generateWorld } from '../src/sim/generate'
import { balances, producerAccount } from '../src/sim/ledger'
import { beginEconomyMonth, consumeHouseholds } from '../src/sim/macroeconomy'
import {
  auditNationalAccounts,
  beginNationalAccounts,
  marketStore,
  reconcileGDP,
  recordGoodsSale,
  recordTransport,
} from '../src/sim/national-accounts'
import { refreshRetailQuote, retailMarkup } from '../src/sim/retail-pricing'
import { inventory } from '../src/sim/types'

const near = (actual: number, expected: number) =>
  assert(Math.abs(actual - expected) < 1e-8 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`)

function fixture() {
  const w = generateWorld('Merchant inventory quotes', 3, 4),
    buyer = w.regions[0],
    seller = w.regions.find((r) => r.nation !== buyer.nation)!
  ensureFirms(w)
  buyer.stocks = { ...inventory(), coal: 100 }
  buyer.prices.coal = 1000
  seller.stocks = { ...inventory(), coal: 10 }
  seller.prices.coal = 100
  beginNationalAccounts(w)
  return { w, buyer, seller }
}

test('a cheap marginal purchase cannot force the whole warehouse below its blended cost', () => {
  const { w, buyer, seller } = fixture(),
    cash = balances(w)
  recordGoodsSale(w, marketStore(seller.id), 'coal', 1, 0.1, {
    kind: 'business',
    nation: buyer.nation,
    account: producerAccount(buyer.id),
    store: marketStore(buyer.id),
  })
  seller.stocks.coal--
  buyer.stocks.coal++
  refreshRetailQuote(w, buyer, 'coal', 0.1)
  const cost = 100.1 / 101,
    markup = retailMarkup(w, buyer, 'coal'),
    paid = (10 * buyer.prices.coal) / 1000
  near(buyer.prices.coal, cost * 1000 * (1 + markup))
  recordGoodsSale(w, marketStore(buyer.id), 'coal', 10, paid, { kind: 'household', nation: buyer.nation })
  buyer.stocks.coal -= 10
  const accounts = reconcileGDP(w)!
  near(accounts.productionGDP, 10 * cost * markup)
  near(accounts.holdingGains, 0)
  auditNationalAccounts(w)
  assert.deepEqual(balances(w), cash, 'requotes and accounting entries do not mint cash')
})

test('import quotes recover blended freight and tariffs without repricing old stock to the last lot', () => {
  const { w, buyer, seller } = fixture()
  recordGoodsSale(
    w,
    marketStore(seller.id),
    'coal',
    1,
    0.1,
    {
      kind: 'business',
      nation: buyer.nation,
      account: producerAccount(buyer.id),
      store: marketStore(buyer.id),
    },
    10,
  )
  recordTransport(w, seller.id, buyer.id, 8, 2)
  seller.stocks.coal--
  buyer.stocks.coal++
  refreshRetailQuote(w, buyer, 'coal', 10.1)
  near(buyer.prices.coal, (110.1 / 101) * 1000 * (1 + retailMarkup(w, buyer, 'coal')))
  near(reconcileGDP(w)!.holdingGains, 0)
  auditNationalAccounts(w)
})

test('restocking uses all carried stock and repairs stale quotes without requiring a new purchase', () => {
  const w = generateWorld('Restocking carried inventory', 3, 4),
    r = w.regions[0]
  ensureFirms(w)
  r.stocks = { ...inventory(), coal: 100 }
  r.prices.coal = 1000
  for (const f of regionalFirms(w, r.id)) f.stocks = inventory()
  const supplier = regionalFirms(w, r.id).find((f) => f.active)!
  supplier.stocks.coal = 1
  supplier.prices.coal = 1
  w.economy!.producers[r.id].forecast.coal = 1000
  beginNationalAccounts(w)
  restockMarket(w, r)
  assert.equal(supplier.stocks.coal, 0, 'exercise a real cheap wholesale purchase')
  near(r.prices.coal, (100.001 / 101) * 1000 * (1 + retailMarkup(w, r, 'coal')))
  r.prices.coal = 1
  restockMarket(w, r)
  near(r.prices.coal, (100.001 / 101) * 1000 * (1 + retailMarkup(w, r, 'coal')))
  reconcileGDP(w)
  auditNationalAccounts(w)
})

test('cheap direct factory sales cannot overwrite the merchant offer for its remaining inventory', () => {
  const w = generateWorld('Independent retail offers', 3, 4),
    r = w.regions[0]
  ensureFirms(w)
  r.stocks = { ...inventory(), food: 100 }
  r.prices.food = 1000
  for (const f of regionalFirms(w, r.id)) f.stocks = inventory()
  const factory = regionalFirms(w, r.id).find((f) => f.active)!
  factory.stocks.food = 1_000_000
  factory.prices.food = 0.01
  beginNationalAccounts(w)
  consumeHouseholds(w)
  assert(factory.sold.food > 0)
  assert(r.stocks.food > 0)
  assert.equal(r.prices.food, 1000)
  reconcileGDP(w)
  auditNationalAccounts(w)
})

test('empty inventories keep their quote and unpriced or zero-cost inventory stays finite', () => {
  const { w, buyer } = fixture()
  const price = buyer.prices.food
  refreshRetailQuote(w, buyer, 'food', 50)
  assert.equal(buyer.prices.food, price)
  delete w.economy!.accounts
  delete w.economy!.inventoryPrices
  refreshRetailQuote(w, buyer, 'coal')
  assert.equal(buyer.prices.coal, 1000)
  refreshRetailQuote(w, buyer, 'coal', 0)
  assert.equal(buyer.prices.coal, 0.01)
})

test('a new month repairs legacy below-cost offers before workshops can purchase materials', () => {
  const { w, buyer } = fixture()
  reconcileGDP(w)
  buyer.prices.coal = 1
  w.month++
  const cash = balances(w),
    stock = buyer.stocks.coal
  beginEconomyMonth(w)
  near(buyer.prices.coal, 1000 * (1 + retailMarkup(w, buyer, 'coal')))
  assert.equal(buyer.stocks.coal, stock)
  assert.deepEqual(balances(w), cash)
  near(reconcileGDP(w)!.productionGDP, 0)
  auditNationalAccounts(w)
})
