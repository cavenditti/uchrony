import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CELL_SIZE,
  CELL_METERS,
  edgeNeighbors,
  neighbors,
  movementNeighbors,
  cellAt,
  stepDistance,
} from '../src/sim/grid'
import { cellPolygon, polygonArea, rootBounds } from '../src/sim/physical-space'
import { buildGeometry, contains } from '../src/map/geometry'
import { waterPath } from '../src/sim/navy'
import { roadCost, corridorGeography } from '../src/sim/corridors'
import type { Cell, World } from '../src/sim/types'

const fixture = (rows: string[]) => {
  const width = rows[0].length,
    height = rows.length
  const cells = rows.flatMap((row, r) =>
    [...row].map((value, q): Cell => ({
      id: r * width + q,
      q,
      r,
      x: (q + 0.5) * CELL_SIZE,
      y: (r + 0.5) * CELL_SIZE,
      elevation: value === '.' ? 0 : 0.2,
      moisture: 0.5,
      river: false,
      terrain: value === '.' ? 'water' : 'plains',
      region: value === '.' ? -1 : 0,
    })),
  )
  return { width, height, cells } as World
}

test('physical squares, rendered boundaries and picking agree exactly without row offsets', () => {
  const w = fixture(['XX', 'XX'])
  const geometry = buildGeometry(w.cells, 2, 2, 1)
  for (const c of w.cells) {
    assert.equal(polygonArea(cellPolygon(w, c.id)), CELL_METERS ** 2)
    assert.equal(cellAt(c.x, c.y, w.width, w.height), c.id)
    assert(contains(geometry.coast, c.x, c.y))
    assert(contains(geometry.provinces[0], c.x, c.y))
  }
  assert.deepEqual(rootBounds(w), { x: 0, y: 0, size: 2 * CELL_METERS })
  assert.deepEqual(geometry.bounds[0], { minX: 0, maxX: 2 * CELL_SIZE, minY: 0, maxY: 2 * CELL_SIZE })
  assert.equal(cellAt(-0.001, CELL_SIZE, 2, 2), undefined)
  assert.equal(cellAt(2 * CELL_SIZE, CELL_SIZE, 2, 2), undefined)
  assert.equal(cellAt(CELL_SIZE, CELL_SIZE, 2, 2), 3)
  assert.deepEqual(edgeNeighbors(0, 2, 2), [-1, 1, 2, -1])
  assert.deepEqual(neighbors(1, 2, 2), [3, 0])
})

test('diagonally touching land produces two closed coast rings without losing a boundary', () => {
  const w = fixture(['X.', '.X'])
  const geometry = buildGeometry(w.cells, 2, 2, 1)
  assert.equal(geometry.coast.length, 2)
  assert.equal(geometry.provinces[0].length, 2)
  assert.equal(geometry.shores.length, 8)
  assert.equal(
    geometry.coast.reduce((sum, ring) => sum + polygonArea(ring), 0),
    2 * CELL_SIZE ** 2,
  )
  for (const c of w.cells) assert.equal(contains(geometry.coast, c.x, c.y), c.terrain !== 'water')
})

test('diagonal roads cost their physical length and cannot cut across water corners', () => {
  const w = fixture(['XX', 'XX'])
  assert(movementNeighbors(w.cells, 0, 2, 2).includes(3))
  assert.equal(stepDistance(w.cells[0], w.cells[3]), Math.SQRT2)
  assert.equal(roadCost(w.cells[0], w.cells[3]), roadCost(w.cells[0], w.cells[1]) * Math.SQRT2)
  const geo = corridorGeography(w)
  assert(geo.index(0, 3) >= 0)
  assert.notEqual(geo.index(0, 3), geo.index(0, 1))
  const islands = fixture(['X.', '.X'])
  assert(!movementNeighbors(islands.cells, 0, 2, 2).includes(3))
  assert.equal(corridorGeography(islands).index(0, 3), -1)
})

test('ships take distance-aware diagonal routes but cannot sail between touching land corners', () => {
  const sea = fixture(['...', '...', '...'])
  assert.deepEqual(waterPath(sea, 0, 8), [0, 4, 8])
  const strait = fixture(['.X', 'X.'])
  assert.deepEqual(waterPath(strait, 0, 3), [])
})
