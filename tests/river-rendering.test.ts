import test from 'node:test'
import assert from 'node:assert/strict'
import {
  riverCurves,
  riverHalfWidth,
  riverPoint,
  riverOutletDistances,
  type RiverCurve,
} from '../src/map/rivers'
import { landscapeField, landscapeElevation } from '../src/map/landscape-field'
import { generateGeography } from '../src/sim/geography'

test('smooth reaches preserve drainage endpoints and tributary joins without mutating geography', () => {
  const cells = generateGeography('River curves', 3, 112, 72),
    world = { cells, width: 112, height: 72 },
    before = structuredClone(cells),
    curves = riverCurves(world)
  assert(curves.length > 10)
  const represented = new Set<number>()
  const outgoing = new Map(curves.map((curve) => [curve.from, curve]))
  for (const curve of curves) {
    const next = outgoing.get(curve.to)
    if (next)
      assert.equal(
        riverHalfWidth(curve, 1),
        riverHalfWidth(next, 0),
        'no width step between connected reaches',
      )
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
    assert.equal(curve.mouth, cells[curve.to].terrain === 'water')
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

test('estuary distance follows drainage through short reaches and tributaries, not nearby inland water', async () => {
  const reach = (from: number, to: number, length: number, mouth = false): RiverCurve => ({
    from,
    to,
    a: { x: 0, y: 10 },
    b: { x: length / 3, y: 10 },
    c: { x: (length * 2) / 3, y: 10 },
    d: { x: length, y: 10 },
    flow: 100,
    mouth,
  })
  const curves = [reach(2, 3, 30), reach(0, 1, 10), reach(3, 4, 8, true), reach(1, 3, 20), reach(8, 9, 12)]
  const before = structuredClone(curves)
  assert.deepEqual([...riverOutletDistances(curves, [30, 10, 8, 20, 12])], [8, 28, 0, 8, Infinity])
  assert.deepEqual(curves, before)
  assert.deepEqual(
    [...riverOutletDistances([reach(0, 1, 5), reach(1, 0, 5)], [5, 5])],
    [Infinity, Infinity],
    'malformed cycles cannot stall rendering',
  )

  const { PlaneGeometry } = await import('three')
  const { TerrainPicker } = await import('../src/map/relief-picking')
  const { riverSurface } = await import('../src/map/river-surface')
  const terrain = new PlaneGeometry(100, 80)
  terrain.rotateX(-Math.PI / 2)
  terrain.translate(50, 0, 40)
  const { mesh } = riverSurface(curves, new TerrainPicker(terrain))
  const distances = mesh.geometry.attributes.riverMouthDistance
  assert(Array.from(distances.array).every(Number.isFinite), 'GPU interpolation never receives infinity')
  let offset = 0
  const endpoints = curves.map((curve) => {
    const count = (Math.max(2, Math.ceil(curve.d.x / 2.5)) + 1) * 2
    const result = [distances.getX(offset), distances.getX(offset + count - 1)]
    offset += count
    return result
  })
  assert.equal(endpoints[0][1], endpoints[2][0], 'tributary and main channel meet with the same blend')
  assert.equal(endpoints[1][1], endpoints[3][0], 'short consecutive reaches keep a continuous blend')
  assert.equal(endpoints[2][1], 0)
  assert(endpoints[4][1] > 42, 'unconnected inland ends retain their river pigment')
  mesh.geometry.dispose()
  mesh.material.dispose()
  terrain.dispose()
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
