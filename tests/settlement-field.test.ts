import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGGLOMERATION,
  FABRIC,
  SAMPLE_KM2,
  buildSettlementField,
  fieldReach,
  fieldSources,
  sourceUrbanity,
  urbanity,
  type SettlementField,
} from '../src/sim/settlement-field'
import { prominence, settlementStructure, settlementTopology } from '../src/sim/settlement-topology'
import { developedResidents } from '../src/sim/residential-sites'
import { SETTLEMENT } from '../src/sim/settlement-model'
import { MODEL_PARAMETERS } from '../src/sim/model-parameters'
import { CELL_METERS } from '../src/sim/grid'
import { generateWorld } from '../src/sim/generate'
import { prepareSpatialWorld } from '../src/sim/engine'
import { rebuildAdaptiveMesh } from '../src/sim/adaptive-world'
import { addBuilding, addRecord, addTown, settlementWorld } from './fixtures/settlement-world'

const deposited = (field: SettlementField) => {
  const nodeKm2 = (field.scale.span / 1000) ** 2
  let total = 0
  for (const tile of field.tiles.values()) for (const density of tile) total += density * nodeKm2
  return total
}

test('both field scales conserve developed residents exactly, including at the world edge', () => {
  const w = settlementWorld(8, 8)
  addTown(w, { x: 2000, y: 2000 }, 3000)
  addBuilding(w, { x: 4, y: 4 }, 7) // the kernel is clipped by two world edges
  addRecord(w, 63, 4000, 0.05)
  const sources = fieldSources(w)
  const developed = sources.reduce((sum, s) => sum + s.developed, 0)
  for (const scale of [FABRIC, AGGLOMERATION]) {
    const field = buildSettlementField(w, sources, scale)
    assert.equal(field.developed, developed)
    assert(Math.abs(deposited(field) - developed) < 1e-6 * developed)
    assert(Math.abs(field.sampleMass.reduce((a, b) => a + b, 0) - developed) < 1e-6 * developed)
  }
})

test('developed residents follow built cover continuously, with no entry threshold', () => {
  const w = settlementWorld(4, 4)
  const record = addRecord(w, 5, 20000, 0)
  const values = [0, 0.01, SETTLEMENT.entryBuiltCover - 1e-6, SETTLEMENT.entryBuiltCover, 0.2, 0.6].map(
    (built) => {
      record.openingBuilt = built
      return developedResidents(w, record)
    },
  )
  assert.deepEqual(
    values,
    values
      .map((_, i) => [0, 0.01, SETTLEMENT.entryBuiltCover - 1e-6, SETTLEMENT.entryBuiltCover, 0.2, 0.6][i])
      .map((built) => Math.min(20000, built * MODEL_PARAMETERS.fullBuiltPopulationPerCell)),
  )
  // Crossing the old compact-footprint threshold changes developed residents by a hair, not wholesale.
  assert(values[3] - values[2] < 1)
})

test('urbanity is a smooth logistic in density, half urban at the configured density', () => {
  assert.equal(urbanity(0), 0)
  assert(Math.abs(urbanity(SETTLEMENT.urbanDensity) - 0.5) < 1e-12)
  let previous = 0
  for (let density = 1; density < 1e6; density *= 1.3) {
    const value = urbanity(density)
    assert(value > previous && value < 1)
    previous = value
  }
  assert(urbanity(300) < 0.05 && urbanity(5000) > 0.9)
})

test('dense fabric is urban, scattered farms are not, and a farm beside a town is in between', () => {
  const w = settlementWorld(16, 16)
  const town = addTown(w, { x: 4096, y: 4096 }, 4000, 320)
  const neighbour = addBuilding(w, { x: 4096 + 250, y: 4096 }, 6)
  const farms = [0, 1, 2, 3].map((i) => addBuilding(w, { x: 12000 + i * 600, y: 12000 }, 6))
  const sources = fieldSources(w)
  const fabric = buildSettlementField(w, sources, FABRIC)
  const of = (id: string) =>
    sourceUrbanity(
      fabric,
      sources.find((s) => s.id === id)!,
    )
  assert(of(town[Math.floor(town.length / 2)].id) > 0.9)
  assert(farms.every((farm) => of(farm.id) < 0.05))
  const between = of(neighbour.id)
  assert(between > of(farms[0].id) && between < of(town[0].id))
})

test('dispersed occupants share their sample mean; a coarse record is not urban by threshold', () => {
  const w = settlementWorld(4, 4)
  const rural = addRecord(w, 5, 3000, 0)
  const village = addRecord(w, 10, 3000, 0.02)
  const sources = fieldSources(w)
  const fabric = buildSettlementField(w, sources, FABRIC)
  const ruralU = sourceUrbanity(
    fabric,
    sources.find((s) => s.id === rural.id)!,
  )
  const villageU = sourceUrbanity(
    fabric,
    sources.find((s) => s.id === village.id)!,
  )
  assert.equal(ruralU, 0)
  assert(villageU > 0 && villageU < 0.5, 'a third of its residents are developed, at moderate density')
  assert(
    Math.abs(
      fabric.sampleMass[10] / SAMPLE_KM2 - (0.02 * MODEL_PARAMETERS.fullBuiltPopulationPerCell) / SAMPLE_KM2,
    ) < 1,
  )
})

test('an isolated building reads its own residents as reach; reach is concave over distance', () => {
  const w = settlementWorld(8, 8)
  const centre = { x: 4 * CELL_METERS - 128, y: 4 * CELL_METERS - 128 }
  addBuilding(w, centre, 900)
  const field = buildSettlementField(w, fieldSources(w), AGGLOMERATION)
  assert(Math.abs(fieldReach(field, centre.x, centre.y) - 900) < 1e-6)
  const at = (d: number) => fieldReach(field, centre.x + d, centre.y)
  assert(at(512) < at(0) && at(1024) < at(512) && at(1792) < at(1024))
  assert.equal(at(2600), 0)
})

test('a lattice of equal records one sample apart forms one plateau, never a grid of peaks', () => {
  const w = settlementWorld(24, 24)
  for (let r = 6; r < 14; r++) for (let q = 6; q < 14; q++) addRecord(w, r * 24 + q, 3000, 0.05)
  const { topology } = settlementStructure(w)
  assert.equal(topology.summits.length, 1)
  const significant = topology.modes.filter((m) => prominence(m) >= 0.2)
  assert.equal(significant.length, 1, 'ripples over evenly developed land are not centres')
})

test('centres form a hierarchy: satellites grade from shoulder to quarter to independent with distance', () => {
  const satellite = (distance: number) => {
    const w = settlementWorld(32, 32)
    addTown(w, { x: 6000, y: 6000 }, 20000, 512)
    addTown(w, { x: 6000 + distance, y: 6000 }, 5000, 256)
    const { topology } = settlementStructure(w)
    const child = topology.modes.find((m) => m.parent >= 0)
    return { summits: topology.summits.length, prominence: child ? prominence(child) : undefined }
  }
  // Close in, the town is a shoulder of the city's slope and gravitates to it.
  assert((satellite(2600).prominence ?? 0) < 0.1)
  const near = satellite(3000).prominence!
  assert(near >= 0.2 && near < 0.4, `quarter-range prominence ${near}`)
  assert(satellite(4000).prominence! > 0.6)
  assert.equal(satellite(6000).summits, 2, 'beyond market reach the towns are separate urban areas')
  let previous = -1
  for (const distance of [2600, 2800, 3000, 3200, 3400, 3600, 3800, 4000]) {
    const p = satellite(distance).prominence ?? 0
    assert(p >= previous, 'prominence never falls as the satellite moves away')
    previous = p
  }
})

test('an unreachable floor leaves no urban area at all', () => {
  const w = settlementWorld(16, 16)
  addTown(w, { x: 6000, y: 6000 }, 20000, 512)
  const { agglomeration } = settlementStructure(w)
  assert.equal(settlementTopology(w, agglomeration).summits.length, 1)
  assert.equal(settlementTopology(w, agglomeration, 1e9).summits.length, 0)
})

test('urban areas never cross a sovereign boundary', () => {
  const w = settlementWorld(16, 8, (cell) => (cell % 16 < 8 ? 0 : 1))
  addTown(w, { x: 8 * CELL_METERS - 300, y: 4000 }, 3000)
  addTown(w, { x: 8 * CELL_METERS + 300, y: 4000 }, 3000)
  const { topology } = settlementStructure(w)
  assert.equal(topology.summits.length, 2)
})

test('fields read only physical sites: refining or coarsening the mesh changes nothing', () => {
  const w = generateWorld('Field resolution', 3, 8, undefined, 'regional', 'frontier')
  prepareSpatialWorld(w)
  const reference = settlementStructure(w)
  const key = (s: ReturnType<typeof settlementStructure>) =>
    JSON.stringify({
      modes: s.topology.modes,
      urban: [...s.sourceUrbanity],
      reach: [...s.sourceReach],
      mass: [...s.agglomeration.sampleMass],
    })
  const expected = key(reference)
  for (const mode of ['coarse', 'adaptive'] as const) {
    rebuildAdaptiveMesh(w, mode)
    assert.equal(key(settlementStructure(w)), expected)
  }
})
