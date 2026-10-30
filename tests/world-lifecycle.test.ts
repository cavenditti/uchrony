import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { applyCommand, prepareSpatialWorld, summarize, tick } from '../src/sim/engine'
import { retireEmptyStates } from '../src/sim/extinction'
import { urbanOpportunityByDistrict } from '../src/sim/urban-demography'
import { desiredFertility } from '../src/sim/age-cohorts'
import { rollupPopulation } from '../src/sim/population'
import { aggregateDistricts } from '../src/sim/districts'
import { syncResidentialPopulation } from '../src/sim/residential-sites'
import { refreshPlaces } from '../src/sim/places'
import { refreshAdaptiveTotals } from '../src/sim/adaptive-world'
import { refreshSpatial } from '../src/sim/spatial'
import { balances, auditLedger } from '../src/sim/ledger'
import { physicalStocks, auditGoods } from '../src/sim/goods-accounting'
import { auditBanks } from '../src/sim/banking'
import { validateWorld, restoreWorld } from '../src/sim/persistence'
import { packWorldSave } from '../src/sim/save-codec'
import { militaryPeople } from '../src/sim/forces'
import { EXPANSION_PROFILES, withExpansionParameters } from '../src/sim/expansion-parameters'

function fixture() {
  const w = generateWorld('Life and abandonment', 3, 8, undefined, 'regional', 'frontier')
  prepareSpatialWorld(w)
  return w
}

test('a compact farming village does not receive a metropolis fertility penalty', () => {
  const w = fixture(),
    city = w.localEconomy!.cities.find((c) => c.population === 2500)!
  const site = w.adaptive!.sites[city.sites![0]],
    unit = w.localEconomy!.units[site.pool]
  const before = JSON.stringify(w)
  const rural = withExpansionParameters(EXPANSION_PROFILES.expansionist, () =>
    urbanOpportunityByDistrict(w)!.get(unit.id)!,
  )
  assert(rural > 0 && rural < 0.1)
  assert.equal(JSON.stringify(w), before)
  assert.equal(
    withExpansionParameters(EXPANSION_PROFILES.baseline, () => urbanOpportunityByDistrict(w)),
    undefined,
  )
  const group = unit.communities![0]
  assert(desiredFertility({ ...group, urban: rural }) > desiredFertility({ ...group, urban: 1 }))
  city.population = 50000
  city.name = 'A cosmetic metropolis'
  assert.equal(urbanOpportunityByDistrict(w)!.get(unit.id), rural)
  w.localEconomy!.cities = []
  assert.equal(urbanOpportunityByDistrict(w)!.get(unit.id), rural)
  site.residents = 50000
  const urban = urbanOpportunityByDistrict(w)!.get(unit.id)!
  assert(urban > rural * 10)
})

test('settlement label thresholds do not erase residents, and empty cities become historical', () => {
  const w = fixture(),
    city = w.localEconomy!.cities[0]
  const sites = city.sites!.map((id) => w.adaptive!.sites[id])
  for (const site of sites) site.residents = 0
  sites[0].residents = 123
  refreshPlaces(w)
  assert.equal(city.population, 123)
  assert.equal(city.abandoned, undefined)
  assert(city.sites!.includes(sites[0].id))
  sites[0].residents = 0
  refreshPlaces(w)
  assert.equal(city.population, 0)
  assert.equal(city.abandoned, w.month)
  assert.equal(city.cells.length, 0)
  assert.equal(city.sites!.length, 0)
  const before = JSON.stringify(city)
  refreshPlaces(w)
  assert.equal(JSON.stringify(city), before)
})

test('a zero-population state relinquishes claims and diplomacy without deleting assets or IDs', () => {
  const w = fixture(),
    nation = w.nations[0],
    capital = nation.capital
  for (const id of w.localEconomy!.active) {
    const unit = w.localEconomy!.units[id]
    if (unit.nation !== 0) continue
    unit.communities = []
    rollupPopulation(unit)
  }
  aggregateDistricts(w)
  syncResidentialPopulation(w)
  const money = balances(w),
    goods = physicalStocks(w)
  w.relations.find((r) => r.a === 0)!.treaty = 'war'
  assert(retireEmptyStates(w))
  assert.equal(nation.extinct, w.month)
  assert.equal(nation.ai, false)
  assert.equal(w.nations.length, 8, 'history and financial references retain stable IDs')
  assert.equal(w.regions[capital].nation, -1)
  assert(!w.regions.some((r) => r.nation === 0))
  assert(w.relations.filter((r) => r.a === 0 || r.b === 0).every((r) => r.treaty === 'neutral'))
  assert.deepEqual(balances(w), money)
  assert.deepEqual(physicalStocks(w), goods)
  assert(!retireEmptyStates(w), 'retirement is recorded once')
  applyCommand(w, { type: 'control', nation: null })
  assert.equal(nation.ai, false, 'observer mode cannot revive an extinct government')
  assert.throws(() => applyCommand(w, { type: 'control', nation: 0 }), /ceased to exist/)
  refreshPlaces(w)
  refreshAdaptiveTotals(w)
  refreshSpatial(w)
  summarize(w, false)
  validateWorld(w)
  auditLedger(w)
  auditGoods(w)
  auditBanks(w)
  const restored = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(w))))
  tick(w)
  tick(restored)
  assert.deepEqual(packWorldSave(w), packWorldSave(restored))
  assert(!w.regions.some((r) => r.nation === 0))
})

test('a state with surviving military residents is not mistaken for an extinct population', () => {
  const w = generateWorld('Military survivors', 3, 4)
  assert(militaryPeople(w, 0) > 0)
  for (const r of w.regions.filter((r) => r.nation === 0)) {
    r.communities = []
    rollupPopulation(r)
  }
  retireEmptyStates(w)
  assert.equal(w.nations[0].extinct, undefined)
  assert(w.regions.some((r) => r.nation === 0))
})
