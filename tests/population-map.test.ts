import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MIN_POPULATION_SQUARE_PIXELS,
  mapLeafAt,
  mapPopulationCellAt,
  visibleMapLeaves,
  visiblePopulationCells,
} from '../src/map/quadtree'
import { CELL_METERS } from '../src/sim/grid'
import { nodeBounds, rootBounds } from '../src/sim/physical-space'
import type { World } from '../src/sim/types'

const window = { x: 0, y: 0, width: CELL_METERS, height: CELL_METERS }

function fixture() {
  // A single occupied 8 m leaf, surrounded by empty land with mixed leaf sizes.
  const addresses: string[] = []
  const split = (id: string) => {
    if (id.length < 8) {
      split(id + '0')
      for (let q = 1; q < 4; q++) addresses.push(id + q)
    } else addresses.push(id)
  }
  split('r')
  const world = {
    width: 1,
    height: 1,
    viewOnly: true,
    adaptive: { revision: 0, metersPerMapUnit: 1 },
  } as World
  world.viewMesh = {
    addresses,
    population: Float64Array.from(addresses, (_, i) => (i === 0 ? 120 : 0)),
    jobs: Float64Array.from(addresses, (_, i) => (i === 0 ? 30 : 0)),
    landArea: Float64Array.from(addresses, (id) => {
      // One water quadrant and one half-land coastal quadrant in the finest branch.
      const size = nodeBounds(rootBounds(world), id).size
      return id === 'r0000001' ? 0 : id === 'r0000002' ? size ** 2 / 2 : size ** 2
    }),
  }
  return world
}

test('concentrated population occupies a readable square while preserving all totals', () => {
  const world = fixture(),
    before = structuredClone(world),
    scale = 0.1,
    leaves = visibleMapLeaves(world, window),
    cells = visiblePopulationCells(world, window, scale)
  assert(leaves[0].bounds.size * scale < 1)
  assert(cells.length < leaves.length)
  assert(cells.every((cell) => cell.bounds.size * scale >= MIN_POPULATION_SQUARE_PIXELS))
  assert(cells[0].bounds.size * scale < MIN_POPULATION_SQUARE_PIXELS * 2)
  for (const key of ['population', 'jobs', 'landArea'] as const)
    assert.equal(
      cells.reduce((sum, cell) => sum + cell[key], 0),
      leaves.reduce((sum, cell) => sum + cell[key], 0),
    )
  assert.equal(cells[0].population, 120)
  assert.equal(cells[0].landArea, 128 ** 2 - 96)
  assert.deepEqual(world, before)
})

test('pan and viewport clipping retain complete square density, including offscreen residents', () => {
  const world = fixture(),
    cells = visiblePopulationCells(world, window, 0.1),
    clipped = visiblePopulationCells(world, { x: 100, y: 100, width: 20, height: 20 }, 0.1)
  assert.deepEqual(clipped, [cells[0]])
  assert.deepEqual(visibleMapLeaves(world, { x: 100, y: 100, width: 20, height: 20 })[0].population, 0)
  assert.deepEqual(visiblePopulationCells(world, { x: -200, y: -200, width: 300, height: 300 }, 0.1), [
    cells[0],
  ])
  assert.deepEqual(visiblePopulationCells(world, { x: CELL_METERS, y: 0, width: 100, height: 100 }, 0.1), [])
})

test('each larger square sums every populated child recursively, without double counting', () => {
  const world = fixture(),
    mesh = world.viewMesh!
  // Different depths: 8 m, 16 m, 128 m and 512 m populated leaves.
  for (const [id, population] of [
    ['r0000003', 80],
    ['r000001', 200],
    ['r001', 600],
    ['r1', 1000],
  ] as const)
    mesh.population[mesh.addresses.indexOf(id)] = population
  for (const [scale, id, population] of [
    [0.1, 'r000', 400],
    [0.05, 'r00', 1000],
    [0.025, 'r0', 1000],
    [0.0125, 'r', 2000],
  ] as const) {
    const cells = visiblePopulationCells(world, window, scale)
    assert.equal(cells.find((cell) => cell.id === id)!.population, population)
    assert.equal(
      cells.reduce((sum, cell) => sum + cell.population, 0),
      2000,
    )
  }
})

test('zoom reveals finer density squares and exact picking remains independent', () => {
  const world = fixture(),
    leaves = visibleMapLeaves(world, window)
  const coarse = visiblePopulationCells(world, window, 0.1)
  const closer = visiblePopulationCells(world, window, 0.2)
  assert(closer[0].bounds.size < coarse[0].bounds.size)
  assert.equal(closer[0].population, coarse[0].population)
  assert.deepEqual(visiblePopulationCells(world, window, 2), leaves)
  assert.deepEqual(mapLeafAt(world, { x: 1, y: 1 }), leaves[0])
  // Exactly at the threshold, the next subdivision is large enough to draw.
  const threshold = MIN_POPULATION_SQUARE_PIXELS / 64
  assert.equal(visiblePopulationCells(world, window, threshold)[0].bounds.size, 64)
  assert.equal(visiblePopulationCells(world, window, threshold - 1e-6)[0].bounds.size, 128)
  // The minimum is measured in CSS pixels, after physical-to-map conversion.
  world.adaptive!.metersPerMapUnit = 80
  assert.deepEqual(visiblePopulationCells(world, window, 8), coarse)
})

test('population picking reports the displayed square total over an empty child', () => {
  const world = fixture(),
    point = { x: 100, y: 100 }
  assert.equal(mapLeafAt(world, point)!.population, 0)
  assert.deepEqual(mapPopulationCellAt(world, point, 0.1), visiblePopulationCells(world, window, 0.1)[0])
  assert.equal(mapPopulationCellAt(world, point, 0.1)!.population, 120)
  // At close zoom the now-visible empty child correctly reports zero again.
  assert.deepEqual(mapPopulationCellAt(world, point, 2), mapLeafAt(world, point))
})

test('population picking matches every rendered square across zoom levels and boundaries', () => {
  const world = fixture()
  for (const scale of [0.001, 0.1, MIN_POPULATION_SQUARE_PIXELS / 64, 0.2, 2])
    for (const cell of visiblePopulationCells(world, window, scale)) {
      const { x, y, size } = cell.bounds
      for (const point of [
        { x, y },
        { x: x + size / 2, y: y + size / 2 },
        { x: x + size - 1e-6, y: y + size - 1e-6 },
      ])
        assert.deepEqual(mapPopulationCellAt(world, point, scale), cell)
    }
  for (const point of [
    { x: -1, y: 0 },
    { x: CELL_METERS, y: 0 },
    { x: 0, y: CELL_METERS },
    { x: NaN, y: 0 },
    { x: 0, y: Infinity },
  ])
    assert.equal(mapPopulationCellAt(world, point, 0.1), undefined)
})

test('new population snapshots and adaptive revisions invalidate cached totals', () => {
  const world = fixture()
  assert.equal(visiblePopulationCells(world, window, 0.1)[0].population, 120)
  world.viewMesh = { ...world.viewMesh!, population: world.viewMesh!.population.slice() }
  world.viewMesh.population[0] = 240
  assert.equal(mapPopulationCellAt(world, { x: 100, y: 100 }, 0.1)!.population, 240)
  assert.equal(visiblePopulationCells(world, window, 0.1)[0].population, 240)
  world.viewMesh.population[0] = 360
  world.adaptive!.revision++
  assert.equal(mapPopulationCellAt(world, { x: 100, y: 100 }, 0.1)!.population, 360)
  assert.equal(visiblePopulationCells(world, window, 0.1)[0].population, 360)
})

test('population rendering handles empty projections and viewports smaller than the display floor', () => {
  const world = fixture(),
    root = visiblePopulationCells(world, window, 0.001)
  assert.equal(root.length, 1)
  assert.equal(root[0].id, 'r')
  assert.equal(root[0].population, 120)
  world.viewMesh = undefined
  assert.deepEqual(visiblePopulationCells(world, window, 0.1), [])
  assert.equal(mapPopulationCellAt(world, { x: 1, y: 1 }, 0.1), undefined)
})
