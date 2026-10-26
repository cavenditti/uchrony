import test from 'node:test'
import assert from 'node:assert/strict'
import { terrainHeight, reliefRandom } from '../src/map/relief-field'
import { CELL_SIZE } from '../src/sim/grid'
import type { Cell } from '../src/sim/types'

const field = (elevation: number) => ({
  width: 6,
  height: 6,
  cells: Array.from({ length: 36 }, (_, id) => ({
    id,
    q: id % 6,
    r: Math.floor(id / 6),
    elevation,
    x: ((id % 6) + 0.5) * CELL_SIZE,
    y: (Math.floor(id / 6) + 0.5) * CELL_SIZE,
    terrain: elevation <= 0.095 ? 'water' : 'mountains',
    moisture: 0.5,
    river: false,
    region: 0,
  })) as Cell[],
})

test('sea remains flat; relief is finite outside the field and does not mutate geography', () => {
  const ocean = field(0.02),
    mountains = field(0.7),
    before = structuredClone(mountains)
  for (const x of [-100, 0, 12, 33, 1000])
    for (const y of [-100, 0, 24, 56, 1000]) {
      assert.equal(terrainHeight(ocean, x, y), 0)
      const height = terrainHeight(mountains, x, y)
      assert(Number.isFinite(height) && height > 0)
    }
  assert.deepEqual(mountains, before)
})

test('the height field is continuous at square row and column boundaries', () => {
  const world = field(0.5)
  for (const c of world.cells) c.elevation += (c.id % 4) * 0.035
  for (let y = 5; y < 45; y += 0.5) {
    assert(Math.abs(terrainHeight(world, 24.25, y) - terrainHeight(world, 24.25001, y)) < 0.01)
    assert(Math.abs(terrainHeight(world, 25, y) - terrainHeight(world, 25, y + 0.00001)) < 0.01)
  }
})

test('scenery variation is deterministic and bounded without consuming simulation randomness', () => {
  for (let id = 0; id < 1000; id++) {
    assert.equal(reliefRandom(id), reliefRandom(id))
    assert(reliefRandom(id) >= 0 && reliefRandom(id) <= 1)
  }
})

test('camera-only frames neither resize backing stores nor invalidate overlay textures', async () => {
  const { resizeCanvas, OverlayUpdates } = await import('../src/map/render-budget')
  let width = 1440,
    height = 946,
    writes = 0
  const canvas = {
    get width() {
      return width
    },
    set width(v) {
      writes++
      width = v
    },
    get height() {
      return height
    },
    set height(v) {
      writes++
      height = v
    },
  }
  const updates = new OverlayUpdates(),
    revision = {}
  assert(updates.shouldPaint(revision, 0, false))
  for (let frame = 1; frame <= 10000; frame++) {
    resizeCanvas(canvas, 1440, 946)
    assert.equal(updates.shouldPaint(revision, frame * 16.7, false), false)
  }
  assert.equal(writes, 0)
  resizeCanvas(canvas, 390, 794)
  assert.equal(writes, 2)
  assert(updates.shouldPaint({}, 170000, false), 'selection and layer changes repaint immediately')
})

test('camera redraws do not bypass the freight upload cadence; new content is immediate', async () => {
  const { OverlayUpdates } = await import('../src/map/render-budget')
  const updates = new OverlayUpdates(),
    revision = {}
  assert(updates.shouldPaint(revision, 0, true))
  for (let t = 1; t < 80; t++) assert.equal(updates.shouldPaint(revision, t, true), false)
  assert(updates.shouldPaint(revision, 80, true))
  assert(updates.shouldPaint({}, 81, true))
  assert.equal(updates.shouldPaint(revision, 1000, false), true)
  assert.equal(updates.shouldPaint(revision, 2000, false), false)
})

test('bounded terrain picking matches exhaustive raycasting, including slopes, edges and ocean', async () => {
  const { PlaneGeometry, Mesh, MeshBasicMaterial, Raycaster, Vector3 } = await import('three')
  const { TerrainPicker } = await import('../src/map/relief-picking')
  const geometry = new PlaneGeometry(160, 100, 160, 100)
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(80, 0, 50)
  const positions = geometry.attributes.position
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      z = positions.getZ(i)
    positions.setY(i, Math.max(0, Math.sin(x * 0.12) * Math.cos(z * 0.09) * 35))
  }
  const picker = new TerrainPicker(geometry),
    material = new MeshBasicMaterial(),
    mesh = new Mesh(geometry, material)
  mesh.updateMatrixWorld()
  const raycaster = new Raycaster()
  for (let i = 0; i < 180; i++) {
    const x = i < 3 ? [0, 160, -1][i] : reliefRandom(i) * 180 - 10
    const z = i < 3 ? 50 : reliefRandom(i + 17) * 120 - 10
    const direction = new Vector3(i % 3 === 0 ? 0.25 : 0, -1, i % 2 ? -0.65 : 0).normalize()
    raycaster.set(new Vector3(x, 300, z + (i % 2 ? 195 : 0)), direction)
    const expected = raycaster.intersectObject(mesh)[0]?.point ?? null
    const actual = picker.intersect(raycaster.ray)
    assert.equal(!!actual, !!expected, `ray ${i} should agree on whether it hits`)
    if (actual && expected)
      assert(actual.distanceTo(expected) < 1e-6, `ray ${i} should hit the same triangle`)
  }
  geometry.dispose()
  material.dispose()
})
