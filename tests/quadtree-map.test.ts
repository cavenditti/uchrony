import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { adaptiveMesh, rebuildAdaptiveMesh, refreshAdaptiveTotals } from '../src/sim/adaptive-world'
import { prepareSpatialWorld } from '../src/sim/engine'
import { validateWorld } from '../src/sim/persistence'
import { viewSnapshot } from '../src/sim/view-snapshot'
import { mapHomesSnapshot, mapMeshSnapshot } from '../src/sim/map-snapshot'
import { mapLeafAt, visibleMapLeaves, visibleUrbanPlots, urbanPlotDensity } from '../src/map/quadtree'
import { cellPosition } from '../src/sim/physical-space'
import { CELL_METERS } from '../src/sim/grid'
import type { PhysicalSite } from '../src/sim/adaptive-types'

const fixture = () => {
  const world = generateWorld('Quadtree map fidelity', 3, 8, undefined, 'regional')
  prepareSpatialWorld(world)
  return world
}

test('compact map projection preserves every real leaf and total without changing the world', () => {
  const world = fixture(),
    before = JSON.stringify(world)
  assert.equal(world.month, 0)
  validateWorld(world)
  const mesh = adaptiveMesh(world),
    view = { ...viewSnapshot(world, null), cells: world.cells }
  const displayed = visibleMapLeaves(view, {
    x: 0,
    y: 0,
    width: world.width * CELL_METERS,
    height: world.height * CELL_METERS,
  })
  assert.deepEqual(
    displayed,
    mesh.leaves.map(({ id, bounds, population, jobs, landArea }) => ({
      id,
      bounds,
      population,
      jobs,
      landArea,
    })),
  )
  assert.deepEqual(view.viewMesh, structuredClone(mapMeshSnapshot(world)))
  assert.equal(view.viewMesh!.population.byteLength, mesh.leaves.length * 8)
  assert.deepEqual(view.adaptive!.sites, {})
  assert.deepEqual(view.adaptive!.tree.leaves, [])
  assert.equal(JSON.stringify(world), before)
})

test('viewport traversal and picking agree with exact physical leaf bounds, including water and domain edges', () => {
  const world = fixture(),
    mesh = adaptiveMesh(world)
  for (const window of [
    { x: 17000, y: 8000, width: 4000, height: 3000 },
    { x: -500, y: -500, width: 3000, height: 3000 },
    { x: world.width * CELL_METERS - 2000, y: 1000, width: 9000, height: 4000 },
  ]) {
    const expected = mesh.leaves.filter(
      ({ bounds: b }) =>
        b.x < window.x + window.width &&
        b.x + b.size > window.x &&
        b.y < window.y + window.height &&
        b.y + b.size > window.y,
    )
    assert.deepEqual(
      visibleMapLeaves(world, window).map((n) => n.id),
      expected.map((n) => n.id),
    )
  }
  for (const cell of world.cells.filter((_, i) => i % 41 === 0)) {
    const p = cellPosition(world, cell.id)
    const expected = mesh.leaves.find(
      ({ bounds: b }) => p.x >= b.x && p.x < b.x + b.size && p.y >= b.y && p.y < b.y + b.size,
    )
    assert.equal(mapLeafAt(world, p)?.id, expected!.id)
  }
  assert.equal(mapLeafAt(world, { x: -1, y: 0 }), undefined)
  assert.equal(mapLeafAt(world, { x: world.width * CELL_METERS, y: 0 }), undefined)
})

test('urban map shows unnamed development, vacancies and construction independently of city labels', () => {
  const world = fixture()
  const homes = Object.values(world.adaptive!.sites).filter((s) => s.kind === 'residential')
  const [occupied, vacant, construction, rural] = homes
  occupied.residents = 100
  occupied.openingBuilt = 0.1
  vacant.residents = 0
  vacant.openingBuilt = 0.1
  construction.openingBuilt = 0
  construction.investedValue = 0
  construction.residents = 0
  rural.openingBuilt = 0
  rural.investedValue = 0
  world.adaptive!.construction = [{ site: construction.id, capacity: 200, cost: 50, remaining: 2 }]
  world.localEconomy!.cities = []
  world.spatial!.settlements = []
  refreshAdaptiveTotals(world)
  const window = { x: 0, y: 0, width: world.width * CELL_METERS, height: world.height * CELL_METERS }
  const view = { ...viewSnapshot(world), cells: world.cells }
  const plots = visibleUrbanPlots(view, window)
  assert(plots.some((p) => p.id === occupied.id && p.residents === 100))
  assert(plots.some((p) => p.id === vacant.id && p.residents === 0))
  assert(plots.some((p) => p.id === construction.id && p.construction === 200 && !p.developed))
  assert(!plots.some((p) => p.id === rural.id))
  assert.equal(urbanPlotDensity(plots.find((p) => p.id === vacant.id)!), 0)
  assert(urbanPlotDensity(plots.find((p) => p.id === occupied.id)!) > 0)
  // A later occupancy snapshot must replace the visible state without moving the parcel.
  occupied.residents = 0
  refreshAdaptiveTotals(world)
  const next = visibleUrbanPlots({ ...viewSnapshot(world), cells: world.cells }, window).find(
    (p) => p.id === occupied.id,
  )!
  assert.equal(next.residents, 0)
  assert.deepEqual(next.parcel, occupied.parcel)
  assert.equal(plots.find((p) => p.id === occupied.id)!.residents, 100)
})

test('occupied urban plots and paid works refine to parcel scale, then coarsen after vacancy dwell', () => {
  const world = fixture(),
    a = world.adaptive!
  const source = Object.values(a.sites).find((s) => s.kind === 'residential')!
  const site: PhysicalSite = {
    ...source,
    id: 'residence:0',
    residents: 100,
    capacity: 200,
    openingCapacity: 0,
    openingBuilt: 0,
    investedValue: 20,
    parcel: { x: source.x - 64, y: source.y - 64, size: 128 },
  }
  a.sites = { [site.id]: site }
  world.economy!.firms = []
  const holdings = JSON.stringify({ sites: a.sites, economy: world.economy, regions: world.regions })
  rebuildAdaptiveMesh(world)
  assert.equal(mapLeafAt(world, site)!.bounds.size, 128)
  for (const dx of [-50, 50])
    for (const dy of [-50, 50])
      assert.equal(mapLeafAt(world, { x: site.x + dx, y: site.y + dy })!.bounds.size, 128)
  assert.equal(JSON.stringify({ sites: a.sites, economy: world.economy, regions: world.regions }), holdings)
  site.residents = 0
  world.month++
  rebuildAdaptiveMesh(world)
  assert.equal(mapLeafAt(world, site)!.bounds.size, 128)
  world.month += 24
  rebuildAdaptiveMesh(world)
  assert(mapLeafAt(world, site)!.bounds.size > 128)
  a.construction = [{ site: site.id, capacity: 100, cost: 30, remaining: 3 }]
  rebuildAdaptiveMesh(world)
  assert.equal(mapLeafAt(world, site)!.bounds.size, 128)
  assert.equal(site.capacity, 200)
  assert.equal(site.residents, 0)
})

test('refinement and coarsening cannot change any displayed urban footprint or occupancy', () => {
  const world = fixture(),
    homes = mapHomesSnapshot(world)
  for (const mode of ['coarse', 'fine', 'adaptive'] as const) {
    rebuildAdaptiveMesh(world, mode)
    assert.deepEqual(mapHomesSnapshot(world), homes)
  }
  // Snapshot geometry is detached from persistent physical land records.
  const view = mapHomesSnapshot(world),
    source = world.adaptive!.sites[view[0].id]
  view[0].parcel!.x++
  assert.notEqual(view[0].parcel!.x, source.parcel!.x)
})
