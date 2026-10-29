import test from 'node:test'
import assert from 'node:assert/strict'
import { RenderQuadtree, type RenderEntry } from '../src/map/spatial-index'
import {
  visibleRenderCells,
  visibleMapLeaves,
  visibleUrbanPlots,
  mapLeafAt,
  mapBuildingAt,
  mapUrbanBlockAt,
  MIN_RENDER_SQUARE_PIXELS,
  MIN_URBAN_PLOT_PIXELS,
} from '../src/map/quadtree'
import { drawQuadtree } from '../src/map/quadtree-renderer'
import { CELL_METERS } from '../src/sim/grid'
import { METERS_PER_MAP_UNIT, rootBounds, nodeBounds } from '../src/sim/physical-space'
import type { World } from '../src/sim/types'
import { urbanBlockId } from '../src/sim/urban-blocks'

function fixture(depth = 4) {
  const width = 2 ** depth,
    count = width ** 2
  const world = {
    width,
    height: width,
    viewOnly: true,
    adaptive: { revision: 0, metersPerMapUnit: METERS_PER_MAP_UNIT, lanes: [] },
    month: 0,
    regions: [],
    routes: [],
    corridors: [],
    viewHomes: [],
    viewUrbanBlocks: [],
    viewMesh: {
      addresses: Array.from({ length: count }, (_, i) => 'r' + i.toString(4).padStart(depth, '0')),
      population: new Float64Array(count).fill(10),
      jobs: new Float64Array(count).fill(3),
      landArea: new Float64Array(count).fill(CELL_METERS ** 2),
    },
  } as unknown as World
  const window = { x: 0, y: 0, width: width * CELL_METERS, height: width * CELL_METERS }
  return { world, window }
}

function home(id: string, size: number, x = 0, y = 0) {
  return {
    id,
    cell: 0,
    pool: 0,
    capacity: 100,
    residents: 50,
    developed: true,
    parcel: { x, y, size },
    building: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  }
}

test('atlas LoD conserves totals and zoom reveals the original simulation leaves', () => {
  const { world, window } = fixture(),
    before = structuredClone(world)
  world.viewMesh!.landArea[0] = 0
  before.viewMesh!.landArea[0] = 0
  const fine = visibleMapLeaves(world, window)
  for (const scale of [0.01, 0.1, 0.5, 1, 4]) {
    const shown = visibleRenderCells(world, window, scale)
    for (const key of ['population', 'jobs', 'landArea'] as const)
      assert.equal(
        shown.reduce((n, c) => n + c[key], 0),
        fine.reduce((n, c) => n + c[key], 0),
      )
    for (const cell of shown) {
      assert.deepEqual(cell.bounds, nodeBounds(rootBounds(world), cell.id))
      assert(cell.id === 'r' || (cell.bounds.size / METERS_PER_MAP_UNIT) * scale >= MIN_RENDER_SQUARE_PIXELS)
    }
  }
  assert.deepEqual(visibleRenderCells(world, window, 1), fine, 'exact threshold reveals children')
  assert(visibleRenderCells(world, window, 1 - 1e-8).length < fine.length)
  assert.deepEqual(mapLeafAt(world, { x: 1, y: 1 }), fine[0], 'inspection stays exact')
  assert.deepEqual(world, before)
})

test('pan keeps ancestor totals stable and rejects empty/outside rectangular viewports', () => {
  const { world, window } = fixture()
  const cell = visibleRenderCells(world, window, 0.2)[0]
  const clipped = { x: cell.bounds.size - 2, y: 1, width: 1, height: 1 }
  assert.deepEqual(visibleRenderCells(world, clipped, 0.2), [cell])
  for (const area of [
    { ...window, width: 0 },
    { ...window, height: -1 },
    { ...window, x: window.width },
    { ...window, x: -window.width },
  ])
    assert.deepEqual(visibleRenderCells(world, area, 0.001), [])
  world.height /= 2
  assert.deepEqual(visibleRenderCells(world, { ...window, y: window.height / 2 }, 0.001), [])
  assert.equal(visibleRenderCells(world, window, 0).length, 1)
})

test('render totals and independent plot/block caches follow snapshot replacement and revision', () => {
  const { world, window } = fixture()
  const total = () => visibleRenderCells(world, window, 0.01)[0].population
  const initial = total()
  world.viewMesh = { ...world.viewMesh!, population: world.viewMesh!.population.slice() }
  world.viewMesh.population[0] += 20
  assert.equal(total(), initial + 20)
  world.viewMesh.population[0] += 30
  world.adaptive!.revision++
  assert.equal(total(), initial + 50)
  world.viewHomes = [home('a', 64)]
  assert.equal(visibleUrbanPlots(world, window)[0].id, 'a')
  world.viewHomes = [home('b', 64)]
  assert.equal(mapBuildingAt(world, { x: 1, y: 1 })?.id, 'b')
  world.viewHomes[0].developed = false
  world.adaptive!.revision++
  assert.equal(visibleUrbanPlots(world, window).length, 0)
  assert.equal(mapUrbanBlockAt(world, { x: 1, y: 1 }), undefined)
  const block = { id: urbanBlockId({ x: 1, y: 1 }) } as NonNullable<World['viewUrbanBlocks']>[number]
  world.viewUrbanBlocks = [block]
  // Querying a block must use the replacement array even with the same revision.
  assert.equal(mapUrbanBlockAt(world, { x: 1, y: 1 }), block)
})

test('plot LoD retains vacancies and construction at the exact pixel threshold', () => {
  const { world, window } = fixture()
  world.viewHomes = [
    home('small', 8),
    home('large', 64, 100),
    { ...home('vacant', 64, 200), residents: 0 },
    { ...home('works', 64, 300), developed: false, construction: 20 },
    { ...home('undeveloped', 64, 400), developed: false },
  ]
  const threshold = (MIN_URBAN_PLOT_PIXELS * METERS_PER_MAP_UNIT) / 8
  assert.equal(visibleUrbanPlots(world, window, threshold).length, 4)
  assert.deepEqual(
    new Set(visibleUrbanPlots(world, window, threshold - 1e-8).map((p) => p.id)),
    new Set(['large', 'vacant', 'works']),
  )
  assert.equal(visibleUrbanPlots(world, window).length, 4)
  assert.equal(mapBuildingAt(world, { x: 1, y: 1 })?.id, 'small', 'subpixel homes still exist for picking')
})

test('render index keeps crossing footprints, edge-aligned lines and coincident objects without duplicates', () => {
  const entries: RenderEntry<number>[] = Array.from({ length: 100 }, (_, i) => ({
    value: i,
    span: 1,
    bounds: { x: i * 10, y: i * 5, width: 1, height: 1 },
  }))
  entries.push({ value: 100, span: 1000, bounds: { x: 0, y: 250, width: 1000, height: 0 } })
  entries.push({ value: 101, span: 1000, bounds: { x: 500, y: -50, width: 0, height: 1000 } })
  const tree = new RenderQuadtree(entries)
  for (const window of [
    { x: 1, y: 249, width: 2, height: 2 },
    { x: 499, y: 249, width: 2, height: 2 },
  ]) {
    const expected = entries
      .filter(
        ({ bounds: b }) =>
          b.x <= window.x + window.width &&
          b.x + b.width >= window.x &&
          b.y <= window.y + window.height &&
          b.y + b.height >= window.y,
      )
      .map((e) => e.value)
    const actual = tree.query(window)
    assert.deepEqual(new Set(actual), new Set(expected))
    assert.equal(actual.length, new Set(actual).size)
  }
  const repeated = new RenderQuadtree(
    Array.from({ length: 100 }, (_, i) => ({
      value: i,
      span: 1,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
    })),
  )
  assert.equal(repeated.query({ x: 0, y: 0, width: 1, height: 1 }).length, 100)
  assert.deepEqual(new RenderQuadtree([]).query({ x: 0, y: 0, width: 1, height: 1 }), [])
})

test('whole subpixel branches are pruned without reading individual entries', () => {
  const entries = Array.from({ length: 65536 }, (_, i): RenderEntry<number> => ({
    value: i,
    span: 1,
    bounds: { x: i % 256, y: Math.floor(i / 256), width: 1, height: 1 },
  }))
  const tree = new RenderQuadtree(entries)
  for (const entry of entries)
    Object.defineProperty(entry, 'span', {
      get() {
        throw new Error('Visited a subpixel entry')
      },
    })
  assert.deepEqual(tree.query({ x: 0, y: 0, width: 256, height: 256 }, 2), [])
})

test('huge atlas drawing visits a screen-bounded set of ancestors, not every fine leaf', () => {
  const { world, window } = fixture(9),
    scale = 1024 / (world.width * 12)
  const start = performance.now()
  const shown = visibleRenderCells(world, window, scale)
  assert.equal(shown.length, 4096)
  const coldMs = performance.now() - start
  let rectangles = 0
  const ctx = new Proxy(
    {},
    { get: (_, name) => (name === 'rect' ? () => rectangles++ : () => {}), set: () => true },
  )
  // No paths are needed: this fixture has no roads or developed plots.
  const original = globalThis.Path2D
  globalThis.Path2D = class {} as typeof Path2D
  try {
    drawQuadtree(ctx as CanvasRenderingContext2D, world, 'terrain', scale, window, new Path2D())
  } finally {
    globalThis.Path2D = original
  }
  assert.equal(rectangles, shown.length + 1, 'one domain clip plus one rectangle per display cell')
  const t = performance.now()
  for (let i = 0; i < 10; i++) visibleRenderCells(world, window, scale)
  console.log(
    JSON.stringify({
      renderLeaves: world.viewMesh!.addresses.length,
      displayCells: shown.length,
      coldMs,
      warmMeanMs: (performance.now() - t) / 10,
    }),
  )
})

test('grid queries do not eagerly read unrelated housing or urban block snapshots', () => {
  const { world, window } = fixture()
  Object.defineProperty(world, 'viewHomes', {
    get() {
      throw new Error('Read all homes for a grid query')
    },
  })
  Object.defineProperty(world, 'viewUrbanBlocks', {
    get() {
      throw new Error('Built block inspection for drawing')
    },
  })
  assert(visibleRenderCells(world, window, 0.1).length > 0)
  assert(mapLeafAt(world, { x: 1, y: 1 }))
})
