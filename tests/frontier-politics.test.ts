import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { prepareSpatialWorld, summarize, tick } from '../src/sim/engine'
import { advanceFrontierPolitics, FRONTIER_POLITICS } from '../src/sim/frontier-politics'
import { frontierValue } from '../src/sim/territorial-expansion'
import { reportedExpansionInterests } from '../src/sim/ambitions'
import { intelligenceService } from '../src/sim/intelligence'
import { rollupPopulation } from '../src/sim/population'
import { ensureAges } from '../src/sim/age-cohorts'
import { landComponents } from '../src/sim/land-connectivity'
import { balances, auditLedger } from '../src/sim/ledger'
import { rebaseEndowments } from './fixtures/endowment'
import { physicalStocks, auditGoods } from '../src/sim/goods-accounting'
import { validateWorld, restoreWorld } from '../src/sim/persistence'
import { packWorldSave } from '../src/sim/save-codec'
import { STRATA } from '../src/sim/economic-types'
import { population, type World } from '../src/sim/types'
import { withSimulationPeriod } from '../src/sim/simulation-period'
import { refreshSpatial } from '../src/sim/spatial'

function fixture() {
  const w = generateWorld('Independent frontier', 3, 8, undefined, 'regional', 'frontier')
  const home = w.regions[w.nations[0].capital]
  const connected = landComponents(w)
  const region = w.regions.find(
    (r) =>
      r.nation === -1 &&
      home.neighbors.includes(r.id) &&
      connected[r.center] >= 0 &&
      connected[r.center] === connected[home.center] &&
      r.neighbors.every((id) => w.regions[id].nation <= 0),
  )!
  assert(region)
  const group = structuredClone(home.communities![0])
  group.population = { children: 1500, adults: 4000, elders: 500 }
  delete group.ageCohorts
  delete group.ageMonth
  ensureAges(group, 0)
  group.allegiance = group.host = -1
  group.culture = w.nations[0].identity!.culture
  group.language = w.nations[0].identity!.language
  group.urban = 1
  region.communities = [group]
  rollupPopulation(region)
  region.infrastructure = 0.5
  region.foodCoverage = 1
  region.stocks.food = population(region) * 0.026 * 6
  w.nations.forEach((n) => {
    n.ai = false
    n.stability = n.legitimacy = 80
    n.foodCoverage = 1
  })
  w.relations.forEach((r) => {
    r.treaty = 'neutral'
  })
  refreshSpatial(w)
  prepareSpatialWorld(w)
  summarize(w, false)
  return { w, region }
}
const money = (w: World) => Object.values(balances(w)).reduce((sum, value) => sum + value, 0)
const advance = (w: World, months: number) => {
  for (let i = 0; i < months; i++) {
    w.month++
    advanceFrontierPolitics(w)
  }
}
const near = (a: number, b: number) => assert(Math.abs(a - b) < 1e-7, `${a} != ${b}`)

test('populated independent land joins a nearby state only after sustained ties, conserving people and assets', () => {
  const { w, region } = fixture()
  const people = w.regions.map(population),
    goods = physicalStocks(w),
    cash = money(w)
  const identities = region.communities!.map((g) => [g.culture, g.language, g.belief])
  advance(w, 12)
  assert.equal(region.nation, -1)
  const p = w.sovereignty!.frontiers!.find((p) => p.region === region.id)!
  assert(p.influence > 0 && p.influence < FRONTIER_POLITICS.influence)
  const before = JSON.stringify(p)
  advanceFrontierPolitics(w)
  assert.equal(JSON.stringify(p), before, 'repeated observations cannot accelerate influence')
  advance(w, 228)
  assert.equal(region.nation, 0)
  assert.deepEqual(w.regions.map(population), people)
  assert.deepEqual(physicalStocks(w), goods)
  near(money(w), cash)
  assert.deepEqual(
    region.communities!.map((g) => [g.culture, g.language, g.belief]),
    identities,
  )
  assert(region.communities!.every((g) => g.host === 0 && g.allegiance === 0))
  assert(
    w
      .localEconomy!.active.filter((id) => w.localEconomy!.units[id].province === region.id)
      .every((id) => w.localEconomy!.units[id].nation === 0),
  )
  assert.equal(w.adaptive!.jurisdictions[`province:${region.id}`].nation, 0)
  assert(w.events.some((e) => e.region === region.id && e.title.includes('joins')))
  auditLedger(w)
  auditGoods(w)
  summarize(w, false)
  validateWorld(w)
})

test('empty wilderness and communities beside a failing government do not accede', () => {
  const { w, region } = fixture()
  w.nations[0].stability = 10
  advance(w, 240)
  assert.equal(region.nation, -1)
  assert(w.regions.filter((r) => !population(r)).every((r) => r.nation === -1))
  assert.equal(w.sovereignty!.frontiers!.find((p) => p.region === region.id)!.influence, 0)
})

test('wealthy independent cities fund a full new state after years of prosperity', () => {
  const { w, region } = fixture()
  const city = w.localEconomy!.cities.find(
    (c) => c.absorbedBy === undefined && w.cells[c.nucleus].region === region.id && c.population >= 2000,
  )
  assert(city, 'fixture needs a real occupied city')
  const locals = w
    .localEconomy!.active.map((id) => w.localEconomy!.units[id])
    .filter((u) => u.province === region.id)
  for (const unit of locals) for (const stratum of STRATA) w.economy!.households[unit.id][stratum].cash = 100
  rebaseEndowments(w)
  const totalCash = money(w),
    goods = physicalStocks(w),
    people = w.regions.map(population)
  const count = w.nations.length
  advance(w, FRONTIER_POLITICS.prosperityMonths - 1)
  assert.equal(w.nations.length, count)
  advance(w, 1)
  assert.equal(w.nations.length, count + 1)
  const state = w.nations[count]
  assert.equal(region.nation, state.id)
  assert.equal(state.capital, region.id)
  assert.equal(w.regions.filter((r) => r.nation === state.id).length, 1)
  assert(state.treasury > 0 && state.treasury < 100)
  assert(state.identity && state.character && state.ai)
  assert.equal(w.relations.filter((r) => r.a === count || r.b === count).length, count)
  assert(w.intelligence!.services.some((s) => s.nation === count))
  assert.equal(w.armies.filter((a) => a.nation === count).length, 0)
  near(money(w), totalCash)
  assert.deepEqual(physicalStocks(w), goods)
  assert.deepEqual(w.regions.map(population), people)
  auditLedger(w)
  auditGoods(w)
  summarize(w, false)
  validateWorld(w)
  const restored = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(w))))
  tick(w)
  tick(restored)
  validateWorld(w)
  validateWorld(restored)
  assert.deepEqual(packWorldSave(w), packWorldSave(restored))
})

test('frontier progress survives saves, respects coarse elapsed time, and rejects corrupt fields', () => {
  const { w, region } = fixture()
  advance(w, 60)
  const restored = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(w))))
  const coarse = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(w))))
  advance(w, 60)
  advance(restored, 60)
  for (let i = 0; i < 10; i++)
    withSimulationPeriod(6, () => {
      coarse.month += 6
      advanceFrontierPolitics(coarse)
    })
  assert.deepEqual(packWorldSave(w), packWorldSave(restored))
  const p = w.sovereignty!.frontiers!.find((p) => p.region === region.id)!
  const q = coarse.sovereignty!.frontiers!.find((p) => p.region === region.id)!
  near(p.influence, q.influence)
  assert(Math.abs(p.mandate - q.mandate) < 6)
  for (const field of ['influence', 'nation', 'city', 'updated', 'mandate'] as const) {
    const broken = structuredClone(w)
    ;(broken.sovereignty!.frontiers![0] as unknown as Record<string, number>)[field] = Infinity
    assert.throws(() => validateWorld(broken))
  }
  advance(w, 120)
  advance(restored, 120)
  assert.equal(region.nation, 0)
  assert.deepEqual(packWorldSave(w), packWorldSave(restored))
})

test('economic and cultural interests make expansion targets more attractive without hidden foreign data', () => {
  const { w, region } = fixture(),
    n = w.nations[0]
  const baseline = frontierValue(w, n, region)
  const resource = structuredClone(region)
  resource.fertility += 0.2
  resource.deposits.iron += 0.5
  assert(frontierValue(w, n, resource).score > baseline.score)
  resource.communities!.forEach((g) => {
    g.culture = g.language = -1
  })
  assert.equal(frontierValue(w, n, resource).cultural, 0)
  assert(baseline.cultural > 0.9)
  const service = intelligenceService(w, 0)
  service.dossiers = []
  assert.deepEqual(reportedExpansionInterests(w, n, 1), { cultural: 0, economic: 0 })
})
