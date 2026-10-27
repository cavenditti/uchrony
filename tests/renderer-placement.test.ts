import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { CELL_SIZE } from '../src/sim/grid'
import type { World, Cell } from '../src/sim/types'
import { TILE_ACTIVITIES, type EconomicLandscape } from '../src/sim/economic-landscape'
import { landSurface, renderedLand, footprint, LandSurface } from '../src/map/land-surface'
import { activityLayout, detailRoads, distanceTo } from '../src/map/activity-layout'
import { activityPose } from '../src/map/activity-motion'
import { tradeRoadEdges } from '../src/map/road-curves'
import { groundRoads } from '../src/map/ground-roads'
import { TerrainPicker } from '../src/map/relief-picking'
import { ActivityScenery } from '../src/map/activity-scenery'
import { CityScenery } from '../src/map/city-scenery'

function fixture(water: (q: number, r: number) => boolean = (q) => q >= 10) {
  const width = 16,
    height = 12
  const cells = Array.from({ length: width * height }, (_, id): Cell => {
    const q = id % width,
      r = Math.floor(id / width),
      sea = water(q, r)
    return {
      id,
      q,
      r,
      x: (q + 0.5) * CELL_SIZE,
      y: (r + 0.5) * CELL_SIZE,
      region: sea ? -1 : 0,
      terrain: sea ? 'water' : 'plains',
      elevation: sea ? 0 : 0.2,
      moisture: 0.5,
      river: false,
    }
  })
  const land: EconomicLandscape = {
    month: 7,
    activity: new Uint8Array(cells.length).fill(TILE_ACTIVITIES.indexOf('fields')),
    intensity: new Float32Array(cells.length),
    workers: new Float64Array(cells.length).fill(30),
    residents: new Float64Array(cells.length).fill(300),
    harbors: [],
  }
  const world = {
    seed: 'Renderer regression',
    month: 7,
    width,
    height,
    cells,
    regions: [{ id: 0, culture: 0, center: 0 }],
    routes: [],
    corridors: [],
    spatial: { version: 1, month: 7, settlements: [], districts: [], splits: [] },
    viewLandscape: land,
  } as unknown as World
  return { world, land }
}
function terrain(w: World, elevation: (x: number, z: number) => number = () => 0) {
  const mesh = new THREE.PlaneGeometry(w.width * CELL_SIZE, w.height * CELL_SIZE, w.width * 2, w.height * 2)
    .rotateX(-Math.PI / 2)
    .translate((w.width * CELL_SIZE) / 2, 0, (w.height * CELL_SIZE) / 2)
  const p = mesh.attributes.position
  for (let i = 0; i < p.count; i++) p.setY(i, elevation(p.getX(i), p.getZ(i)))
  return { mesh, picker: new TerrainPicker(mesh) }
}
function cameraAt(x: number, z: number, span = 40) {
  const camera = new THREE.OrthographicCamera(-span, span, span, -span, 1, 4000)
  camera.position.set(x, 2000, z)
  camera.up.set(0, 0, -1)
  camera.lookAt(x, 0, z)
  camera.updateMatrixWorld()
  return camera
}

test('land mask follows the visible quadratic coast, including corners and inland water', () => {
  const surface = new LandSurface([
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
  ])
  assert(surface.contains(5, 5))
  assert(!surface.contains(0.2, 0.2), 'rounded corner is sea despite its square source cell')
  // Top-left curve is (0,5) -> (0,0) -> (5,0); at t=.5 it crosses (1.25,1.25).
  assert(surface.contains(1.26, 1.25))
  assert(!surface.contains(1.24, 1.25))
  const { world } = fixture((q, r) => q === 7 && r === 5)
  assert(!landSurface(world).contains(world.cells[87].x, world.cells[87].y))
  assert(renderedLand(world, world.cells[86].x, world.cells[86].y))
})

test('every pier crosses the visible shore in all four directions, independent of terrain height', () => {
  const cases = [
    { water: (q: number, _r: number) => q >= 10, land: 5 * 16 + 9, sea: 5 * 16 + 10 },
    { water: (q: number, _r: number) => q <= 5, land: 5 * 16 + 6, sea: 5 * 16 + 5 },
    { water: (_q: number, r: number) => r >= 7, land: 6 * 16 + 8, sea: 7 * 16 + 8 },
    { water: (_q: number, r: number) => r <= 3, land: 4 * 16 + 8, sea: 3 * 16 + 8 },
  ]
  for (const c of cases)
    for (const level of [0, 1, 3, 8]) {
      const { world, land } = fixture(c.water)
      land.harbors = [{ cell: c.land, water: c.sea, region: 0, level }]
      // Elevation never reaches sea level: the former height threshold selected a bogus coast.
      const plan = activityLayout(world, land, c.land, [], () => 7)
      const piers = plan.pieces.filter((p) => p.role === 'pier')
      assert.equal(piers.length, Math.min(4, level + 1))
      for (const p of piers) {
        const ux = Math.sin(p.angle),
          uz = Math.cos(p.angle)
        assert(
          landSurface(world).contains(p.x - (ux * p.d) / 2, p.z - (uz * p.d) / 2),
          'pier root touches land',
        )
        assert(!landSurface(world).contains(p.x + (ux * p.d) / 2, p.z + (uz * p.d) / 2), 'pier reaches water')
        assert(p.y - p.h / 2 >= 7, 'deck connects above the actual shore elevation')
      }
      for (const p of plan.pieces.filter((p) => p.role === 'piling')) assert(p.y - p.h / 2 <= -0.1)
      for (const m of plan.motions.filter((m) => m.kind === 'boat'))
        assert(!landSurface(world).contains(m.x, m.z))
      for (const p of plan.pieces.filter((p) => !p.water))
        assert(footprint(p.x, p.z, p.w, p.d, p.angle).every((p) => renderedLand(world, p.x, p.z)))
    }
})

test('carts follow the painted bend and face travel, without creating traffic on unpainted plans', () => {
  const { world, land } = fixture()
  const path = [66, 67, 68, 84, 100, 101]
  world.corridors = path.slice(1).map((b, i) => ({ a: path[i], b, familiarity: 1, traffic: 10 }))
  const roads = detailRoads(world),
    painted = groundRoads(world)
  assert.equal(roads.length, painted.length)
  let bends = 0
  for (const road of roads) {
    assert.equal(road.points, tradeRoadEdges(world).get(`${road.a}:${road.b}`)!.points)
    assert(painted.some((p) => p.points === road.points))
    const motion = activityLayout(world, land, road.a, [road]).motions.find((m) => m.kind === 'cart')!
    assert(motion)
    for (let t = 0; t < 50; t += 0.13) {
      const p = activityPose(motion, t, world)
      const distances = road.points
        .slice(1)
        .map((b, i) => distanceTo(p.x, p.z, road.points[i].x, road.points[i].y, b.x, b.y))
      assert(Math.min(...distances) < 1e-9)
      const next = activityPose(motion, t + 1e-4, world)
      assert((next.x - p.x) * Math.sin(p.angle) + (next.z - p.z) * Math.cos(p.angle) >= -1e-8)
      if (
        distanceTo(
          p.x,
          p.z,
          world.cells[road.a].x,
          world.cells[road.a].y,
          world.cells[road.b].x,
          world.cells[road.b].y,
        ) > 0.1
      )
        bends++
    }
  }
  assert(bends > 0, 'the regression actually exercises curved segments')
  world.corridors = []
  world.corridorPlan = { links: [{ legs: [{ mode: 'land', cells: path }] }] } as World['corridorPlan']
  assert.equal(detailRoads(world).length, 0)
})

test('compound facility pieces use one foundation on slopes, and paused motion survives rebuilding', () => {
  const { world, land } = fixture()
  const { mesh, picker } = terrain(world, (x, z) => x * 0.025 + z * 0.01)
  const id = 5 * world.width + 5
  land.activity[id] = TILE_ACTIVITIES.indexOf('workshops')
  const plan = activityLayout(world, land, id, [], (x, z) => picker.heightAt(x, z))
  const buildings = plan.pieces.filter((p) => p.role === 'workshop')
  assert(buildings.length > 0)
  assert(buildings.every((p) => p.baseY !== undefined))
  for (const p of buildings.filter((p) => p.shape === 'roof')) {
    const wall = buildings.find((w) => w.shape === 'box' && w.x === p.x && w.z === p.z)!
    assert.equal(wall.baseY, p.baseY)
  }
  const scenery = new ActivityScenery(world, picker)
  const cell = world.cells[id],
    camera = cameraAt(cell.x, cell.y, 20)
  scenery.view(camera, 800, 800, 20)
  scenery.animate(13.7)
  const matrices = () =>
    scenery.group.children
      .filter((m) => !m.frustumCulled)
      .map((m) => Array.from((m as THREE.InstancedMesh).instanceMatrix.array))
  const before = matrices()
  assert(before.length)
  scenery.update({ ...world })
  scenery.view(camera, 800, 800, 20)
  assert.deepEqual(matrices(), before, 'rebuild at paused time must not reset every actor to time zero')
  scenery.view(camera, 800, 800, 2.9)
  assert(scenery.group.visible)
  scenery.view(camera, 800, 800, 1.5)
  assert(!scenery.group.visible)
  scenery.view(camera, 800, 800, 1.4)
  assert(!scenery.group.visible)
  scenery.dispose()
  mesh.dispose()
})

test('overview and detail preserve building and roof transforms on slopes and across LoD thresholds', () => {
  const { world } = fixture(() => false)
  world.spatial!.settlements = [
    {
      id: 'test-town',
      cell: 5 * 16 + 7,
      region: 0,
      kind: 'town',
      name: 'Test',
      population: 9000,
      capital: false,
    },
  ]
  const { mesh, picker } = terrain(world, (x, z) => x * 0.025 + z * 0.01)
  const scenery = new CityScenery(world, picker),
    overview = scenery.group.children[0]
  const samples: { geometry: THREE.BufferGeometry; matrix: number[] }[] = []
  for (const object of overview.children.slice(0, 5)) {
    const instanced = object as THREE.InstancedMesh
    for (let i = 0; i < instanced.count; i++) {
      const m = new THREE.Matrix4()
      instanced.getMatrixAt(i, m)
      samples.push({ geometry: instanced.geometry, matrix: m.elements })
    }
  }
  assert(samples.length > 10)
  const cell = world.cells[world.spatial!.settlements[0].cell],
    camera = cameraAt(cell.x, cell.y)
  scenery.view(camera, 800, 800, 3.1)
  const detail = scenery.group.children.find((c) => c !== overview && c.visible)!
  assert(detail)
  for (const sample of samples) {
    let found = false
    detail.traverse((m) => {
      if (!(m instanceof THREE.InstancedMesh) || m.geometry !== sample.geometry) return
      for (let i = 0; i < m.count; i++) {
        const actual = new THREE.Matrix4()
        m.getMatrixAt(i, actual)
        if (actual.elements.every((n, j) => Math.abs(n - sample.matrix[j]) < 1e-5)) found = true
      }
    })
    assert(found, 'overview must use an actual detailed building transform, including its foundation/roof')
  }
  scenery.view(camera, 800, 800, 2.9)
  assert(detail.visible)
  scenery.view(camera, 800, 800, 2.5)
  assert(!detail.visible)
  scenery.view(camera, 800, 800, 2.9)
  assert(!detail.visible)
  scenery.view(camera, 800, 800, 3.1)
  assert(detail.visible)
  // Camera rotates in place: position-only cache keys used to leave old detail visible.
  camera.lookAt(cell.x, 4000, cell.y)
  camera.updateMatrixWorld()
  scenery.view(camera, 800, 800, 3.1)
  assert(!detail.visible)
  scenery.dispose()
  mesh.dispose()
})

test('recorded homes receive detail according to their projected size', () => {
  const { world } = fixture(() => false),
    cell = world.cells[87]
  const meters = 1024 / CELL_SIZE
  world.adaptive = { metersPerMapUnit: meters, buildingVersion: 1, sites: {} } as World['adaptive']
  world.viewHomes = [
    {
      id: 'home',
      cell: cell.id,
      pool: 0,
      capacity: 8,
      residents: 8,
      x: cell.x * meters,
      y: cell.y * meters,
      building: footprint(cell.x, cell.y, 0.2, 0.3, 0.3).map((p) => ({ x: p.x * meters, y: p.z * meters })),
    },
  ] as World['viewHomes']
  const { mesh, picker } = terrain(world),
    scenery = new CityScenery(world, picker)
  const camera = cameraAt(cell.x, cell.y)
  scenery.view(camera, 800, 800, 3)
  assert.equal(scenery.group.children.length, 1, 'subpixel house needs no detailed facade')
  scenery.view(camera, 800, 800, 40)
  assert.equal(scenery.group.children.filter((g) => g.visible).length, 2)
  scenery.dispose()
  mesh.dispose()
})

test('terrain picking skips transparent coastline triangles and can hit visible land behind them', () => {
  const { world } = fixture(() => false)
  const { mesh, picker } = terrain(world, (_x, z) => 30 + 20 * Math.sin(z / 8))
  const material = new THREE.MeshBasicMaterial(),
    surface = new THREE.Mesh(mesh, material)
  surface.updateMatrixWorld()
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(50, 55, 0),
    new THREE.Vector3(0, -0.15, 1).normalize(),
  )
  const all = raycaster.intersectObject(surface)
  assert(all.length > 1, 'fixture crosses several ridges')
  const cutoff = (all[0].point.z + all[1].point.z) / 2
  const hit = picker.intersect(raycaster.ray, (_x, z) => z > cutoff)
  assert(hit)
  assert(hit.distanceTo(all[1].point) < 1e-6)
  assert.equal(
    picker.intersect(raycaster.ray, () => false),
    null,
  )
  mesh.dispose()
  material.dispose()
})
