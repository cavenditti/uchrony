import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { prepareSpatialWorld, applyCommand, tick } from '../src/sim/engine'
import { foundingPlan, advanceFounding, FOUNDING } from '../src/sim/founding'
import { population, GOODS } from '../src/sim/types'
import { balances, auditLedger } from '../src/sim/ledger'
import { physicalStocks, auditGoods } from '../src/sim/goods-accounting'
import { validateWorld, restoreWorld } from '../src/sim/persistence'
import { packWorldSave } from '../src/sim/save-codec'
import { viewSnapshot } from '../src/sim/view-snapshot'
import { residentialSites, syncResidentialPopulation } from '../src/sim/residential-sites'
import { refreshCityLabels } from '../src/sim/cities'
import { refreshAdaptiveTotals } from '../src/sim/adaptive-world'
import { rollupPopulation } from '../src/sim/population'
import { ensureAges } from '../src/sim/age-cohorts'
import { aggregateDistricts } from '../src/sim/districts'

function fixture() {
  const w = generateWorld('Frontier probe', 3, 8, undefined, 'regional', 'frontier')
  prepareSpatialWorld(w)
  return w
}
const sum = (n: Record<string, number>) => Object.values(n).reduce((a, b) => a + b, 0)
function candidate(w: ReturnType<typeof fixture>, nation = 0) {
  return w.regions.find((r) => {
    if (r.nation !== -1) return false
    try {
      foundingPlan(w, nation, r.center)
      return true
    } catch {
      return false
    }
  })!
}
const near = (a: number, b: number) => assert(Math.abs(a - b) < 1e-7, `${a} != ${b}`)

test('frontier starts with one supplied settlement per state and mostly empty unclaimed wilderness', () => {
  const w = fixture(),
    neutral = w.regions.filter((r) => r.nation === -1)
  assert(neutral.length > w.regions.length * 0.8)
  assert(neutral.filter((r) => population(r) === 0).length > neutral.length * 0.75)
  assert(neutral.some((r) => population(r) > 0))
  assert.equal(w.nations.length, 8)
  assert.equal(w.armies.length, 0)
  assert(w.localEconomy!.cities.filter((c) => c.absorbedBy === undefined).length > 8)
  assert(neutral.some((r) => population(r) >= 1800))
  for (const n of w.nations) {
    const owned = w.regions.filter((r) => r.nation === n.id)
    assert.equal(owned.length, 1)
    assert.equal(population(owned[0]), 2500)
    assert.equal(n.treasury, 500)
    const units = w
      .localEconomy!.active.map((id) => w.localEconomy!.units[id])
      .filter((u) => u.nation === n.id)
    near(
      units.reduce((total, u) => total + u.stocks.food, 0),
      780,
    )
    near(
      units.reduce((total, u) => total + u.stocks.tools, 0),
      80,
    )
  }
  assert.equal(
    w.totals.population,
    w.regions.reduce((n, r) => n + population(r), 0),
  )
  assert(Object.values(w.adaptive!.jurisdictions).every((j) => j.nation >= 0))
  const view = viewSnapshot(w)
  assert.equal(view.regions.filter((r) => r.nation === -1).length, neutral.length)
  assert.equal(
    view.viewHomes!.reduce((n, h) => n + h.residents!, 0),
    w.totals.population,
  )
  validateWorld(w)
})

test('founding transfers exact dated people, deposits and food, and pays for physical construction', () => {
  const w = fixture(),
    r = candidate(w),
    plan = foundingPlan(w, 0, r.center)
  const before = {
    cities: w.localEconomy!.cities.filter((c) => c.absorbedBy === undefined).length,
    people: w.totals.population,
    source: population(plan.source),
    target: population(plan.target),
    money: sum(balances(w)),
    goods: physicalStocks(w),
    cash: w.nations[0].treasury,
  }
  const ages = () =>
    w.regions
      .flatMap((r) => r.communities ?? [])
      .flatMap((g) => g.ageCohorts ?? [])
      .reduce((n, [, f, m]) => n + f + m, 0)
  const dated = ages()
  const homesBefore = new Set(residentialSites(w).map((s) => s.id))
  applyCommand(w, { type: 'found-settlement', nation: 0, cell: r.center })
  assert.equal(w.totals.population, before.people)
  assert.equal(ages(), dated)
  assert.equal(population(plan.source), before.source - FOUNDING.people)
  assert.equal(population(plan.target), before.target + FOUNDING.people)
  near(sum(balances(w)), before.money)
  near(w.nations[0].treasury, before.cash - FOUNDING.cash)
  const goods = physicalStocks(w)
  for (const good of GOODS)
    near(
      goods[good],
      before.goods[good] -
        (['timber', 'stone', 'tools'].includes(good) ? FOUNDING[good as 'timber' | 'stone' | 'tools'] : 0),
    )
  assert.equal(r.nation, 0)
  assert.equal(w.regions.filter((r) => r.nation >= 0).length, 9)
  const camp = residentialSites(w).filter((s) => !homesBefore.has(s.id))
  assert.equal(
    camp.reduce((n, s) => n + s.residents!, 0),
    600,
  )
  near(
    camp.reduce((n, s) => n + s.capacity, 0),
    700,
  )
  assert(camp.every((s) => !!s.building && s.parcel!.size >= 10 && s.parcel!.size <= 40))
  assert.equal(w.localEconomy!.cities.filter((c) => c.absorbedBy === undefined).length, before.cities + 1)
  assert.equal(w.adaptive!.jurisdictions[`municipality:${r.id}`].nation, 0)
  auditLedger(w)
  auditGoods(w)
  validateWorld(w)
  tick(w)
  validateWorld(w)
})

test('invalid, foreign, occupied and unfunded founding orders leave the world unchanged', () => {
  const w = fixture(),
    target = candidate(w).center
  for (const cell of [
    -1,
    NaN,
    w.cells.find((c) => c.terrain === 'water')!.id,
    w.regions[w.nations[1].capital].center,
    w.regions[w.nations[0].capital].center,
  ]) {
    const before = JSON.stringify(w)
    assert.throws(() => foundingPlan(w, 0, cell))
    assert.equal(JSON.stringify(w), before)
  }
  w.nations[0].treasury = 0
  const before = JSON.stringify(w)
  assert.throws(() => foundingPlan(w, 0, target), /treasury/)
  assert.equal(JSON.stringify(w), before)
})

test('autonomous founding uses the same resources and respects player control', () => {
  const w = fixture()
  w.nations.forEach((n) => {
    n.ai = false
  })
  w.month = 1
  advanceFounding(w)
  assert.equal(w.regions.filter((r) => r.nation >= 0).length, 8)
  w.nations[0].ai = true
  advanceFounding(w)
  assert.equal(w.regions.filter((r) => r.nation >= 0).length, 9)
  near(w.nations[0].treasury, 460)
  auditLedger(w)
})

test('unclaimed communities can become visible settlements without becoming states', () => {
  const w = fixture(),
    local = w.localEconomy!
  const unit = local.active.map((id) => local.units[id]).find((u) => u.nation === -1 && population(u) > 0)!
  const group = unit.communities![0]
  // Controlled growth fixture: exercise the ordinary physical settlement classifier.
  group.population.adults += 650
  delete group.ageCohorts
  ensureAges(group, w.month)
  rollupPopulation(unit)
  const home = w.adaptive!.sites[`home:${unit.center}`]
  for (const site of residentialSites(w).filter((s) => s.pool === unit.id)) site.residents = 0
  home.residents = population(unit)
  home.capacity = population(unit) * 1.2
  home.investedValue = 20
  home.openingBuilt = 0.08
  syncResidentialPopulation(w)
  aggregateDistricts(w)
  refreshAdaptiveTotals(w)
  refreshCityLabels(w)
  assert(w.localEconomy!.cities.some((c) => c.sites?.includes(home.id) && c.absorbedBy === undefined))
  assert.equal(unit.nation, -1)
  assert.equal(w.nations.length, 8)
  assert(!Object.values(w.adaptive!.jurisdictions).some((j) => j.cells.includes(home.cell)))
})

test('frontier months and a restored save remain deterministic across independent communities and state expansion', () => {
  const w = fixture()
  for (let i = 0; i < 6; i++) {
    tick(w)
    validateWorld(w)
  }
  assert(w.regions.filter((r) => r.nation >= 0).length > 8)
  const restored = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(w))))
  for (let i = 0; i < 6; i++) {
    tick(w)
    tick(restored)
    validateWorld(w)
    validateWorld(restored)
  }
  assert.equal(JSON.stringify(packWorldSave(restored)), JSON.stringify(packWorldSave(w)))
})

test('existing settled worlds keep their ownership and are not rewritten as frontier starts', () => {
  const legacy = generateWorld('Existing ownership', 3, 8)
  assert.equal(legacy.settlementStart, undefined)
  assert(legacy.regions.every((r) => r.nation >= 0))
  const owners = legacy.regions.map((r) => r.nation)
  prepareSpatialWorld(legacy)
  assert.deepEqual(
    legacy.regions.map((r) => r.nation),
    owners,
  )
  validateWorld(legacy)
})
