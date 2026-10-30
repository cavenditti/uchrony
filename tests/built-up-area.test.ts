import test from 'node:test'
import assert from 'node:assert/strict'
import { FabricShare, lotCorners, type FabricRecord } from '../src/map/built-up-area'
import { urbanFabricIntensity, urbanFabricSupport, type UrbanPlot } from '../src/map/quadtree'
import type { PointMeters } from '../src/sim/adaptive-types'

const record = (x: number, y: number, size: number, intensity: number): FabricRecord => ({
  support: { x: x - size / 2, y: y - size / 2, size },
  intensity,
})

/** Shoelace area of a closed polygon. */
const area = (points: PointMeters[]) =>
  Math.abs(
    points.reduce(
      (sum, a, i) => sum + a.x * points[(i + 1) % points.length].y - points[(i + 1) % points.length].x * a.y,
      0,
    ),
  ) / 2

test('fabric is a deterministic function of its records', () => {
  const a = new FabricShare('home:7', record(5000, 5000, 800, 0.7), [record(5900, 5100, 600, 0.4)]),
    b = new FabricShare('home:7', record(5000, 5000, 800, 0.7), [record(5900, 5100, 600, 0.4)])
  assert.deepEqual(a.outline(), b.outline())
  assert.deepEqual(a.lots(), b.lots())
  assert.notDeepEqual(new FabricShare('home:8', record(5000, 5000, 800, 0.7)).lots(), a.lots())
})

test("an isolated record's outline is an irregular disc with its square's area", () => {
  for (const size of [300, 800, 1200]) {
    const share = new FabricShare('home:1', record(10_000, 10_000, size, 0.5)),
      outline = share.outline(),
      radii = outline.map((p) => Math.hypot(p.x - 10_000, p.y - 10_000))
    assert.ok(Math.abs(area(outline) / size ** 2 - 1) < 0.06, `area ≈ side² for ${size} m`)
    assert.ok(Math.max(...radii) / Math.min(...radii) > 1.1, 'the outline is irregular, not a circle')
    for (const lot of share.lots()) assert.ok(share.intensity(lot.x, lot.y) >= -1)
  }
})

test('neighbouring records tile one continuous built-up area without double fill', () => {
  // Two records one sample apart. Their supports sum between them, so the
  // merged area is larger than the two isolated envelopes together.
  const west = record(10_000, 10_000, 850, 0.8),
    east = record(11_024, 10_000, 850, 0.8)
  const shares = [new FabricShare('a', west, [east]), new FabricShare('b', east, [west])],
    alone = [new FabricShare('a', west), new FabricShare('b', east)]
  let merged = 0,
    bridged = 0
  for (let x = 9_300; x <= 11_724; x += 24)
    for (let y = 9_300; y <= 10_700; y += 24) {
      const owners = shares.filter((s) => s.intensity(x, y) >= 0).length
      assert.ok(owners <= 1, `(${x}, ${y}) is drawn by ${owners} records`)
      merged += owners
      if (owners && alone.every((s) => s.intensity(x, y) < 0)) bridged++
    }
  assert.ok(bridged > 0 && bridged < merged * 0.2, `the merge fills the gap (${bridged} of ${merged})`)
  // Every lot centre of one share lies outside the other share.
  for (const lot of shares[0].lots()) assert.ok(shares[1].intensity(lot.x, lot.y) < 0)
  for (const lot of shares[1].lots()) assert.ok(shares[0].intensity(lot.x, lot.y) < 0)
})

test('denser fabric has shorter blocks and covers more of its outline', () => {
  const coverage = (intensity: number) => {
    const share = new FabricShare('home:3', record(20_000, 20_000, 900, intensity)),
      roofs = share.lots().reduce((sum, lot) => sum + area(lotCorners(lot)), 0)
    return { pitch: share.pitch, share: roofs / area(share.outline()) }
  }
  const fringe = coverage(0.1),
    core = coverage(0.95)
  assert.ok(core.pitch < fringe.pitch)
  assert.ok(core.share > fringe.share * 1.5, `core ${core.share} vs fringe ${fringe.share}`)
  assert.ok(core.share < 1, 'streets and yards remain open')
})

test('drawn supports follow developed residents, not the fixed-density record support', () => {
  const plot = (urbanResidents: number, residents: number): UrbanPlot => ({
    id: 'home:1',
    cell: 0,
    pool: 0,
    capacity: residents,
    residents,
    urbanResidents,
    developed: true,
    parcel: { x: 0, y: 0, size: Math.min(850, Math.sqrt(residents * 46)) },
  })
  const hamlet = plot(400, 3000),
    town = plot(6000, 9000),
    core = plot(30_000, 33_000)
  assert.equal(urbanFabricIntensity(hamlet), 0)
  assert.equal(urbanFabricIntensity(core), 1)
  assert.ok(urbanFabricIntensity(town) > 0.5 && urbanFabricIntensity(town) < 0.7)
  // Density rises tenfold from fringe to core: area = residents / (2,000 · 10^t).
  assert.ok(Math.abs(urbanFabricSupport(hamlet).size - Math.sqrt((400 / 2000) * 1e6)) < 1e-6)
  assert.ok(urbanFabricSupport(town).size > urbanFabricSupport(hamlet).size)
  assert.ok(urbanFabricSupport(core).size <= 1024 * 1.2)
  // The drawn support stays centred on the record's own support.
  const p = town.parcel,
    s = urbanFabricSupport(town)
  assert.ok(Math.abs(s.x + s.size / 2 - p.x - p.size / 2) < 1e-9)
})
