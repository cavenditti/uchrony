/** Physical production, household substitution and extraction use real books. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { COMMODITIES, EXTENDED_GOODS } from '../src/sim/commodity-catalog'
import { generateWorld } from '../src/sim/generate'
import { ensureFirms, produceFirms, firmCapacity, regionalFirms } from '../src/sim/firms'
import { beginEconomyMonth, consumeHouseholds } from '../src/sim/macroeconomy'
import { BASE_PRICE, reserveTarget } from '../src/sim/economy'
import { auditGoods } from '../src/sim/goods-accounting'
import { auditLedger, balances } from '../src/sim/ledger'
import { GOOD_FACILITY, FACILITY_DEFINITIONS } from '../src/sim/facility-types'
import { facilitySitePotential } from '../src/sim/facility-investment'
import {
  productionRecipe,
  selectProductionTechniques,
  plannedInputDemand,
  validateProductionTechniques,
} from '../src/sim/production-chains'
import { constructionMaterials } from '../src/sim/construction-materials'
import { publicConstructionQuote, fundPublicConstruction } from '../src/sim/public-construction'
import { foodEquivalentInventory } from '../src/sim/food-basket'
import {
  ensureResourceStocks,
  extractExtendedResource,
  renewFishStocks,
  fishingPotential,
  fishCapacity,
  regionalMineralPotential,
  validateResourceStocks,
} from '../src/sim/resource-extraction'
import { parseSave, validateWorld } from '../src/sim/persistence'
import { packWorldSave } from '../src/sim/save-codec'
import { validateConfigurationValues } from '../src/sim/configuration'
import { DEFAULT_CONFIGURATION_VALUES } from '../src/sim/configuration-defaults'
import { withConfigurationValues } from '../src/sim/configuration-context'
import { GOODS, inventory, population, type Good, type World } from '../src/sim/types'
import { rebaseEndowments } from './fixtures/endowment'

let original: World
function fixture(output: Good = 'bricks') {
  original ??= generateWorld('extended-economic-chains', 3, 4)
  const w = structuredClone(original)
  ensureFirms(w)
  const r = w.regions.find((r) => r.nation >= 0 && r.coastal && population(r) > 10000)!
  assert(r)
  const n = w.nations[r.nation]
  n.technologies.industry = n.technologies.agriculture = 3
  n.ai = false
  r.stocks = inventory(10000)
  r.prices = { ...BASE_PRICE }
  const firms = regionalFirms(w, r.id),
    f = firms[0]
  for (const other of firms) other.active = other === f
  f.active = true
  f.employment = 1000
  f.cash = 10000
  f.capital = 10
  f.laborMix = { ...inventory(), [output]: 1 }
  rebaseEndowments(w)
  beginEconomyMonth(w)
  return { w, r, n, f }
}
const totalCash = (w: World) => Object.values(balances(w)).reduce((sum, value) => sum + value, 0)
const near = (a: number, b: number) =>
  assert(Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`)

test('the extended catalogue is exhaustive in prices, construction and editable configuration', () => {
  assert.equal(GOODS.length, 28)
  assert.deepEqual(validateConfigurationValues(DEFAULT_CONFIGURATION_VALUES), DEFAULT_CONFIGURATION_VALUES)
  for (const good of EXTENDED_GOODS) {
    assert(BASE_PRICE[good] > 0)
    assert.equal(FACILITY_DEFINITIONS[GOOD_FACILITY[good]].sector, good)
  }
})

for (const output of EXTENDED_GOODS.filter((good) => COMMODITIES[good].sector === 'workshop')) {
  test(`${output} consumes and pays for its configured inputs without creating cash`, () => {
    const { w, r, f } = fixture(output)
    const opening = { ...r.stocks },
      prices = { ...r.prices },
      cash = totalCash(w)
    produceFirms(w, r, true)
    const made = r.production[output]
    assert(made > 0)
    let cost = 0
    for (const [name, rate] of Object.entries(COMMODITIES[output].inputs)) {
      const good = name as Good
      near(opening[good] - r.stocks[good], made * rate)
      cost += (made * rate * prices[good]) / 1000
    }
    near(f.purchases, cost)
    near(totalCash(w), cash)
    auditGoods(w)
    auditLedger(w)
  })
  test(`${output} cannot manufacture a missing input`, () => {
    const { w, r } = fixture(output)
    const input = Object.keys(COMMODITIES[output].inputs)[0] as Good
    r.stocks[input] = 0
    rebaseEndowments(w)
    beginEconomyMonth(w)
    produceFirms(w, r, true)
    assert.equal(r.production[output], 0)
    assert(r.plannedProduction![output] > 0)
    assert(reserveTarget(r, input) > 0)
    auditGoods(w)
  })
}

test('fibre and steel choices change the same bills of materials used for procurement', () => {
  const { r } = fixture()
  r.prices.cotton = 1
  r.prices.steel = 1
  selectProductionTechniques(r, 3)
  assert.equal(r.productionTechniques!.textiles, 'cotton')
  assert.equal(r.productionTechniques!.tools, 'steel')
  assert.equal(productionRecipe(r, 'textiles').wool, undefined)
  assert(productionRecipe(r, 'textiles').cotton! > 0)
  const plan = { ...inventory(), tools: 10 }
  assert(plannedInputDemand(plan, 'steel', r) > 0)
  assert.equal(plannedInputDemand(plan, 'iron', r), 0)
  selectProductionTechniques(r, 0)
  assert.equal(r.productionTechniques!.tools, undefined, 'research gates steel tooling')
  r.productionTechniques!.tools = 'unknown'
  assert.throws(() => validateProductionTechniques(r), /production technique/)
})

test('cereal and fibre capacity share land and cannot produce without agricultural labor', () => {
  const { w, r, f } = fixture('grain')
  const one = firmCapacity(w, r, f, 1).q.grain
  assert(one > 0)
  f.laborMix = { ...inventory(), grain: 0.5, hemp: 0.5 }
  const split = firmCapacity(w, r, f, 1).q
  near(split.grain, one / 2)
  f.employment = 0
  assert.deepEqual(firmCapacity(w, r, f, 1).q, inventory())
  f.employment = 1000
  w.nations[r.nation].technologies.industry = 0
  f.laborMix = { ...inventory(), steel: 1 }
  assert.equal(firmCapacity(w, r, f, 1).q.steel, 0)
})

test('masonry purchases real bricks while preserving the ordinary stone alternative', () => {
  const { w, r, n } = fixture()
  r.prices.bricks = 1
  r.stocks.stone = 1000
  const originalRecipe = { timber: 2, stone: 100 }
  const selected = constructionMaterials(r, originalRecipe)
  near(selected.stone!, 30)
  near(selected.bricks!, 45.5)
  assert.equal(originalRecipe.stone, 100)
  const households = w.economy!.households[r.id]
  for (const h of Object.values(households)) {
    h.laborForce = 1000
    h.employed = 0
  }
  n.treasury = 10000
  rebaseEndowments(w)
  beginEconomyMonth(w)
  for (const h of Object.values(households)) {
    h.laborForce = 1000
    h.employed = 0
  }
  const quote = publicConstructionQuote(w, r, originalRecipe, 10),
    before = r.stocks.bricks
  assert(fundPublicConstruction(w, r, quote, 1, 10000, 'test masonry').amount > 0)
  near(before - r.stocks.bricks, quote.recipe.bricks!)
  auditLedger(w)
  auditGoods(w)
  r.stocks.bricks = 0
  assert.deepEqual(constructionMaterials(r, originalRecipe), originalRecipe)
})

for (const good of ['bread', 'fish', 'preservedFood'] as const)
  test(`${good} satisfies the existing household ration through actual purchases`, () => {
    const { w, r } = fixture()
    for (const f of w.economy!.firms!) {
      f.active = false
      f.stocks = inventory()
    }
    r.stocks = { ...inventory(), [good]: 10000 }
    for (const h of Object.values(w.economy!.households[r.id])) h.cash = 1000
    rebaseEndowments(w)
    beginEconomyMonth(w)
    // Custom coverage weights must recognize the same ration substitution.
    const values = validateConfigurationValues({
      ...DEFAULT_CONFIGURATION_VALUES,
      materialCoverage: { ...inventory(), food: 1 },
    })
    withConfigurationValues(values, () => consumeHouseholds(w))
    assert(r.consumption[good] > 0)
    for (const h of Object.values(w.economy!.households[r.id]))
      if (h.consumption[good] > 0) {
        assert.equal(h.consumption.food, 0)
        assert.equal(h.foodCoverage, 1)
        assert.equal(h.materialCoverage, 1)
        near(foodEquivalentInventory(h.consumption), h.consumption[good])
      }
    auditGoods(w)
    auditLedger(w)
  })

test('jewelry is discretionary and cannot outrank an unmet food ration', () => {
  for (const fed of [false, true]) {
    const { w, r } = fixture('jewelry')
    for (const f of w.economy!.firms!) {
      f.active = false
      f.stocks = inventory()
    }
    r.stocks = { ...inventory(), jewelry: 100, food: fed ? 10000 : 0 }
    for (const h of Object.values(w.economy!.households[r.id])) h.cash = 1000
    rebaseEndowments(w)
    beginEconomyMonth(w)
    consumeHouseholds(w)
    assert.equal(r.consumption.jewelry > 0, fed)
    auditGoods(w)
    auditLedger(w)
  }
})

test('capacity quotes leave untouched natural reservoirs and world records unchanged', () => {
  const { w, r, f } = fixture()
  delete w.resourceStocks
  const before = JSON.stringify(w)
  for (let repeat = 0; repeat < 20; repeat++) {
    assert(regionalMineralPotential(w, r, 'clay') > 0)
    assert(fishingPotential(w, r) > 0)
    firmCapacity(w, r, f, f.employment)
  }
  assert.equal(JSON.stringify(w), before)
})

test('finite mineral extraction cannot be reset by changing the district cell array', () => {
  const { w, r } = fixture()
  const stocks = ensureResourceStocks(w)
  assert(regionalMineralPotential(w, r, 'clay') > 0)
  const opening = r.cells.reduce((sum, id) => sum + (stocks.minerals[id]?.clay ?? 0), 0)
  near(extractExtendedResource(w, r, 'clay', opening * 2), opening)
  assert.equal(regionalMineralPotential(w, { ...r, cells: [...r.cells] }, 'clay'), 0)
  assert.equal(extractExtendedResource(w, r, 'clay', 1), 0)
  validateResourceStocks(w)
  const missing = r.cells.find((id) => stocks.minerals[id])!
  delete stocks.minerals[missing]
  assert.throws(() => validateResourceStocks(w), /resource stocks/)
})

test('shared fishing quotas survive repeated firms, partitions, renewal and restoration', () => {
  const { w, r } = fixture('fish')
  const stocks = ensureResourceStocks(w)
  const before = Object.values(stocks.fish).reduce((a, b) => a + b, 0)
  assert(fishingPotential(w, r) > 0)
  const caught = extractExtendedResource(w, r, 'fish', 1e12)
  assert(caught > 0)
  assert.equal(extractExtendedResource(w, { ...r, cells: [...r.cells] }, 'fish', 1e12), 0)
  near(before - Object.values(stocks.fish).reduce((a, b) => a + b, 0), caught)
  const depleted = Object.values(stocks.fish).reduce((a, b) => a + b, 0)
  renewFishStocks(w)
  near(
    Object.values(stocks.fish).reduce((a, b) => a + b, 0),
    depleted,
  )
  w.month++
  renewFishStocks(w)
  const renewed = Object.values(stocks.fish).reduce((a, b) => a + b, 0)
  assert(renewed > depleted && renewed <= before)
  for (const [id, value] of Object.entries(stocks.fish)) assert(value <= fishCapacity(w, +id))
  validateResourceStocks(w)
  const restored = parseSave(JSON.stringify(w))
  assert.deepEqual(restored.resourceStocks, stocks)
})

test('packed restoration preserves depleted minerals and the current shared fishing quota', () => {
  const { w, r } = fixture('fish'),
    stocks = ensureResourceStocks(w)
  for (const good of ['clay', 'salt', 'preciousOre'] as const) {
    const opening = r.cells.reduce((sum, id) => sum + (stocks.minerals[id]?.[good] ?? 0), 0)
    near(extractExtendedResource(w, r, good, opening * 2), opening)
  }
  const caught = extractExtendedResource(w, r, 'fish', 1e12)
  assert(caught > 0)
  const restored = parseSave(JSON.stringify(packWorldSave(w))),
    restoredRegion = restored.regions[r.id]
  assert.deepEqual(restored.resourceStocks, stocks)
  for (const good of ['clay', 'salt', 'preciousOre'] as const) {
    assert.equal(regionalMineralPotential(restored, restoredRegion, good), 0)
    assert.equal(extractExtendedResource(restored, restoredRegion, good, 1), 0)
  }
  assert.equal(extractExtendedResource(restored, restoredRegion, 'fish', 1e12), 0)
  w.month++
  restored.month++
  renewFishStocks(w)
  renewFishStocks(restored)
  assert.deepEqual(restored.resourceStocks, w.resourceStocks)
  const nextCatch = extractExtendedResource(w, r, 'fish', 1e12)
  assert(nextCatch > 0)
  near(extractExtendedResource(restored, restoredRegion, 'fish', 1e12), nextCatch)
  validateResourceStocks(restored)
})

test('new fishery sites require a real accessible coast', () => {
  const { w } = fixture()
  const coast = w.cells.find((c) => facilitySitePotential(w, c.id, 'fishery') > 0)!
  const inland = w.cells.find(
    (c) => c.terrain === 'plains' && facilitySitePotential(w, c.id, 'fishery') === 0,
  )!
  assert(coast && inland)
  assert.equal(facilitySitePotential(w, inland.id, 'fishery'), 0)
})

test('current saves reject incomplete commodity inventories without filling them', () => {
  const { w } = fixture()
  const current = structuredClone(w)
  delete (current.regions[0].stocks as Partial<(typeof current.regions)[0]['stocks']>).fish
  assert.throws(() => validateWorld(current), /invalid stocks/)
  assert.throws(() => parseSave(JSON.stringify(current)), /invalid stocks/)
})
