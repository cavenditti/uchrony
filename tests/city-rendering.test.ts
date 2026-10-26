import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { cityLayout, describeCity } from '../src/map/city-layout'
import { CityScenery } from '../src/map/city-scenery'
import { TerrainPicker } from '../src/map/relief-picking'
import { zoomAt } from '../src/map/geometry'
import type { World } from '../src/sim/types'
import type { Settlement } from '../src/sim/spatial'
import { urbanForm } from '../src/map/urban-form'
import { CELL_SIZE } from '../src/sim/grid'
import { SceneryMotion } from '../src/map/scenery-motion'
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
    x: ((id % width) + 0.5) * CELL_SIZE,
    z: 0,
    y: (Math.floor(id / width) + 0.5) * CELL_SIZE,
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
  assert.equal(layout.gardens.length, 0)
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
  assert(layout.gardens.length <= 12)
  for (const g of layout.gardens)
    assert(
      Math.abs(g.z - city.z) > radius + Math.hypot(g.width, g.depth) / 2,
      'garden parcels keep the river corridor open',
    )
  for (const b of layout.bridges) assert((b.a.z - city.z) * (b.b.z - city.z) < 0)
})

test('scenery time freezes while disabled and resumes without hidden-tab catch-up', () => {
  const motion = new SceneryMotion()
  const uniform = motion.time
  motion.advance(1000, true)
  motion.advance(1050, true)
  assert.equal(uniform.value, 0.05)
  motion.advance(1100, false)
  motion.advance(900000, false)
  assert.equal(uniform.value, 0.05)
  motion.advance(900100, true)
  assert.equal(uniform.value, 0.05)
  motion.advance(900150, true)
  assert.equal(uniform.value, 0.1)
  motion.advance(910000, true)
  assert.equal(uniform.value, 0.2, 'a late frame has bounded movement')
  assert.equal(motion.time, uniform, 'animation updates do not allocate replacement uniforms')
})

test('funded capacity changes neighborhood density without forcing decorative samples into towers', () => {
  const scale = 1024 / CELL_SIZE,
    center = { x: world.cells[site.cell].x * scale, y: world.cells[site.cell].y * scale }
  const parcel = { x: center.x - 256, y: center.y - 256, size: 512 }
  const render = (capacity: number, activity = 'urban', distance = 0) => {
    const form = urbanForm(capacity, parcel, center, scale, activity, false, distance, 1500)
    const description = describeCity(
      { ...world, adaptive: { metersPerMapUnit: scale, sites: {} } as World['adaptive'] },
      { ...site, capacity, position: center, parcel, form },
    )
    return cityLayout(world, description)
  }
  const low = render(1000, 'urban', 1000),
    dense = render(30000),
    industry = render(1000, 'industrial', 1000)
  assert.equal(low.city.form!.district, 'gardens')
  assert.equal(dense.city.form!.district, 'center')
  assert.equal(industry.city.form!.district, 'industrial')
  assert(dense.buildings.length >= low.buildings.length)
  const footprints = (layout: ReturnType<typeof cityLayout>) =>
    layout.buildings.map(({ x, z, width, depth, angle }) => ({ x, z, width, depth, angle }))
  assert.deepEqual(footprints(low), footprints(dense), 'growth preserves existing street-front lots')
  assert.deepEqual(low.streets, dense.streets)
  assert(dense.buildings.every((b) => (b.storeys ?? 1) <= 6))
  assert(low.buildings.every((b) => (b.storeys ?? 1) <= 6))
  assert(new Set(dense.buildings.map((b) => b.width.toFixed(3))).size > 3)
  assert(industry.buildings.some((b) => b.use === 'workshop'))
  assert(
    industry.buildings.filter((b) => b.use === 'workshop').every((b) => b.representedCapacity === undefined),
  )
  for (const layout of [low, dense, industry]) {
    const represented = layout.buildings.reduce((sum, b) => sum + (b.representedCapacity ?? 0), 0)
    assert(Math.abs(represented - layout.city.capacity!) < 1e-7)
    assert(layout.buildings.length <= 256)
    for (const b of layout.buildings) {
      assert(b.x - b.width / 2 >= parcel.x / scale && b.x + b.width / 2 <= (parcel.x + parcel.size) / scale)
      assert(b.z - b.depth / 2 >= parcel.y / scale && b.z + b.depth / 2 <= (parcel.y + parcel.size) / scale)
    }
  }
  assert(dense.streets.length > 0)
  assert(dense.square.length > 0, 'the existing civic square remains readable')
})

test('extreme capacity and clipped decorative lots cannot explode building height', () => {
  const scale = 1024 / CELL_SIZE
  const center = { x: world.cells[site.cell].x * scale, y: world.cells[site.cell].y * scale }
  for (const size of [128, 512, 850]) {
    const parcel = { x: center.x - size / 2, y: center.y - size / 2, size }
    for (const capacity of [500, 30000, 1000000]) {
      const form = urbanForm(capacity, parcel, center, scale, 'urban', true, 0, size)
      const description = describeCity(
        { ...world, adaptive: { metersPerMapUnit: scale, sites: {} } as World['adaptive'] },
        { ...site, capacity, position: center, parcel, form },
      )
      const layout = cityLayout(world, description)
      assert(layout.buildings.length > 0)
      assert(
        layout.buildings.every((b) => (b.storeys ?? 1) <= 6 + 1e-9),
        'visible housing stays below six illustrated storeys',
      )
      assert(
        layout.buildings.every((b) => b.height <= Math.min(b.width, b.depth) * 1.15 + 1e-9),
        'no narrow needle towers',
      )
      const represented = layout.buildings.reduce((sum, b) => sum + (b.representedCapacity ?? 0), 0)
      assert(Math.abs(represented - capacity) < 1e-7, 'rendering does not remove housing capacity')
    }
  }
})

test('adaptive neighborhoods retain different street traditions, larger houses and stable plans', () => {
  const scale = 1024 / CELL_SIZE
  const center = { x: world.cells[site.cell].x * scale, y: world.cells[site.cell].y * scale }
  const parcel = { x: center.x - 425, y: center.y - 425, size: 850 }
  const forms = new Set<string>()
  for (let i = 0; i < 40; i++) {
    const form = urbanForm(18000, parcel, center, scale, 'urban', true, 0, 850)
    const description = describeCity(
      { ...world, adaptive: { metersPerMapUnit: scale, sites: {} } as World['adaptive'] },
      { ...site, id: `living-town:${i}`, capacity: 18000, position: center, parcel, form },
    )
    const layout = cityLayout(world, description)
    forms.add(layout.pattern)
    assert.deepEqual(cityLayout(world, description), layout)
    assert(layout.buildings.length < 100, 'avoid a carpet of tiny repeated lots')
    assert(
      layout.buildings.some((b) => Math.max(b.width, b.depth) * scale > 40),
      'readable house footprints',
    )
    assert(layout.streets.length > 0)
    const neighborhood = cityLayout(world, { ...description, civic: false })
    assert.equal(neighborhood.square.length, 0, 'satellite patches do not repeat the civic square')
  }
  assert.deepEqual(forms, new Set(['market', 'planned', 'spine']))
})
