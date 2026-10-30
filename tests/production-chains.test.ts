/** Supply shocks exercise paid physical production, not just catalogue entries. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { ensureFirms, produceFirms, regionalFirms } from '../src/sim/firms'
import { beginEconomyMonth } from '../src/sim/macroeconomy'
import { auditGoods } from '../src/sim/goods-accounting'
import { auditLedger } from '../src/sim/ledger'
import {
  BASE_PRICE,
  householdNeed,
  reserveTarget,
  trade,
  transportGraph,
  shortestPaths,
} from '../src/sim/economy'
import { DEFAULT_CONFIGURATION_VALUES } from '../src/sim/configuration-defaults'
import { withConfigurationValues } from '../src/sim/configuration-context'
import { validateConfigurationValues } from '../src/sim/configuration'
import { GOOD_FACILITY, FACILITY_DEFINITIONS } from '../src/sim/facility-types'
import { industrialLaborShare, plannedInputDemand, EXTRACTIVE_OUTPUTS } from '../src/sim/production-chains'
import { parseSave, validateWorld } from '../src/sim/persistence'
import { economicLandscape, TILE_ACTIVITIES } from '../src/sim/economic-landscape'
import { GOODS, GOOD_LABELS, inventory, population, type Good, type World } from '../src/sim/types'
import { RESOURCE_KEYS } from '../src/map/natural-resources'
import { rebaseEndowments } from './fixtures/endowment'

let baseline: World
function fixture(output: Good = 'iron') {
  baseline ??= generateWorld('physical-supply-chains', 3, 4)
  const w = structuredClone(baseline)
  ensureFirms(w)
  const r = w.regions.find((r) => r.nation >= 0 && population(r) > 10000)!
  const firms = regionalFirms(w, r.id),
    f = firms[0]
  for (const other of firms) other.active = other === f
  r.stocks = inventory(10000)
  r.prices = { ...BASE_PRICE }
  f.active = true
  f.employment = 1000
  f.cash = 10000
  f.capital = 10
  f.payroll = 1
  f.laborMix = { ...inventory(), [output]: 1 }
  rebaseEndowments(w)
  beginEconomyMonth(w)
  return { w, r, f }
}

test('every good has a matching constructible sector and ore alone maps to iron deposits', () => {
  for (const good of GOODS) assert.equal(FACILITY_DEFINITIONS[GOOD_FACILITY[good]].sector, good)
  assert.equal(EXTRACTIVE_OUTPUTS.ironOre, 'iron')
  assert.equal(EXTRACTIVE_OUTPUTS.iron, undefined)
  assert.equal(industrialLaborShare({ ...inventory(), ironOre: 0.2, charcoal: 0.3, wool: 0.5 }), 0.5)
  assert.equal(industrialLaborShare(undefined), 0)
  assert.equal(industrialLaborShare({ ...inventory(), clay: 0.1, salt: 0.2, preciousOre: 0.1, fish: 0.6 }), 0.4)
  assert.equal(GOOD_LABELS.ironOre, 'Iron ore')
  assert.equal(RESOURCE_KEYS.iron.name, GOOD_LABELS.ironOre)
})

test('upstream demand follows the actual recipes and remains isolated across configurations', () => {
  const plan = { ...inventory(), iron: 10, charcoal: 2, textiles: 20 }
  assert.equal(plannedInputDemand(plan, 'ironOre'), 16)
  assert.equal(plannedInputDemand(plan, 'timber'), 8)
  assert.equal(plannedInputDemand(plan, 'wool'), 23)
  const custom = structuredClone(DEFAULT_CONFIGURATION_VALUES)
  custom.recipes.textiles.wool = 2
  withConfigurationValues(custom, () => assert.equal(plannedInputDemand(plan, 'wool'), 40))
  assert.equal(plannedInputDemand(plan, 'wool'), 23)
  assert.equal(plannedInputDemand(inventory(), 'ironOre'), 0)
})

test('industrial reserves include upstream orders without inventing household consumption', () => {
  const { r } = fixture()
  r.plannedProduction = { ...inventory(), iron: 10, charcoal: 2, textiles: 20 }
  for (const good of ['ironOre', 'charcoal', 'wool'] as const) assert.equal(householdNeed(r, good), 0)
  assert.equal(reserveTarget(r, 'ironOre'), 32)
  assert.equal(reserveTarget(r, 'charcoal'), 14)
  assert.equal(reserveTarget(r, 'wool'), 46)
})

test('normal production retains upstream industrial orders while assigning paid labor', () => {
  const { w, r } = fixture()
  r.deposits.iron = 1
  r.prices.flax = r.prices.cotton = 10000
  r.fertility = 0.8
  r.plannedProduction = { ...inventory(), iron: 100, charcoal: 100, textiles: 100 }
  produceFirms(w, r)
  assert(r.production.ironOre > 0, 'smelting orders must reach the ore labor plan')
  assert(r.production.wool > 0, 'textile orders must reach agricultural employment')
  auditGoods(w)
  auditLedger(w)
})

test('input demand queries read only relevant output plans at regional scale', () => {
  let reads = 0
  const plan = new Proxy(
    { ...inventory(), iron: 10 },
    {
      get(target, key: keyof typeof target) {
        reads++
        return target[key]
      },
    },
  )
  for (let region = 0; region < 1400; region++) assert.equal(plannedInputDemand(plan, 'ironOre'), 16)
  assert.equal(reads, 1400, 'one consuming output per ore query, rather than a catalogue scan')
})

for (const [output, input] of [
  ['iron', 'ironOre'],
  ['iron', 'charcoal'],
  ['charcoal', 'timber'],
  ['textiles', 'wool'],
] as const)
  test(`${output} stops without ${input}, while its unfilled input order survives`, () => {
    const { w, r } = fixture(output)
    r.stocks[input] = 0
    rebaseEndowments(w)
    beginEconomyMonth(w)
    produceFirms(w, r, true)
    assert.equal(r.production[output], 0)
    assert(r.plannedProduction![output] > 0)
    assert(reserveTarget(r, input) > 0)
    auditGoods(w)
    auditLedger(w)
  })

for (const output of ['iron', 'charcoal', 'textiles'] as const)
  test(`${output} pays for and consumes its full bill of materials`, () => {
    const { w, r, f } = fixture(output)
    const opening = { ...r.stocks },
      prices = { ...r.prices }
    produceFirms(w, r, true)
    const made = r.production[output]
    assert(made > 0)
    let purchaseCost = 0
    for (const [input, rate] of Object.entries(DEFAULT_CONFIGURATION_VALUES.recipes[output])) {
      const good = input as Good
      assert(Math.abs(opening[good] - r.stocks[good] - made * rate) < 1e-8)
      purchaseCost += (made * rate * prices[good]) / 1000
    }
    assert(Math.abs(f.purchases - purchaseCost) < 1e-8)
    auditGoods(w)
    auditLedger(w)
  })

test('pasture, ore extraction and smelting retain distinct physical map activities', () => {
  for (const [good, expected] of [
    ['wool', 'pasture'],
    ['ironOre', 'iron'],
    ['iron', 'workshops'],
  ] as const) {
    const { w, r, f } = fixture(good)
    for (const other of w.economy!.firms!) other.active = other === f
    for (const id of r.cells) w.cells[id].landscape!.resources.iron = 1
    const view = economicLandscape(w)
    assert(r.cells.some((id) => TILE_ACTIVITIES[view.activity[id]] === expected))
  }
})

test('current saves round trip and reject missing upstream quantities or unknown schemas', () => {
  baseline ??= generateWorld('physical-supply-chains', 3, 4)
  assert.deepEqual(parseSave(JSON.stringify(baseline)), baseline)
  const corrupt = structuredClone(baseline)
  delete (corrupt.regions[0].stocks as Partial<ReturnType<typeof inventory>>).wool
  assert.throws(() => validateWorld(corrupt), /invalid stocks/)
  assert.throws(() => validateWorld({ ...baseline, version: 999 }), /unsupported version/)
})

test('industrial wool orders create paid physical trade without household wool demand', () => {
  const { w, r: buyer } = fixture('textiles')
  const paths = shortestPaths(transportGraph(w), buyer.id)
  const seller = w.regions
    .filter((r) => r.id !== buyer.id && r.nation === buyer.nation && Number.isFinite(paths.distance[r.id]))
    .sort((a, b) => paths.distance[a.id] - paths.distance[b.id])[0]
  assert(seller)
  for (const r of w.regions) r.plannedProduction = inventory()
  buyer.plannedProduction = { ...inventory(), textiles: 20 }
  for (const r of w.regions) for (const good of GOODS) r.stocks[good] = reserveTarget(r, good)
  buyer.stocks.wool = 0
  seller.stocks.wool = 100
  rebaseEndowments(w)
  beginEconomyMonth(w)
  const openingCash = w.economy!.producers[seller.id].cash
  trade(w)
  assert(w.routes.some((route) => route.to === buyer.id && route.goods.wool > 0))
  assert(buyer.stocks.wool > 0)
  assert(w.economy!.producers[seller.id].cash > openingCash)
  auditGoods(w)
  auditLedger(w)
})

test('textile configuration rejects retired placeholders and accepts physical wool recipes', () => {
  assert.throws(
    () => validateConfigurationValues({ recipes: { textiles: { timber: 0.3, food: 0.12 } } }),
    /unknown parameter/,
  )
  const custom = validateConfigurationValues({ recipes: { textiles: { wool: 2 } } })
  assert.equal(custom.recipes.textiles.wool, 2)
  assert.throws(
    () => validateConfigurationValues({ recipes: { textiles: { cotton: 1 } } }),
    /unknown parameter/,
  )
})

test('frontier upstream stockpiles are explicit, configurable and scaled only at creation', () => {
  const values = validateConfigurationValues({
    starting: { stockpileScale: 2, capitalStocks: { ironOre: 10, charcoal: 20, wool: 30 } },
  })
  const w = generateWorld('frontier-upstream-endowments', 3, 4, undefined, 'regional', 'frontier', values)
  for (const n of w.nations) {
    const stocks = w.regions[n.capital].stocks
    assert.equal(stocks.ironOre, 20)
    assert.equal(stocks.charcoal, 40)
    assert.equal(stocks.wool, 60)
  }
  for (const r of w.regions.filter((r) => population(r) === 0)) {
    assert.equal(r.stocks.ironOre + r.stocks.charcoal + r.stocks.wool, 0)
  }
  assert.deepEqual(parseSave(JSON.stringify(w)), w)
})
