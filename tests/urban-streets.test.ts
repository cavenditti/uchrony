import test from 'node:test'
import assert from 'node:assert/strict'
import { urbanFixture } from './fixtures/urban-evolution'
import { ensureUrbanFabric } from '../src/sim/urban-fabric'
import { urbanStreetGraph, urbanStreetRoute } from '../src/sim/urban-streets'
import { createResidentialParcel } from '../src/sim/residential-sites'
import { surveyBuildingPlots } from '../src/sim/urban-growth'
import { urbanHost } from '../src/sim/urban-land'

test('local streets connect at geometric T-junctions across economic boundaries', () => {
  const { w } = urbanFixture('boundary')
  w.adaptive!.lanes!.push({
    pool: 1,
    founded: 0,
    width: 4,
    points: [
      { x: 1100, y: 430 },
      { x: 1100, y: 650 },
    ],
  })
  ensureUrbanFabric(w)
  const g = urbanStreetGraph(w)
  const junction = g.nodes.findIndex((p) => p.x === 1100 && p.y === 430)
  assert.equal(g.edges[junction].length, 3)
  const route = urbanStreetRoute(w, { x: 780, y: 430 }, { x: 1100, y: 630 })
  assert(route && route.minutes > 0)
  assert.equal(route.lanes.length >= 1, true)
})
test('a new connection reduces journey time and invalidates cached topology', () => {
  const { w } = urbanFixture('bridge')
  ensureUrbanFabric(w)
  const a = { x: 760, y: 430 },
    b = { x: 1240, y: 430 }
  const before = urbanStreetRoute(w, a, b)!
  w.adaptive!.lanes!.push({ pool: 0, founded: w.month, width: 5, points: [a, b] })
  const after = urbanStreetRoute(w, a, b)!
  assert(before && after)
  assert(after.minutes < before.minutes * 0.6)
  const raw = JSON.stringify(w)
  urbanStreetRoute(w, a, b)
  assert.equal(JSON.stringify(w), raw)
})
test('accounting boundaries do not constrain a surveyed plot or frontage search', () => {
  const { w, sites } = urbanFixture('boundary')
  ensureUrbanFabric(w)
  const s = createResidentialParcel(w, 1, 1, { x: 1026, y: 800 }, { x: 1016, y: 790, size: 20 })
  assert.equal(s.pool, 1)
  const surveyed = surveyBuildingPlots(w, sites[3], 24, true, sites, false)
  assert(surveyed.plots.some((p) => p.cell === 1 && p.pool === urbanHost(w, 1)))
  for (const p of surveyed.plots) assert(p.building.every((q) => Number.isFinite(q.x + q.y)))
})
test('foreign or flooded land cannot host a cross-boundary plot', () => {
  const { w } = urbanFixture('boundary')
  ensureUrbanFabric(w)
  w.regions[0].nation = 1
  assert.throws(
    () => createResidentialParcel(w, 1, 1, { x: 1026, y: 800 }, { x: 1016, y: 790, size: 20 }),
    /crosses/,
  )
})

test('route geometry follows access projections and reuses source trees without changing results', () => {
  const { w } = urbanFixture()
  ensureUrbanFabric(w)
  const from = { x: 790, y: 420 },
    to = { x: 1000, y: 445 }
  const route = urbanStreetRoute(w, from, to)!
  assert.ok(route)
  assert.ok(route.points.some((p) => p.x === 790 && p.y === 430))
  assert.ok(route.points.some((p) => p.x === 1000 && p.y === 430))
  urbanStreetRoute(w, from, { x: 1100, y: 430 })
  assert.deepEqual(urbanStreetRoute(w, from, to), urbanStreetRoute(structuredClone(w), from, to))
})
