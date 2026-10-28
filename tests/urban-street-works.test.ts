import test from 'node:test'
import assert from 'node:assert/strict'
import { urbanFixture } from './fixtures/urban-evolution'
import { ensureUrbanFabric } from '../src/sim/urban-fabric'
import { planUrbanStreetWork, updateUrbanStreetLoads, urbanStreetClear } from '../src/sim/urban-street-works'
import { advanceUrbanConstruction } from '../src/sim/urban-construction'
import { urbanStreetRoute } from '../src/sim/urban-streets'

test('street loads derive from recorded residents and preserve their census', () => {
  const { w, sites } = urbanFixture()
  ensureUrbanFabric(w)
  const population = sites.reduce((n, s) => n + s.residents!, 0)
  updateUrbanStreetLoads(w)
  assert.ok(w.adaptive!.lanes![0].load! > 0)
  assert.ok(w.adaptive!.lanes![0].load! <= population)
  assert.equal(
    sites.reduce((n, s) => n + s.residents!, 0),
    population,
  )
})

test('widening rejects buildings in its required clearance and accepts clear land', () => {
  const { w } = urbanFixture()
  ensureUrbanFabric(w)
  const lane = w.adaptive!.lanes![0]
  assert.ok(planUrbanStreetWork(w, lane, 'widen'))
  const blocked = [
    { x: 780, y: 400 },
    { x: 1200, y: 400 },
  ]
  assert.equal(urbanStreetClear(w, blocked, 6, 0), false)
  assert.equal(planUrbanStreetWork(w, lane, 'realign', blocked), undefined)
})

test('funded straightening keeps its old route during works, then shortens travel', () => {
  const { w } = urbanFixture('bridge')
  ensureUrbanFabric(w)
  const lane = w.adaptive!.lanes![0],
    [a, b] = [lane.points[0], lane.points.at(-1)!]
  const before = urbanStreetRoute(w, a, b)!.minutes
  const project = planUrbanStreetWork(w, lane, 'realign', [a, b])!
  assert.ok(project)
  // Lifecycle-only fixture: economic funding is checked in urban-renewal.test.
  project.status = 'funded'
  project.started = w.month
  w.adaptive!.urban!.projects.push(project)
  w.adaptive!.urban!.nextProject++
  assert.equal(urbanStreetRoute(w, a, b)!.minutes, before)
  w.month += project.duration
  advanceUrbanConstruction(w)
  assert.ok(urbanStreetRoute(w, a, b)!.minutes < before * 0.6)
  assert.equal(lane.upgraded, w.month)
})

test('straightening preserves a junction connected at an interior bend', () => {
  const { w } = urbanFixture('bridge')
  ensureUrbanFabric(w)
  const lane = w.adaptive!.lanes![0]
  w.adaptive!.lanes!.push({
    id: 'branch',
    pool: 0,
    width: 4,
    founded: 0,
    points: [
      { x: 760, y: 750 },
      { x: 600, y: 750 },
    ],
  })
  assert.equal(planUrbanStreetWork(w, lane, 'realign', [lane.points[0], lane.points.at(-1)!]), undefined)
})

test('new connections carry a sponsor and cannot cross foreign land', () => {
  const { w } = urbanFixture('boundary')
  ensureUrbanFabric(w)
  const lane = w.adaptive!.lanes![0]
  const points = [
    { x: 900, y: 600 },
    { x: 1100, y: 600 },
  ]
  const p = planUrbanStreetWork(w, lane, 'connect', points)!
  assert.ok(p)
  assert.equal(p.pool, 0)
  assert.equal(p.sponsor, 'producer:0')
  w.regions[1].nation = 1
  assert.equal(planUrbanStreetWork(w, lane, 'connect', points), undefined)
})
