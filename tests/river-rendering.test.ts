import test from 'node:test'
import assert from 'node:assert/strict'
import { riverCurves, riverPoint } from '../src/map/rivers'
import { landscapeField, landscapeElevation } from '../src/map/landscape-field'
import { generateGeography } from '../src/sim/geography'

test('smooth reaches preserve drainage endpoints and tributary joins without mutating geography', () => {
  const cells = generateGeography('River curves', 3, 112, 72),
    world = { cells, width: 112, height: 72 },
    before = structuredClone(cells),
    curves = riverCurves(world)
  assert(curves.length > 10)
  const represented = new Set<number>()
  for (const curve of curves) {
    let id = curve.from
    const channel = [cells[id]]
    while (id !== curve.to) {
      assert(!represented.has(id), 'each drainage edge occurs in exactly one reach')
      represented.add(id)
      assert(cells[id].downstream !== undefined)
      id = cells[id].downstream!
      channel.push(cells[id])
    }
    assert.deepEqual(riverPoint(curve, 0), { x: cells[curve.from].x, y: cells[curve.from].y })
    assert.deepEqual(riverPoint(curve, 1), { x: cells[curve.to].x, y: cells[curve.to].y })
    const dx = curve.d.x - curve.a.x,
      dy = curve.d.y - curve.a.y
    for (let i = 0; i <= 20; i++) {
      const p = riverPoint(curve, i / 20)
      const projection = ((p.x - curve.a.x) * dx + (p.y - curve.a.y) * dy) / (dx * dx + dy * dy)
      assert(projection >= -1e-8 && projection <= 1 + 1e-8, 'curve cannot loop backwards')
      let corridor = Infinity
      for (let j = 0; j < channel.length - 1; j++) {
        const a = channel[j],
          b = channel[j + 1],
          dx = b.x - a.x,
          dy = b.y - a.y
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)))
        corridor = Math.min(corridor, Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t))
      }
      assert(corridor < 8.6, 'smoothing stays within the original drainage corridor')
    }
  }
  assert.equal(represented.size, cells.filter((c) => c.river).length)
  assert.deepEqual(cells, before)
  for (const c of cells) {
    c.region = (c.region + 7) % 17
    c.q += 100
    c.r += 100
  }
  assert.deepEqual(riverCurves(world), curves, 'positions and drainage, not administrative/grid addresses')
})

test('forest clusters are deterministic, budgeted and independent of administrative remeshing', async () => {
  const { forestSites } = await import('../src/map/forest-sites')
  const world = {
    cells: generateGeography('Forest sites', 3, 112, 72),
    width: 112,
    height: 72,
    seed: 'Forest sites',
  }
  const before = structuredClone(world),
    sites = forestSites(world)
  assert(sites.length > 100 && sites.length <= 18000)
  assert.deepEqual(world, before)
  for (const c of world.cells) c.region++
  assert.deepEqual(forestSites(world), sites)
  assert(
    new Set(sites.map((s) => Math.round(s.z * 100))).size > sites.length * 0.9,
    'no repeated planting rows',
  )
})

test('landscape interpolation is bounded, continuous and reused across administrative changes', () => {
  const cells = generateGeography('Render field', 3, 112, 72),
    world = { cells, width: 112, height: 72 },
    field = landscapeField(world)
  assert(field.data.byteLength <= 768 * 496 * 8 * 4)
  for (const c of cells.slice(1000, 1100)) {
    const a = landscapeElevation(field, c.x, c.y),
      b = landscapeElevation(field, c.x + 0.0001, c.y + 0.0001)
    assert(Number.isFinite(a) && a >= 0)
    assert(Math.abs(a - b) < 0.0001)
    c.region++
  }
  assert.equal(landscapeField({ ...world }), field)
  assert.notEqual(landscapeField({ ...world, cells: structuredClone(cells) }), field)
})

test('3D river ribbons follow actual terrain triangles and change visibility without rebuilding', async () => {
  const { PlaneGeometry } = await import('three')
  const { TerrainPicker } = await import('../src/map/relief-picking')
  const { riverSurface } = await import('../src/map/river-surface')
  const terrain = new PlaneGeometry(100, 80, 10, 8)
  terrain.rotateX(-Math.PI / 2)
  terrain.translate(50, 3, 40)
  const { mesh, minimumFlow } = riverSurface(
    [
      {
        from: 0,
        to: 1,
        a: { x: 10, y: 10 },
        b: { x: 30, y: 5 },
        c: { x: 65, y: 55 },
        d: { x: 90, y: 40 },
        flow: 100,
      },
    ],
    new TerrainPicker(terrain),
  )
  const positions = mesh.geometry.attributes.position
  assert(positions.count > 40)
  for (let i = 0; i < positions.count; i++) {
    assert(Math.abs(positions.getY(i) - 3.15) < 1e-5)
    assert(Number.isFinite(positions.getX(i)) && Number.isFinite(positions.getZ(i)))
  }
  const before = positions.array.slice()
  minimumFlow.value = 1000
  assert.deepEqual(positions.array, before)
  assert.equal(mesh.geometry.index!.count % 6, 0)
  mesh.geometry.dispose()
  mesh.material.dispose()
  terrain.dispose()
})
