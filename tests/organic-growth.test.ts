import { movementNeighbors } from '../src/sim/grid'
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { ensureAdaptiveWorld } from '../src/sim/adaptive-world'
import { ensureResidentialSites } from '../src/sim/residential-sites'
import { surveyBuildingPlots, settlementElevation } from '../src/sim/urban-growth'
import { footprintConnection } from '../src/sim/residential-geometry'
import { cellPosition, pointInPolygon, cellPolygon } from '../src/sim/physical-space'
import { groundRoads } from '../src/map/ground-roads'

function fixture() {
  const w = generateWorld('Organic frontage', 3, 8, undefined, 'regional', 'frontier')
  ensureAdaptiveWorld(w)
  ensureResidentialSites(w)
  const pool = w.localEconomy!.units[w.nations[0].capital]
  const source = w.adaptive!.sites[`home:${pool.center}`]
  return { w, pool, source }
}

test('frontages follow recorded roads with varied buildings, no overlaps and no grid snapping', () => {
  const { w, pool, source } = fixture()
  const target = pool.cells.find((id) => id === source.cell + 1 && w.cells[id].terrain !== 'water')!
  assert(target !== undefined)
  w.corridors = [
    { a: Math.min(source.cell, target), b: Math.max(source.cell, target), familiarity: 0.7, traffic: 10 },
  ]
  // Flat ground isolates the road's directional effect.
  w.cells.forEach((c) => {
    c.elevation = 0.3
  })
  const before = JSON.stringify(w)
  const result = surveyBuildingPlots(w, source, 45, true, [])
  assert.deepEqual(surveyBuildingPlots(w, source, 45, true, []), result)
  assert.equal(JSON.stringify(w), before, 'survey is read-only and deterministic')
  const first = result.lanes[0].points
  assert(
    Math.abs(first[1].y - first[0].y) / Math.hypot(first[1].x - first[0].x, first[1].y - first[0].y) < 0.25,
  )
  assert(new Set(result.plots.map((p) => Math.round(p.parcel.size))).size > 10)
  assert(result.plots.some((p) => Math.abs((p.point.x % 16) - 8) > 3))
  const weights = result.plots.map((p) => p.weight)
  assert(Math.max(...weights) > Math.min(...weights) * 5)
  for (const [i, plot] of result.plots.entries()) {
    assert(plot.building.every((p) => pointInPolygon(p, cellPolygon(w, plot.cell))))
    for (const other of result.plots.slice(i + 1))
      assert(footprintConnection(plot.building, other.building).distance >= 2.49)
    const gaps = result.lanes.flatMap((l) =>
      l.points
        .slice(1)
        .map((p, i) => footprintConnection(plot.building, [l.points[i], p]).distance - l.width / 2),
    )
    assert(Math.min(...gaps) >= 0.99, 'no building occupies a street')
    assert(Math.min(...gaps) < 16, 'each building has nearby frontage')
  }
})

test('terrain changes street direction and surveys never allocate buildings over water', () => {
  const { w, source } = fixture()
  w.corridors = []
  w.cells.forEach((c) => {
    c.elevation = Math.max(0, Math.min(1, 0.4 + (c.q - w.cells[source.cell].q) * 0.08))
  })
  const eastSlope = surveyBuildingPlots(w, source, 12, true, [])
  w.cells.forEach((c) => {
    c.elevation = Math.max(0, Math.min(1, 0.4 + (c.r - w.cells[source.cell].r) * 0.08))
  })
  const northSlope = surveyBuildingPlots(w, source, 12, true, [])
  assert.notDeepEqual(
    eastSlope.plots.map((p) => p.point),
    northSlope.plots.map((p) => p.point),
  )
  const rise = (lane: (typeof eastSlope.lanes)[number]) =>
    Math.abs(settlementElevation(w, lane.points[1]) - settlementElevation(w, lane.points[0]))
  assert(
    northSlope.lanes.slice(0, 2).every((l) => rise(l) < 0.0008),
    'new streets follow the contour',
  )
  const water = source.cell + 1
  w.cells[water].terrain = 'water'
  const edgeSource = { ...source, ...cellPosition(w, source.cell) }
  edgeSource.x = ((source.cell % w.width) + 1) * 1024 - 35
  const shoreline = surveyBuildingPlots(w, edgeSource, 16, true, [])
  assert(shoreline.plots.every((p) => p.cell !== water && w.cells[p.cell].terrain !== 'water'))
})

test('land trade and local lanes share flat road textures; sea routes and duplicate edges do not', () => {
  const { w, source, pool } = fixture()
  const other = movementNeighbors(w.cells, source.cell, w.width, w.height).find(
    (id) => w.cells[id].terrain !== 'water',
  )!
  const sea = w.cells.find((c) => c.terrain === 'water')!.id
  w.corridors = [
    { a: source.cell, b: other, familiarity: 0.7, traffic: 10 },
    { a: other, b: source.cell, familiarity: 0.7, traffic: 10 },
    { a: source.cell, b: sea, familiarity: 0.8, traffic: 10 },
  ]
  w.adaptive!.lanes = [
    { pool: pool.id, founded: 0, width: 4, points: [source, { x: source.x + 24, y: source.y + 4 }] },
  ]
  const before = JSON.stringify(w)
  const roads = groundRoads(w)
  assert.equal(roads.filter((r) => r.kind === 'trade').length, 1)
  assert.equal(roads.filter((r) => r.kind === 'lane').length, 1)
  assert.equal(roads[0].width * w.adaptive!.metersPerMapUnit, 4)
  assert.equal(JSON.stringify(w), before)
})
