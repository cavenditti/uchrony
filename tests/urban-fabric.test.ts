import test from 'node:test'
import assert from 'node:assert/strict'
import { urbanFixture } from './fixtures/urban-evolution'
import { ensureUrbanFabric, validateUrbanFabric } from '../src/sim/urban-fabric'
import { urbanMetrics } from '../src/sim/urban-metrics'
import { urbanShape, advanceUrbanConstruction } from '../src/sim/urban-construction'

test('fabric migration preserves physical census and is idempotent', () => {
  const { w } = urbanFixture()
  const before = urbanMetrics(w)
  ensureUrbanFabric(w)
  assert.deepEqual(urbanMetrics(w), before)
  validateUrbanFabric(w)
  const snapshot = JSON.stringify(w)
  ensureUrbanFabric(w)
  assert.equal(JSON.stringify(w), snapshot)
  const restored = JSON.parse(snapshot)
  validateUrbanFabric(restored)
  assert.deepEqual(restored, JSON.parse(JSON.stringify(w)))
})
test('coarse legacy records are identified without inventing footprints', () => {
  const { w, sites } = urbanFixture()
  delete sites[0].building
  ensureUrbanFabric(w)
  assert.equal(sites[0].fabric?.survey, 'aggregate')
  assert.equal(sites[0].building, undefined)
  assert.equal(sites[0].residents, 4)
})
test('fabric rejects corrupt areas, conditions and project sequences', () => {
  const { w, sites } = urbanFixture()
  ensureUrbanFabric(w)
  sites[0].fabric!.uses.housing++
  assert.throws(() => validateUrbanFabric(w), /building areas/)
  sites[0].fabric!.uses.housing--
  sites[0].fabric!.condition = NaN
  assert.throws(() => validateUrbanFabric(w), /building areas/)
  sites[0].fabric!.condition = 1
  w.adaptive!.urban!.nextProject = -1
  assert.throws(() => validateUrbanFabric(w), /version/)
})
test('view snapshots cannot migrate urban fabric', () => {
  const { w } = urbanFixture()
  w.viewOnly = true
  const before = JSON.stringify(w)
  ensureUrbanFabric(w)
  assert.equal(JSON.stringify(w), before)
})

test('replacement survives a mid-construction save and restores actual housed residents', () => {
  const { w, sites } = urbanFixture()
  ensureUrbanFabric(w)
  const before = urbanShape(sites[0]),
    after = structuredClone(before)
  after.capacity = 12
  after.fabric.floorArea = after.fabric.uses.housing = 336
  sites[1].residents! += sites[0].residents!
  sites[0].residents = sites[0].capacity = 0
  w.adaptive!.urban!.projects.push({
    id: w.adaptive!.urban!.nextProject++,
    kind: 'replace',
    status: 'funded',
    proposed: w.month,
    started: w.month,
    sponsor: 'producer:0',
    pool: 0,
    host: 0,
    sites: [sites[0].id],
    reason: 'Controlled paid replacement',
    benefit: 1,
    cost: 1,
    inputs: { timber: 1, stone: 1, labor: 1 },
    duration: 6,
    before: [before],
    after: [after],
    displaced: [{ from: sites[0].id, to: sites[1].id, people: 4 }],
  })
  w.month += 3
  advanceUrbanConstruction(w)
  assert.equal(w.adaptive!.urban!.projects[0].status, 'construction')
  const restored = JSON.parse(JSON.stringify(w)) as typeof w
  w.month += 3
  restored.month += 3
  advanceUrbanConstruction(w)
  advanceUrbanConstruction(restored)
  validateUrbanFabric(w)
  assert.equal(JSON.stringify(w), JSON.stringify(restored))
  assert.equal(urbanMetrics(w).residents, 96)
  assert.equal(sites[0].capacity, 12)
  assert.equal(sites[0].residents, 4)
  const completed = JSON.stringify(w)
  advanceUrbanConstruction(w)
  assert.equal(JSON.stringify(w), completed)
})
