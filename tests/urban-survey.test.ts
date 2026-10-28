import test from 'node:test'
import assert from 'node:assert/strict'
import { urbanFixture } from './fixtures/urban-evolution'
import { ensureUrbanFabric, validateUrbanFabric } from '../src/sim/urban-fabric'
import { advanceUrbanSurvey } from '../src/sim/urban-survey'
import { urbanMetrics } from '../src/sim/urban-metrics'
import { settlementPlaces } from '../src/map/settlement-scenery'
import { generateWorld } from '../src/sim/generate'
import { prepareSpatialWorld, advanceCoarsePeriod } from '../src/sim/engine'
import { validateWorld, parseSave } from '../src/sim/persistence'
import { packWorldSave } from '../src/sim/save-codec'
import { refreshSpatial } from '../src/sim/spatial'
import { polygonArea } from '../src/sim/physical-space'

test('small legacy supports enter physical renewal without creating residents, space or capital', () => {
  const { w, sites } = urbanFixture()
  delete w.adaptive!.buildingVersion
  const source = sites[0]
  delete source.building
  source.capacity = 16
  source.openingCapacity = 16
  source.openingBuilt = 0.2
  source.investedValue = 77
  source.capitalOwner = 'household:0:owner'
  ensureUrbanFabric(w)
  const before = urbanMetrics(w),
    money = JSON.stringify(w.economy),
    area = Object.values(w.adaptive!.sites).reduce((n, s) => n + s.fabric!.floorArea, 0)
  assert.equal(advanceUrbanSurvey(w), true)
  const after = urbanMetrics(w)
  assert.equal(after.residents, before.residents)
  assert.ok(Math.abs(after.capacity - before.capacity) < 1e-8)
  assert.equal(JSON.stringify(w.economy), money)
  assert.ok(
    Math.abs(Object.values(w.adaptive!.sites).reduce((n, s) => n + (s.investedValue ?? 0), 0) - 77) < 1e-8,
  )
  assert.ok(
    Math.abs(Object.values(w.adaptive!.sites).reduce((n, s) => n + s.fabric!.floorArea, 0) - area) < 1e-8,
  )
  assert.ok(source.building)
  assert.equal(source.fabric!.survey, 'recorded')
  assert.ok(
    Object.values(w.adaptive!.sites)
      .filter((s) => s.id === source.id || s.fabric?.predecessors.includes(source.id))
      .every((s) => s.capitalOwner === source.capitalOwner),
  )
  validateUrbanFabric(w)
  w.spatial = { version: 1, month: w.month, settlements: [], districts: [], splits: [] } as typeof w.spatial
  assert.equal(settlementPlaces(w).filter((p) => p.nucleusSite === source.id).length, 1)
})

test('large legacy parcels release bounded physical buildings and retain their remaining assets', () => {
  const { w, sites } = urbanFixture()
  delete w.adaptive!.buildingVersion
  delete sites[0].building
  sites[0].capacity = 100000
  sites[0].openingCapacity = 100000
  sites[0].openingBuilt = 0.2
  sites[0].investedValue = 77
  ensureUrbanFabric(w)
  const before = urbanMetrics(w),
    area = Object.values(w.adaptive!.sites).reduce((n, s) => n + s.fabric!.floorArea, 0)
  assert.equal(advanceUrbanSurvey(w), true)
  const after = urbanMetrics(w)
  assert.equal(after.residents, before.residents)
  assert.ok(Math.abs(after.capacity - before.capacity) < 1e-6)
  assert.equal(after.buildings - before.buildings, 8)
  assert.equal(sites[0].fabric!.survey, 'aggregate')
  assert.ok(sites[0].capacity >= 99936)
  assert.ok(
    Math.abs(Object.values(w.adaptive!.sites).reduce((n, s) => n + s.fabric!.floorArea, 0) - area) < 1e-6,
  )
  assert.ok(
    Math.abs(Object.values(w.adaptive!.sites).reduce((n, s) => n + (s.investedValue ?? 0), 0) - 77) < 1e-8,
  )
  assert.ok(
    Object.values(w.adaptive!.sites)
      .filter((s) => s.building)
      .every((s) => s.fabric!.floorArea <= polygonArea(s.building!) * 4 + 1e-6),
  )
  validateUrbanFabric(w)
  w.viewOnly = true
  const state = JSON.stringify(w)
  assert.equal(advanceUrbanSurvey(w), false)
  assert.equal(JSON.stringify(w), state)
})

test('a generated legacy city gains surveyed buildings without changing its accounts and survives a save', () => {
  const w = generateWorld('Urban legacy qualification', 3, 8, undefined, 'regional')
  prepareSpatialWorld(w)
  ensureUrbanFabric(w)
  const before = urbanMetrics(w),
    economy = JSON.stringify(w.economy)
  w.month = 6
  assert.equal(advanceUrbanSurvey(w), true)
  const after = urbanMetrics(w)
  assert.equal(after.residents, before.residents)
  assert.ok(Math.abs(after.capacity - before.capacity) < 1e-6)
  assert.equal(JSON.stringify(w.economy), economy)
  assert.ok(after.buildings > before.buildings && after.buildings <= before.buildings + 16)
  refreshSpatial(w) // The engine refreshes settlement census before every save.
  validateWorld(w)
  const restored = parseSave(JSON.stringify(packWorldSave(w)))
  assert.deepEqual(urbanMetrics(restored), after)
  advanceCoarsePeriod(restored, 6)
  validateWorld(restored)
  assert.deepEqual(urbanMetrics(parseSave(JSON.stringify(packWorldSave(restored)))), urbanMetrics(restored))
})

test('blocked legacy frontage waits without mutating the census or creating partial buildings', () => {
  const { w, sites } = urbanFixture()
  delete w.adaptive!.buildingVersion
  delete sites[0].building
  sites[0].capacity = 100000
  sites[0].openingBuilt = 0.2
  for (const c of w.cells) c.terrain = 'water'
  ensureUrbanFabric(w)
  const before = JSON.stringify(w)
  assert.equal(advanceUrbanSurvey(w), false)
  assert.equal(JSON.stringify(w), before)
})
