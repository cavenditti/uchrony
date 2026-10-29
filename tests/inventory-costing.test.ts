/** Inventory value must follow the goods paid for, independently of cash and selling quotes. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { generateWorld } from '../src/sim/generate'
import { ensureAdaptiveWorld } from '../src/sim/adaptive-world'
import { ensureDistrictEconomy, remeshDistricts } from '../src/sim/districts'
import { deliverFreight, arriveFreight } from '../src/sim/freight-transit'
import { neighbors } from '../src/sim/grid'
import { balances, producerAccount } from '../src/sim/ledger'
import {
  auditNationalAccounts,
  beginNationalAccounts,
  inventoryQuote,
  marketStore,
  reconcileGDP,
  recordGift,
  recordGoodsSale,
  recordTransport,
  recordUse,
} from '../src/sim/national-accounts'
import { inventory, type World } from '../src/sim/types'
import { parseSave, validateWorld } from '../src/sim/persistence'
import { packWorldSave } from '../src/sim/save-codec'
import { buildSpatial } from '../src/sim/spatial'

const near = (actual: number, expected: number, message = `${actual} != ${expected}`) =>
  assert(Math.abs(actual - expected) < 1e-8 * Math.max(1, Math.abs(expected)), message)

function fixture() {
  const w = generateWorld('Inventory acquisition costs', 3, 4),
    buyer = w.regions[0],
    seller = w.regions.find((r) => r.nation !== buyer.nation)!
  buyer.stocks = inventory()
  seller.stocks = inventory()
  buyer.stocks.iron = 1000
  buyer.prices.iron = 1000
  seller.stocks.iron = 10
  seller.prices.iron = 1_000_000
  beginNationalAccounts(w)
  return { w, buyer, seller }
}

const book = (w: World, id: number) => w.economy!.accounts!.stores[marketStore(id)]
const value = (w: World, id: number) => book(w, id).quantity.iron * book(w, id).price.iron

test('a small expensive purchase adds only its actual cost to the whole warehouse', () => {
  const { w, buyer, seller } = fixture(),
    cash = balances(w)
  recordGoodsSale(w, marketStore(seller.id), 'iron', 1, 1000, {
    kind: 'business',
    nation: buyer.nation,
    account: producerAccount(buyer.id),
    store: marketStore(buyer.id),
  })
  seller.stocks.iron--
  buyer.stocks.iron++
  near(value(w, buyer.id), 2000)
  near(book(w, buyer.id).price.iron, 2000 / 1001)
  assert.equal(buyer.prices.iron, 1000, 'inventory costs do not change selling quotes')
  near(reconcileGDP(w)!.holdingGains, 0)

  recordGoodsSale(w, marketStore(buyer.id), 'iron', 100, 200, { kind: 'household', nation: buyer.nation })
  buyer.stocks.iron -= 100
  const result = reconcileGDP(w)!
  near(result.productionGDP, 200 - (100 * 2000) / 1001)
  near(result.discrepancy, 0)
  near(result.holdingGains, 0)
  assert.deepEqual(balances(w), cash, 'valuation entries do not manufacture cash or treasury losses')
  auditNationalAccounts(w)
})

test('mixed purchases include landed costs and are independent of purchase order', () => {
  const results = []
  for (const reverse of [false, true]) {
    const { w, buyer, seller } = fixture()
    const lots = [
      { quantity: 2, unitPrice: 5, freight: 1, tariff: 0.5 },
      { quantity: 1, unitPrice: 1000, freight: 4, tariff: 3 },
    ]
    for (const lot of reverse ? lots.reverse() : lots) {
      recordGoodsSale(
        w,
        marketStore(seller.id),
        'iron',
        lot.quantity,
        lot.quantity * lot.unitPrice,
        {
          kind: 'business',
          nation: buyer.nation,
          account: producerAccount(buyer.id),
          store: marketStore(buyer.id),
        },
        lot.freight + lot.tariff,
      )
      recordTransport(w, seller.id, buyer.id, lot.freight, lot.tariff)
      seller.stocks.iron -= lot.quantity
      buyer.stocks.iron += lot.quantity
    }
    near(value(w, buyer.id), 2018.5)
    near(reconcileGDP(w)!.holdingGains, 0)
    auditNationalAccounts(w)
    results.push(book(w, buyer.id).price.iron)
  }
  near(results[0], results[1])
})

test("gifts conserve both warehouses' value without repricing the recipient's old stock", () => {
  const { w, buyer, seller } = fixture(),
    opening = value(w, buyer.id) + value(w, seller.id)
  recordGift(w, marketStore(seller.id), marketStore(buyer.id), 'iron', 1)
  seller.stocks.iron--
  buyer.stocks.iron++
  near(value(w, buyer.id), 2000)
  near(value(w, buyer.id) + value(w, seller.id), opening)
  const result = reconcileGDP(w)!
  near(result.productionGDP, 0)
  near(result.holdingGains, 0)
  near(result.otherAssetChanges, 0)
  auditNationalAccounts(w)
})

test('spoilage and genuine below-cost sales reduce value added without hiding losses', () => {
  const { w, buyer } = fixture()
  near(recordUse(w, marketStore(buyer.id), 'iron', 100, 'loss'), 100)
  buyer.stocks.iron -= 100
  recordGoodsSale(w, marketStore(buyer.id), 'iron', 100, 50, { kind: 'household', nation: buyer.nation })
  buyer.stocks.iron -= 100
  near(value(w, buyer.id), 800)
  const result = reconcileGDP(w)!
  near(result.productionGDP, -150)
  near(result.holdingGains, 0)
  auditNationalAccounts(w)
})

test('empty warehouses take the incoming cost, including a zero-value gift', () => {
  const { w, buyer, seller } = fixture()
  recordUse(w, marketStore(buyer.id), 'iron', buyer.stocks.iron, 'other')
  buyer.stocks.iron = 0
  inventoryQuote(w, marketStore(seller.id), 'iron', 0)
  recordGift(w, marketStore(seller.id), marketStore(buyer.id), 'iron', 1)
  seller.stocks.iron--
  buyer.stocks.iron++
  assert.equal(book(w, buyer.id).price.iron, 0)
  assert.equal(value(w, buyer.id), 0)
  reconcileGDP(w)
  auditNationalAccounts(w)
})

test('a transferred lot keeps its own cost while other goods remain in the source warehouse', () => {
  const { w, buyer, seller } = fixture()
  recordGift(w, marketStore(seller.id), marketStore(buyer.id), 'iron', 1)
  seller.stocks.iron--
  buyer.stocks.iron++
  recordGift(w, marketStore(buyer.id), marketStore(seller.id), 'iron', 1, 1000)
  buyer.stocks.iron--
  seller.stocks.iron++
  near(value(w, buyer.id), 1000)
  near(value(w, seller.id), 10000)
  near(reconcileGDP(w)!.holdingGains, 0)
  const before = structuredClone(w.economy!.accounts)
  recordGift(w, marketStore(buyer.id), marketStore(buyer.id), 'iron', 100)
  assert.deepEqual(w.economy!.accounts, before)
  assert.throws(
    () => recordGift(w, marketStore(buyer.id), marketStore(seller.id), 'iron', 1, 1001),
    /value overdraw/,
  )
  assert.deepEqual(w.economy!.accounts, before, 'invalid lot values fail before changing inventory')
})

test('delayed freight preserves the purchased lot cost through dispatch, save and arrival', () => {
  const w = generateWorld('Weighted freight inventory', 3, 4)
  ensureAdaptiveWorld(w)
  const [a, b] = w.localEconomy!.active.slice(0, 2).map((id) => w.localEconomy!.units[id])
  a.stocks.iron = 10
  b.stocks.iron = 1000
  a.prices.iron = 1_000_000
  b.prices.iron = 1000
  beginNationalAccounts(w)
  const before = value(w, b.id)
  recordGoodsSale(w, marketStore(a.id), 'iron', 1, 1000, {
    kind: 'business',
    nation: b.nation,
    account: producerAccount(b.id),
    store: marketStore(b.id),
  })
  a.stocks.iron--
  const adjacent = neighbors(a.center, w.width, w.height).find((c) => w.cells[c].terrain !== 'water')!,
    cells = Array.from({ length: 3000 }, (_, i) => (i % 2 ? adjacent : a.center))
  deliverFreight(w, a.id, b.id, 'iron', 1, [{ mode: 'land', cells }], 1000)
  near(value(w, b.id), before)
  const shipment = w.adaptive!.transit![0],
    store = w.economy!.accounts!.stores[`transit:${shipment.id}`]
  near(store.quantity.iron * store.price.iron, 1000)
  near(reconcileGDP(w)!.holdingGains, 0)
  const saved = parseSave(JSON.stringify(packWorldSave(w)))
  assert.deepEqual(saved.economy!.inventoryValuation, w.economy!.inventoryValuation)
  saved.month = shipment.arrives
  beginNationalAccounts(saved)
  arriveFreight(saved)
  arriveFreight(saved)
  near(value(saved, b.id), before + 1000)
  near(saved.localEconomy!.units[b.id].stocks.iron, 1001)
  near(reconcileGDP(saved)!.holdingGains, 0)
  auditNationalAccounts(saved)
})

test('district merges and splits preserve different original inventory costs without revaluation', () => {
  const w = generateWorld('Weighted remesh inventory', 3, 4)
  ensureDistrictEconomy(w)
  assert.equal(
    w.adaptive,
    undefined,
    'exercise the actual financial remapping, not just adaptive mesh geometry',
  )
  for (const id of w.localEconomy!.active) {
    const r = w.localEconomy!.units[id]
    r.stocks.iron = 10 + id
    r.prices.iron = (id + 1) * 1000
  }
  beginNationalAccounts(w)
  const fine = buildSpatial(w).districts,
    coarse = w.regions.map((r) => ({
      id: `coarse:${r.id}`,
      region: r.id,
      node: 'r',
      span: 128,
      cells: [...r.cells],
      population: 0,
      urbanPopulation: 0,
      industrialEmployment: 0,
      capital: r.industry,
    })),
    total = () =>
      w.localEconomy!.active.reduce(
        (sum, id) => sum + (w.localEconomy!.units[id].stocks.iron ? value(w, id) : 0),
        0,
      ),
    opening = total()
  reconcileGDP(w)
  for (const partition of [coarse, fine, coarse]) {
    remeshDistricts(w, partition)
    near(total(), opening)
    near(w.economy!.accounts!.world.holdingGains, 0)
    near(w.economy!.accounts!.world.productionGDP, 0)
    auditNationalAccounts(w)
  }
})

test('legacy inventory quotes are rebased once outside GDP without rewriting cash, goods or history', () => {
  const { w, buyer } = fixture()
  inventoryQuote(w, marketStore(buyer.id), 'iron', 1000)
  reconcileGDP(w)
  delete w.economy!.inventoryValuation
  const restored = parseSave(JSON.stringify(w)),
    cash = balances(restored),
    goods = restored.regions.map((r) => ({ ...r.stocks })),
    history = structuredClone(restored.history)
  near(value(restored, buyer.id), 1_000_000, 'loading alone leaves completed accounts intact')
  restored.month++
  beginNationalAccounts(restored)
  const result = reconcileGDP(restored)!
  near(value(restored, buyer.id), 1000)
  near(result.productionGDP, 0)
  near(result.holdingGains, -999000)
  assert.deepEqual(restored.economy!.inventoryValuation, {
    method: 'weighted-average',
    adoptedMonth: restored.month,
    legacyAdjustment: -999000,
  })
  assert.deepEqual(balances(restored), cash)
  assert.deepEqual(
    restored.regions.map((r) => r.stocks),
    goods,
  )
  assert.deepEqual(restored.history, history)
  const copy = parseSave(JSON.stringify(restored))
  copy.regions[buyer.id].prices.iron *= 2
  copy.month++
  beginNationalAccounts(copy)
  near(reconcileGDP(copy)!.holdingGains, 0)
  near(value(copy, buyer.id), 1000, 'a new selling quote does not repeat the legacy rebase')
  assert.deepEqual(copy.economy!.inventoryValuation, restored.economy!.inventoryValuation)
  validateWorld(copy)
})

test('invalid costing adoption metadata cannot bypass save validation', () => {
  const { w } = fixture()
  reconcileGDP(w)
  for (const invalid of [
    null,
    { method: 'latest-price', adoptedMonth: 0, legacyAdjustment: 0 },
    { method: 'weighted-average', adoptedMonth: w.month + 1, legacyAdjustment: 0 },
    { method: 'weighted-average', adoptedMonth: 0, legacyAdjustment: Number.NaN },
  ]) {
    const copy = structuredClone(w)
    copy.economy!.inventoryValuation = invalid as never
    assert.throws(() => validateWorld(copy), /inventory valuation|non-finite number/)
  }
})
