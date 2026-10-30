import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clarkProfile,
  openingFabricPosition,
  settlementAnchor,
  spreadSettlement,
} from '../src/sim/opening-settlements'
import { openingSupport, compactResidence } from '../src/sim/residential-sites'
import { cellPosition } from '../src/sim/physical-space'
import { CELL_METERS } from '../src/sim/grid'
import { generateWorld } from '../src/sim/generate'
import { prepareSpatialWorld } from '../src/sim/engine'
import { population } from '../src/sim/types'
import { SETTLEMENT } from '../src/sim/settlement-model'
import { MODEL_PARAMETERS } from '../src/sim/model-parameters'
import { settlementWorld } from './fixtures/settlement-world'

const land = () => true
const centre = (w: ReturnType<typeof settlementWorld>) => 16 * w.width + 16

test('a settlement spread conserves its residents and only uses eligible samples', () => {
  const w = settlementWorld()
  for (const people of [1, 499, 12_345, 250_001]) {
    const shares = spreadSettlement(w, centre(w), people, land)
    assert.equal(
      [...shares.values()].reduce((sum, n) => sum + n, 0),
      people,
    )
    assert.ok([...shares.values()].every((n) => Number.isSafeInteger(n) && n > 0))
  }
  const east = (cell: number) => cell % w.width >= 16
  const shares = spreadSettlement(w, centre(w), 200_000, east)
  assert.equal(
    [...shares.values()].reduce((sum, n) => sum + n, 0),
    200_000,
  )
  assert.ok([...shares.keys()].every(east), 'residents never land on ineligible samples')
  // With no eligible sample in reach, everyone stays on the nucleus sample.
  assert.deepEqual([...spreadSettlement(w, centre(w), 900, () => false)], [[centre(w), 900]])
})

test('larger settlements spread further with a falling density gradient', () => {
  const w = settlementWorld()
  const village = spreadSettlement(w, centre(w), 1_000, land),
    town = spreadSettlement(w, centre(w), 20_000, land),
    city = spreadSettlement(w, centre(w), 300_000, land)
  // Below the compact threshold nowhere, a village stays whole on its nucleus.
  assert.deepEqual([...village], [[centre(w), 1_000]])
  assert.ok(town.size > village.size && city.size > town.size, 'extent grows with size')
  assert.ok(city.size >= 40, `a 300,000-resident city covers many samples, not ${city.size}`)
  // Mean residents per sample fall ring by ring away from the nucleus.
  const q0 = centre(w) % w.width,
    r0 = Math.floor(centre(w) / w.width),
    rings = new Map<number, number[]>()
  for (const [cell, people] of city) {
    const ring = Math.max(Math.abs((cell % w.width) - q0), Math.abs(Math.floor(cell / w.width) - r0))
    rings.set(ring, [...(rings.get(ring) ?? []), people])
  }
  const means = [...rings.keys()]
    .sort((a, b) => a - b)
    .map((ring) => rings.get(ring)!.reduce((sum, n) => sum + n, 0) / rings.get(ring)!.length)
  for (let i = 1; i < means.length; i++) assert.ok(means[i] < means[i - 1], `ring ${i} is less dense`)
  // Core density rises with size, so cities are relatively more compact.
  assert.ok(clarkProfile(300_000).core > clarkProfile(10_000).core)
  const { core, gradient } = clarkProfile(50_000)
  assert.ok(Math.abs(2 * Math.PI * core * (gradient / 1000) ** 2 - 50_000) < 1e-6, 'N = 2πρ₀b²')
})

test('every sample a settlement spreads onto holds compact fabric', () => {
  const w = settlementWorld(),
    floor = SETTLEMENT.entryBuiltCover * MODEL_PARAMETERS.fullBuiltPopulationPerCell
  for (const people of [1_500, 2_900, 8_000, 40_000, 300_000]) {
    const shares = spreadSettlement(w, centre(w), people, land)
    assert.ok(
      [...shares.values()].every((n) => n >= floor),
      `${people}: no urban fringe below the compact threshold (${[...shares.values()]})`,
    )
  }
  // An urban fringe below the threshold would be surveyed as dozens of
  // farmsteads that do not fit; this frontier world failed that way.
  const frontier = generateWorld('Frontier 0', 2, 8, undefined, 'regional', 'frontier')
  assert.doesNotThrow(() => prepareSpatialWorld(frontier))
  assert.equal(frontier.adaptive!.buildingVersion, 1)
})

test('anchors are deterministic, off-centre, bounded and lean towards a shore', () => {
  const w = settlementWorld()
  const anchors = Array.from({ length: 64 }, (_, i) => settlementAnchor(w, 200 + i))
  assert.deepEqual(
    anchors,
    Array.from({ length: 64 }, (_, i) => settlementAnchor(w, 200 + i)),
  )
  assert.ok(anchors.every((a) => Math.abs(a.dq) <= 0.36 && Math.abs(a.dr) <= 0.36))
  assert.ok(anchors.filter((a) => Math.hypot(a.dq, a.dr) > 0.05).length > 48, 'no lattice of centres')
  // Make the column east of a strip of samples water: their anchors move east.
  const coastal = Array.from({ length: 16 }, (_, i) => (8 + i) * w.width + 10)
  const before = coastal.map((cell) => settlementAnchor(w, cell).dq)
  for (const cell of coastal) w.cells[cell + 1].terrain = 'water'
  const after = coastal.map((cell) => settlementAnchor(w, cell).dq)
  assert.ok(after.every((dq, i) => dq >= before[i]))
  assert.ok(after.reduce((s, x) => s + x, 0) > before.reduce((s, x) => s + x, 0) + 1)
})

test('coarse fabric leans towards its developed neighbours and stays inside its sample', () => {
  const w = settlementWorld()
  const cell = centre(w),
    built = new Map([[cell - 1, 0.6]]) // a dense neighbour to the west
  const alone = openingFabricPosition(w, cell, () => 0),
    leaning = openingFabricPosition(w, cell, (c) => built.get(c) ?? 0.05 * Number(c === cell))
  assert.ok(leaning.x < alone.x, 'fabric faces the denser neighbour')
  assert.ok(Math.abs(leaning.y - alone.y) < 1e-9, 'and does not drift sideways')
  const middle = cellPosition(w, cell)
  for (const p of [alone, leaning]) {
    assert.ok(Math.abs(p.x - middle.x) < CELL_METERS / 2 && Math.abs(p.y - middle.y) < CELL_METERS / 2)
  }
  // The support is fitted inside the sample, with the record's point at its centre.
  for (const capacity of [100, 9_000, 60_000]) {
    const corner = { x: middle.x + 500, y: middle.y - 500 },
      { x, y, parcel } = openingSupport(w, cell, corner, capacity)
    assert.equal(x, parcel.x + parcel.size / 2)
    assert.equal(y, parcel.y + parcel.size / 2)
    assert.ok(parcel.x >= middle.x - CELL_METERS / 2 && parcel.x + parcel.size <= middle.x + CELL_METERS / 2)
    assert.ok(parcel.y >= middle.y - CELL_METERS / 2 && parcel.y + parcel.size <= middle.y + CELL_METERS / 2)
  }
})

test('a generated world opens with graded, off-centre fabric and an exact census', () => {
  const w = generateWorld('Opening settlement geography', 2, 4)
  const total = w.regions.reduce((sum, r) => sum + population(r), 0)
  prepareSpatialWorld(w)
  const local = w.localEconomy!
  assert.equal(
    local.active.reduce((sum, id) => sum + population(local.units[id]), 0),
    total,
    'spreading urban residents never creates or loses anyone',
  )
  const homes = Object.values(w.adaptive!.sites).filter((s) => s.kind === 'residential' && !s.retired),
    developed = homes.filter((s) => compactResidence(s))
  assert.ok(developed.length > 0)
  const offCentre = developed.filter((s) => {
    const p = cellPosition(w, s.cell)
    return Math.hypot(s.x - p.x, s.y - p.y) > 1
  })
  assert.ok(offCentre.length >= developed.length * 0.9, 'opening fabric does not sit on sample centres')
  for (const s of homes) {
    const p = cellPosition(w, s.cell),
      b = s.parcel!
    assert.ok(b.x >= p.x - CELL_METERS / 2 - 1e-6 && b.x + b.size <= p.x + CELL_METERS / 2 + 1e-6)
    assert.ok(b.y >= p.y - CELL_METERS / 2 - 1e-6 && b.y + b.size <= p.y + CELL_METERS / 2 + 1e-6)
  }
  // Sizes are graded rather than one capped square: several distinct supports.
  const sizes = new Set(developed.map((s) => Math.round(s.parcel!.size / 50)))
  assert.ok(sizes.size >= Math.min(4, developed.length), `support sizes vary: ${[...sizes]}`)
})
