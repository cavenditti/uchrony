import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { cityLayout, describeCity } from '../src/map/city-layout'
import { CityScenery } from '../src/map/city-scenery'
import { TerrainPicker } from '../src/map/relief-picking'
import { zoomAt } from '../src/map/geometry'
import type { World } from '../src/sim/types'
import type { Settlement } from '../src/sim/spatial'
const width = 40,
  height = 40
const world = {
  seed: 'City rendering',
  width,
  height,
  regions: [{ culture: 2 }],
  cells: Array.from({ length: width * height }, (_, id) => ({
    id,
    q: id % width,
    r: Math.floor(id / width),
    x: (id % width) * 12.124,
    z: 0,
    y: Math.floor(id / width) * 10.5,
    elevation: 0.2,
    moisture: 0.4,
    terrain: 'plains',
    region: 0,
    river: false,
  })),
  spatial: { version: 1, month: 0, districts: [], splits: [], settlements: [] },
} as unknown as World
const site: Settlement = {
  id: 'city:one',
  cell: 820,
  region: 0,
  name: 'One',
  kind: 'city',
  population: 50000,
  capital: true,
}

test('town layouts are deterministic, distinct, and independent of monthly totals and district refinement', () => {
  const a = describeCity(world, site),
    before = JSON.stringify(world)
  const layout = cityLayout(world, a)
  assert.deepEqual(
    layout,
    cityLayout(world, describeCity(world, { ...site, population: 90000, cells: [820, 821] })),
  )
  assert.notDeepEqual(
    layout.buildings,
    cityLayout(world, describeCity(world, { ...site, id: 'city:two' })).buildings,
  )
  assert.equal(JSON.stringify(world), before)
  assert(layout.buildings.length > 15 && layout.buildings.length < 400)
  assert.equal(layout.square.length, 4)
  assert(
    layout.streets.reduce(
      (sum, road) =>
        sum +
        road.points
          .slice(1)
          .reduce((n, p, i) => n + Math.hypot(p.x - road.points[i].x, p.z - road.points[i].z), 0),
      0,
    ) > 50,
  )
  assert(
    layout.buildings.every(
      (b) => Number.isFinite(b.x + b.z + b.height) && Math.hypot(b.x - a.x, b.z - a.z) < a.radius,
    ),
  )
})

test('coastal parcels and squares stay on land; empty ocean creates no town detail', () => {
  const ocean = {
    ...world,
    cells: world.cells.map((c) => ({ ...c, elevation: 0.01, terrain: 'water' as const })),
  }
  const layout = cityLayout(ocean, describeCity(ocean, site))
  assert.equal(layout.buildings.length, 0)
  assert.equal(layout.streets.length, 0)
  assert.equal(layout.square.length, 0)
})

test('city detail cache is bounded across a world tour and survives population-only updates', () => {
  const sites = Array.from({ length: 20 }, (_, i) => ({
    ...site,
    id: `city:${i}`,
    cell: (3 + Math.floor(i / 5) * 9) * width + 3 + (i % 5) * 8,
  }))
  const w = { ...world, spatial: { ...world.spatial!, settlements: sites } }
  const plane = new THREE.PlaneGeometry(500, 440, 40, 40).rotateX(-Math.PI / 2).translate(250, 10, 220)
  const scenery = new CityScenery(w, new TerrainPicker(plane))
  const camera = new THREE.OrthographicCamera(-20, 20, 20, -20, 1, 2000)
  let maxGround = 0,
    maxVisible = 0
  for (const s of sites) {
    const c = w.cells[s.cell]
    camera.position.set(c.x, 1000, c.y)
    camera.up.set(0, 0, -1)
    camera.lookAt(c.x, 0, c.y)
    camera.updateMatrixWorld()
    scenery.view(camera, 800, 800, 20)
    maxGround = Math.max(maxGround, scenery.group.children.length - 1)
    maxVisible = Math.max(maxVisible, scenery.group.children.slice(1).filter((g) => g.visible).length)
  }
  camera.left = -300
  camera.right = 300
  camera.top = 300
  camera.bottom = -300
  camera.position.set(250, 1000, 220)
  camera.lookAt(250, 0, 220)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
  scenery.view(camera, 1200, 1000, 3)
  assert.equal(scenery.group.children.slice(1).filter((g) => g.visible).length, 6)
  let retainedBytes = 0
  scenery.group.traverse((object) => {
    if (object instanceof THREE.InstancedMesh)
      retainedBytes += object.instanceMatrix.array.byteLength + (object.instanceColor?.array.byteLength ?? 0)
    else if (object instanceof THREE.Mesh)
      for (const attribute of Object.values(object.geometry.attributes))
        retainedBytes += attribute.array.byteLength
  })
  assert(retainedBytes < 8 * 1024 * 1024)
  assert(maxGround <= 12)
  assert(maxVisible <= 6)
  const previous = [...scenery.group.children]
  scenery.update({
    ...w,
    spatial: {
      ...w.spatial,
      month: 1,
      settlements: sites.map((s) => ({ ...s, population: s.population + 17 })),
    },
  })
  assert.deepEqual(scenery.group.children, previous)
  const times: number[] = []
  const before = performance.now()
  for (let i = 0; i < 100; i++) {
    camera.position.x += 0.01
    camera.updateMatrixWorld()
    scenery.view(camera, 800, 800, 20)
  }
  times.push(performance.now() - before)
  console.log(
    JSON.stringify({
      maxCachedCities: maxGround,
      maxVisibleCities: 6,
      retainedBytes,
      cameraChanges100ms: times[0],
    }),
  )
  scenery.dispose()
  assert.equal(scenery.group.parent, null)
  plane.dispose()
})

test('deep zoom remains pointer-anchored and bounded without changing the Atlas default', () => {
  const view = { zoom: 30, x: 20, y: -10 },
    point = { x: 300, y: 200 },
    size = { w: 1000, h: 800 }
  assert.equal(zoomAt(view, 10, point, size).zoom, 32)
  const next = zoomAt(view, 10, point, size, 500)
  assert.equal(next.zoom, 300)
  assert.equal((point.x - size.w / 2 - next.x) / next.zoom, (point.x - size.w / 2 - view.x) / view.zoom)
  assert.equal(zoomAt(next, 10, point, size, 500).zoom, 500)
})

test('street organizations have different silhouettes and keep homes away from rendered river banks', () => {
  const patterns = new Set<string>()
  for (let i = 0; i < 12; i++) {
    const city = describeCity(world, { ...site, id: `pattern:${i}` }),
      layout = cityLayout(world, city)
    patterns.add(layout.pattern)
    assert(layout.buildings.length < 400)
    assert(layout.buildings.every((b) => Math.hypot(b.x - layout.plaza.x, b.z - layout.plaza.z) > 3))
  }
  assert.equal(patterns.size, 3)
  const city = describeCity(world, site)
  const river = {
    from: 1,
    to: 2,
    a: { x: city.x - 30, y: city.z },
    b: { x: city.x - 10, y: city.z },
    c: { x: city.x + 10, y: city.z },
    d: { x: city.x + 30, y: city.z },
    flow: 100,
  }
  const layout = cityLayout(world, city, [river]),
    radius = (0.35 + Math.sqrt(100) * 0.13) / 2
  assert(layout.buildings.every((b) => Math.abs(b.z - city.z) > radius + 1.4))
  assert(layout.streets.some((s) => s.width === 0.42))
  assert(layout.bridges.length <= 2)
  for (const b of layout.bridges) assert((b.a.z - city.z) * (b.b.z - city.z) < 0)
})
