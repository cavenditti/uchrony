import { configurationDraft } from '../src/sim/configuration'
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import type { World, Cell } from '../src/sim/types'
import { CELL_SIZE } from '../src/sim/grid'
import { TILE_ACTIVITIES, type EconomicLandscape } from '../src/sim/economic-landscape'
import { ActivityScenery, ACTIVITY_CACHE_LIMIT } from '../src/map/activity-scenery'
import { CityScenery } from '../src/map/city-scenery'
import { TerrainPicker } from '../src/map/relief-picking'
import { sceneryBucket, sceneryDensity } from '../src/map/scenery-lod'

function fixture() {
  const width = 48,
    height = 40
  const cells = Array.from({ length: width * height }, (_, id): Cell => ({
    id,
    q: id % width,
    r: Math.floor(id / width),
    x: ((id % width) + 0.5) * CELL_SIZE,
    y: (Math.floor(id / width) + 0.5) * CELL_SIZE,
    region: 0,
    terrain: 'plains',
    elevation: 0.2,
    moisture: 0.5,
    river: false,
  }))
  const land: EconomicLandscape = {
    month: 7,
    activity: new Uint8Array(cells.length).fill(TILE_ACTIVITIES.indexOf('workshops')),
    intensity: new Float32Array(cells.length),
    workers: new Float64Array(cells.length).fill(20),
    residents: new Float64Array(cells.length).fill(300),
    harbors: [],
  }
  const world = {
    seed: 'LoD continuity',
    configuration: { version: 1, revision: 0, values: configurationDraft() },
    month: 7,
    width,
    height,
    cells,
    routes: [],
    corridors: [],
    regions: [{ id: 0, culture: 0, center: 0 }],
    viewLandscape: land,
    spatial: { version: 1, month: 7, districts: [], splits: [], settlements: [] },
  } as unknown as World
  const plane = new THREE.PlaneGeometry(width * CELL_SIZE, height * CELL_SIZE)
    .rotateX(-Math.PI / 2)
    .translate((width * CELL_SIZE) / 2, 0, (height * CELL_SIZE) / 2)
  return { world, land, plane, picker: new TerrainPicker(plane) }
}
function cameraAt(x: number, z: number, scale: number) {
  const camera = new THREE.OrthographicCamera(-480 / scale, 480 / scale, 400 / scale, -400 / scale, 1, 4000)
  camera.position.set(x, 2000, z)
  camera.up.set(0, 0, -1)
  camera.lookAt(x, 0, z)
  camera.updateMatrixWorld()
  return camera
}
function instances(root: THREE.Object3D) {
  const entries = new Map<string, { x: number; z: number }>()
  root.traverseVisible((object) => {
    if (!(object instanceof THREE.InstancedMesh)) return
    for (let i = 0; i < object.count; i++) {
      const matrix = new THREE.Matrix4()
      object.getMatrixAt(i, matrix)
      if (!matrix.elements[15]) continue
      entries.set(`${object.geometry.type}:${matrix.elements.map((n) => n.toFixed(4)).join(':')}`, {
        x: matrix.elements[12],
        z: matrix.elements[14],
      })
    }
  })
  return entries
}

test('panning across the former 64-cell cutoff preserves every overlapping facility and actor', () => {
  const { world, plane, picker } = fixture()
  const scenery = new ActivityScenery(world, picker)
  const x = 288,
    z = 240,
    scale = 4
  scenery.view(cameraAt(x, z, scale), 960, 800, scale)
  scenery.animate(13.7)
  assert(scenery.stats.visible > 64, 'viewport structure must not be truncated to nearest cells')
  const before = instances(scenery.group)
  const start = performance.now()
  for (const pan of [6, 12, 24, -12, 0]) {
    scenery.view(cameraAt(x + pan, z, scale), 960, 800, scale)
    const after = instances(scenery.group)
    let checked = 0
    for (const [key, point] of before) {
      if (Math.abs(point.x - x) > 65 || Math.abs(point.z - z) > 65) continue
      assert(after.has(key), `on-screen object vanished during pan ${pan} at ${point.x},${point.z}`)
      checked++
    }
    assert(checked > 100)
    assert(scenery.stats.cached <= ACTIVITY_CACHE_LIMIT)
    assert(scenery.group.children.length <= 10)
  }
  console.log(JSON.stringify({ lodPan5Ms: performance.now() - start, ...scenery.stats }))
  scenery.dispose()
  plane.dispose()
})

test('complete town silhouettes, landmarks, trees and streets survive detail-budget changes', () => {
  const { world, plane, picker } = fixture()
  world.spatial!.settlements = Array.from({ length: 12 }, (_, i) => ({
    id: `town:${i}`,
    cell: (10 + Math.floor(i / 4) * 6) * world.width + 12 + (i % 4) * 6,
    region: 0,
    name: `Town ${i}`,
    kind: 'city',
    capital: i === 0,
    population: 50000,
  }))
  const scenery = new CityScenery(world, picker),
    overview = scenery.group.children[0]
  const before = instances(overview)
  const shells = overview.children[0] as THREE.InstancedMesh
  assert(shells.count > 32 * 12, 'overview retains every house, not 32 samples per town')
  const ground = overview.children.find((c) => c instanceof THREE.Mesh && !(c instanceof THREE.InstancedMesh))
  assert(ground, 'town streets and squares are retained independently of facade detail')
  assert(overview.children.length > 5, 'civic landmarks and planted scenery have retained batches')
  for (const [pan, scale] of [
    [0, 2],
    [0, 3.1],
    [20, 3.1],
    [-20, 3.1],
    [40, 6],
    [0, 2.5],
    [0, 3.1],
  ]) {
    scenery.view(cameraAt(280 + pan, 200, scale), 960, 800, scale)
    const after = instances(scenery.group)
    for (const key of before.keys())
      assert(after.has(key), 'a structural town instance disappeared at a detail transition')
    assert(overview.children.includes(ground))
    assert(scenery.group.children.slice(1).filter((g) => g.visible).length <= 6)
  }
  scenery.dispose()
  plane.dispose()
})

test('fine-detail bucket changes discard only fully faded models', () => {
  for (let scale = 1.5; scale <= 24; scale += 0.01) {
    const density = sceneryDensity(scale),
      bucket = sceneryBucket(density)
    for (let threshold = 0; threshold < 1; threshold += 0.01)
      if (threshold >= bucket) assert(density <= threshold, 'removed detail must already have zero coverage')
  }
  assert.equal(sceneryDensity(24), 1.08, 'all detail is fully opaque at close zoom')
})
