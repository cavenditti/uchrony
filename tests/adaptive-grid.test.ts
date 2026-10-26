import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import {
  ensureAdaptiveWorld,
  rebuildAdaptiveMesh,
  adaptiveMesh,
  refreshAdaptiveTotals,
} from '../src/sim/adaptive-world'
import {
  adaptiveGrid,
  queryAdaptiveSites,
  nearestAdaptiveSites,
  queryAdaptiveSitesInBounds,
  locateAdaptiveCell,
} from '../src/sim/adaptive-grid'
import { cellPosition, cellPolygon, polygonArea, meshInterfaces, rootBounds } from '../src/sim/physical-space'
import { packWorldSave } from '../src/sim/save-codec'
import { restoreWorld, validateWorld } from '../src/sim/persistence'
import type { AdaptiveNode, SpatialFragment } from '../src/sim/adaptive-types'

function fixture() {
  const w = generateWorld('Dynamic grid domain', 3, 8, undefined, 'regional')
  ensureAdaptiveWorld(w)
  return w
}
const ids = (sites: { id: string }[]) => sites.map((s) => s.id)
const rectangle = (x: number, y: number, width: number, height: number, water = false): SpatialFragment => ({
  cell: 0,
  water,
  area: width * height,
  polygon: [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ],
})
const node = (id: string, x: number, fragments: SpatialFragment[], size = 10): AdaptiveNode => ({
  id,
  bounds: { x, y: 0, size },
  fragments,
  sites: [],
  pools: [],
  population: 0,
  jobs: 0,
  landArea: fragments.reduce((n, f) => n + (f.water ? 0 : f.area), 0),
  indicator: 0,
})

test('dynamic cells partition the complete land and water domain conservatively across resolutions', () => {
  const w = fixture()
  const expected = { land: 0, water: 0 }
  for (const c of w.cells)
    expected[c.terrain === 'water' ? 'water' : 'land'] += polygonArea(cellPolygon(w, c.id))
  const sizes: number[] = []
  for (const mode of ['fine', 'coarse', 'adaptive'] as const) {
    const mesh = rebuildAdaptiveMesh(w, mode)
    sizes.push(mesh.leaves.length)
    const coverage = new Float64Array(w.cells.length)
    let land = 0,
      water = 0
    for (const n of mesh.leaves) {
      land += n.landArea
      water += n.waterArea ?? 0
      for (const f of n.fragments) coverage[f.cell] += f.area
    }
    assert(Math.abs(land - expected.land) < expected.land * 1e-10)
    assert(Math.abs(water - expected.water) < expected.water * 1e-10)
    for (const c of w.cells) assert(Math.abs(coverage[c.id] - polygonArea(cellPolygon(w, c.id))) < 1e-5)
    assert.equal(w.adaptive!.tree.domain, 'world')
    const grid = adaptiveGrid(w)
    for (const face of mesh.interfaces) {
      assert.equal(grid.adjacency.get(face.a)!.filter((e) => e.id === face.id).length, 1)
      assert.equal(grid.adjacency.get(face.b)!.filter((e) => e.id === face.id).length, 1)
      assert(Math.abs(face.length - (face.landLength! + face.waterLength! + face.coastLength!)) < 1e-8)
      const ratio = grid.byId.get(face.a)!.bounds.size / grid.byId.get(face.b)!.bounds.size
      assert(ratio >= 0.5 && ratio <= 2)
    }
    for (const c of w.cells.filter((_, i) => i % 29 === 0))
      assert.equal(locateAdaptiveCell(w, cellPosition(w, c.id))!.source.id, c.id)
  }
  assert(sizes[0] > sizes[1])
})

test('shared faces measure physical contact and do not connect land across gaps or water', () => {
  const left = node('r0', 0, [rectangle(0, 0, 10, 2), rectangle(0, 8, 10, 2)])
  const right = node('r1', 10, [rectangle(10, 3, 10, 4)])
  assert.equal(meshInterfaces([left, right]).length, 0)
  assert.equal(meshInterfaces([left, right], false)[0].length, 10)
  const sea = node('r1', 10, [rectangle(10, 0, 10, 10, true)])
  const shore = meshInterfaces([left, sea])[0]
  assert.equal(shore.landLength, 0)
  assert.equal(shore.waterLength, 0)
  assert.equal(shore.coastLength, 4)
  const mixedLeft = node('r0', 0, [rectangle(0, 0, 10, 4), rectangle(0, 4, 10, 6, true)])
  const mixedRight = node('r1', 10, [rectangle(10, 0, 10, 7), rectangle(10, 7, 10, 3, true)])
  assert.deepEqual(meshInterfaces([mixedLeft, mixedRight])[0], {
    id: 'r0|r1',
    a: 'r0',
    b: 'r1',
    length: 10,
    landLength: 4,
    waterLength: 3,
    coastLength: 3,
  })
})

test('recursive range and nearest search match exhaustive physical queries at every grid resolution', () => {
  const w = fixture()
  const all = Object.values(w.adaptive!.sites).filter((s) => s.retired === undefined)
  const center = cellPosition(w, w.regions[1].center),
    radius = 7000
  const predicate = (s: (typeof all)[number]) => s.kind === 'residential' && s.pool % 2 === 0
  const expected = all
    .filter((s) => predicate(s) && Math.hypot(s.x - center.x, s.y - center.y) <= radius)
    .sort((a, b) => a.id.localeCompare(b.id))
  const nearest = [...expected]
    .sort(
      (a, b) =>
        (a.x - center.x) ** 2 + (a.y - center.y) ** 2 - ((b.x - center.x) ** 2 + (b.y - center.y) ** 2) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 7)
  for (const mode of ['coarse', 'fine', 'adaptive'] as const) {
    rebuildAdaptiveMesh(w, mode)
    assert.deepEqual(ids(queryAdaptiveSites(w, center, radius, predicate)), ids(expected))
    assert.deepEqual(ids(nearestAdaptiveSites(w, center, 7, predicate, radius)), ids(nearest))
    const bounds = { x: center.x - 3000, y: center.y - 3000, size: 6000 }
    assert.deepEqual(
      ids(queryAdaptiveSitesInBounds(w, bounds)),
      ids(
        all
          .filter(
            (s) =>
              s.x >= bounds.x &&
              s.y >= bounds.y &&
              s.x <= bounds.x + bounds.size &&
              s.y <= bounds.y + bounds.size,
          )
          .sort((a, b) => a.id.localeCompare(b.id)),
      ),
    )
    assert.deepEqual(nearestAdaptiveSites(w, center, 0), [])
    assert.equal(new Set(ids(queryAdaptiveSites(w, center, 1e6))).size, all.length)
  }
  const before = JSON.stringify(w)
  const clone = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(w))))
  assert.deepEqual(ids(queryAdaptiveSites(clone, center, radius, predicate)), ids(expected))
  assert.equal(JSON.stringify(w), before)
  assert.throws(() => queryAdaptiveSites(w, center, NaN), /radius/)
  assert.throws(() => nearestAdaptiveSites(w, center, -1), /query/)
  assert.throws(() => locateAdaptiveCell(w, { x: NaN, y: 0 }), /point/)
  assert.equal(locateAdaptiveCell(w, { x: -1e8, y: 0 }), undefined)
})

test('legacy land-only saves retain their partition until an explicit full-domain remesh', () => {
  const w = fixture()
  rebuildAdaptiveMesh(w, 'fine')
  const clone = structuredClone(w)
  clone.adaptive!.tree.leaves = adaptiveMesh(w)
    .leaves.filter((n) => n.landArea > 1e-6)
    .map((n) => n.id)
  delete clone.adaptive!.tree.domain
  const before = JSON.stringify(clone.adaptive)
  const mesh = adaptiveMesh(clone)
  assert(mesh.leaves.every((n) => (n.waterArea ?? 0) === 0))
  assert.equal(JSON.stringify(clone.adaptive), before)
  const sea = w.cells.find((c) => c.terrain === 'water')!
  assert.equal(locateAdaptiveCell(clone, cellPosition(clone, sea.id)), undefined)
  rebuildAdaptiveMesh(clone)
  assert.equal(locateAdaptiveCell(clone, cellPosition(clone, sea.id))!.source.id, sea.id)
  const broken = structuredClone(clone)
  const ocean = adaptiveMesh(clone).leaves.find((n) => !n.landArea)!
  broken.adaptive!.tree.leaves = broken.adaptive!.tree.leaves.filter((id) => id !== ocean.id)
  assert.throws(() => validateWorld(broken), /uncovered|partition/)
})

test('membership refresh supports physical sites moving between subhex leaves without changing root geometry', () => {
  const w = fixture(),
    root = rootBounds(w)
  rebuildAdaptiveMesh(w, 'fine')
  const site = Object.values(w.adaptive!.sites).find((s) => s.kind === 'residential')!
  const original = { x: site.x, y: site.y }
  const topology = adaptiveGrid(w)
  site.x += 125
  refreshAdaptiveTotals(w)
  assert.equal(adaptiveGrid(w), topology, 'membership updates reuse the unchanged branch topology')
  assert(queryAdaptiveSites(w, site, 0).includes(site))
  assert(!queryAdaptiveSites(w, original, 0).includes(site))
  assert.deepEqual(rootBounds(w), root)
})

test('ocean cells refine around fleet activity and coarsen after the dwell period without moving sites', () => {
  const w = fixture()
  const before = rebuildAdaptiveMesh(w)
  const ocean = before.leaves.find((n) => n.landArea === 0 && n.bounds.size >= 4096)!
  assert(ocean, 'fixture needs open sea')
  const source = ocean.fragments.find((f) => {
    const p = cellPosition(w, f.cell)
    return (
      p.x >= ocean.bounds.x &&
      p.x < ocean.bounds.x + ocean.bounds.size &&
      p.y >= ocean.bounds.y &&
      p.y < ocean.bounds.y + ocean.bounds.size
    )
  })!.cell
  const sites = JSON.stringify(w.adaptive!.sites)
  w.warfare = {
    version: 1,
    revision: 0,
    deliveries: [],
    fleets: [
      {
        cell: source,
        hull: 1,
        soldiers: 4800,
        warships: 16,
        transports: 0,
      } as never,
    ],
  }
  const refined = rebuildAdaptiveMesh(w)
  assert(refined.leaves.some((n) => n.id.startsWith(ocean.id) && n.id.length > ocean.id.length))
  assert(locateAdaptiveCell(w, cellPosition(w, source))!.node.bounds.size <= 512)
  w.warfare.fleets = []
  w.month++
  const held = rebuildAdaptiveMesh(w)
  assert(held.leaves.some((n) => n.id.startsWith(ocean.id) && n.id.length > ocean.id.length))
  w.month += 24
  const calm = rebuildAdaptiveMesh(w)
  assert(calm.leaves.length < refined.leaves.length)
  assert.equal(JSON.stringify(w.adaptive!.sites), sites)
})

test('subhex door-to-door travel uses actual meter positions and is independent of numerical cell size', async () => {
  const { commuteSiteRoute } = await import('../src/sim/commuting')
  const w = fixture(),
    cell = w.regions[0].center,
    p = cellPosition(w, cell)
  const from = { ...p, cell },
    to = { x: p.x + 400, y: p.y, cell }
  assert.equal(commuteSiteRoute(w, from, to)!.minutes, 6)
  assert.equal(commuteSiteRoute(w, from, to, 5), null)
  const results = []
  for (const mode of ['coarse', 'fine', 'adaptive'] as const) {
    rebuildAdaptiveMesh(w, mode)
    results.push(commuteSiteRoute(w, from, to))
  }
  assert.deepEqual(results[0], results[1])
  assert.deepEqual(results[0], results[2])
})
