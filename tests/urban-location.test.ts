import test from 'node:test'
import assert from 'node:assert/strict'
import { urbanFixture } from './fixtures/urban-evolution'
import { ensureUrbanFabric } from '../src/sim/urban-fabric'
import {
  urbanEmploymentLocations,
  urbanLocationSnapshot,
  recordUrbanPressure,
} from '../src/sim/urban-location'
import type { CompetitiveFirm } from '../src/sim/economic-types'

test('preferences respond to real residents and saturate without changing the census', () => {
  const { w, sites } = urbanFixture()
  ensureUrbanFabric(w)
  const before = JSON.stringify(w)
  const local = urbanLocationSnapshot(w)(sites[3])
  assert.ok(local.residents > 0)
  assert.equal(JSON.stringify(w), before)
  for (const s of sites) s.residents = 1_000_000
  const dense = urbanLocationSnapshot(w)(sites[3])
  assert.ok(dense.scores.market > local.scores.market)
  assert.ok(dense.congestion < 1)
  assert.ok(Object.values(dense.scores).every((v) => v < 1.2))
})

test('freight favours logistics; administrative names and labels do not affect choices', () => {
  const { w, sites } = urbanFixture()
  ensureUrbanFabric(w)
  const before = urbanLocationSnapshot(w)(sites[4])
  w.corridors = [{ a: 0, b: 1, traffic: 500 }] as typeof w.corridors
  const after = urbanLocationSnapshot(w)(sites[4])
  assert.ok(after.scores.logistics > before.scores.logistics)
  w.regions[0].name = 'A different label'
  assert.deepEqual(urbanLocationSnapshot(w)(sites[4]), after)
})

test('real premises relocate existing jobs without creating additional employment', () => {
  const { w, sites } = urbanFixture()
  ensureUrbanFabric(w)
  const firm = { id: 0, active: true, employment: 30 } as CompetitiveFirm
  w.adaptive!.sites['firm:0'] = { ...sites[0], id: 'firm:0', kind: 'establishment' }
  sites[1].fabric!.occupants = ['firm:0']
  sites[1].fabric!.uses = { housing: 0, production: 180, market: 0, civic: 0, logistics: 0 }
  sites[1].fabric!.floorArea = 180
  const placed = urbanEmploymentLocations(w, firm)
  assert.equal(
    placed.reduce((n, p) => n + p.workers, 0),
    30,
  )
  assert.equal(placed.find((p) => p.site.id === sites[1].id)!.workers, 10)
  assert.equal(placed.find((p) => p.site.id === 'firm:0')!.workers, 20)
})

test('pressure requires persistent preferences and survives serialization', () => {
  const { w, sites } = urbanFixture()
  ensureUrbanFabric(w)
  recordUrbanPressure(w, sites[0], 'market', 0.5)
  w.month += 6
  recordUrbanPressure(w, sites[0], 'market', 0.6)
  assert.equal(w.adaptive!.urban!.pressure[sites[0].id].since, 240)
  w.month += 6
  recordUrbanPressure(w, sites[0], 'housing', 0.7)
  assert.equal(w.adaptive!.urban!.pressure[sites[0].id].since, 252)
  assert.deepEqual(JSON.parse(JSON.stringify(w.adaptive!.urban)).pressure, w.adaptive!.urban!.pressure)
})
