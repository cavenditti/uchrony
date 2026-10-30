/** Deposits are finite physical stocks, independent of map detail subscriptions. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ResourceLegend } from '../src/components/ResourceLegend'
import { drawAtlas, type AtlasCache } from '../src/map/renderer'
import {
  RESOURCE_KEYS,
  resourceAtPoint,
  resourceColor,
  resourceMapData,
  resourceQuantity,
  resourceRaster,
} from '../src/map/natural-resources'
import { ensureAdaptiveWorld } from '../src/sim/adaptive-world'
import { generateWorld } from '../src/sim/generate'
import { CELL_SIZE } from '../src/sim/grid'
import {
  cellResourcePotential,
  NATURAL_RESOURCES,
  openingResourceReserve,
  remainingResourceReserve,
} from '../src/sim/landscape'
import { METERS_PER_MAP_UNIT } from '../src/sim/physical-space'
import { viewSnapshot } from '../src/sim/view-snapshot'
import type { Cell, World } from '../src/sim/types'
import { canonicalHash } from './fixtures/world-hash'

function fixture() {
  const cells = Array.from({ length: 6 }, (_, id): Cell => ({
    id,
    q: id % 3,
    r: Math.floor(id / 3),
    x: ((id % 3) + 0.5) * CELL_SIZE,
    y: (Math.floor(id / 3) + 0.5) * CELL_SIZE,
    terrain: id === 5 ? 'water' : 'plains',
    region: 0,
    elevation: 0.2,
    moisture: 0.5,
    river: false,
    landscape: { habitat: 0.8, attraction: 0.5, resources: { iron: id / 2, coal: 0, stone: 1, timber: 0.8 } },
  }))
  return { cells, width: 3, height: 2, month: 0, regions: [], nations: [] } as unknown as World
}

test('all four resources share the reserve initializer and a read-only legacy fallback', () => {
  const w = generateWorld('natural-resource opening reserves', 3, 4)
  for (const good of NATURAL_RESOURCES)
    for (const c of w.cells)
      assert.equal(remainingResourceReserve(w, c.id, good), openingResourceReserve(c, good))
  ensureAdaptiveWorld(w)
  for (const good of NATURAL_RESOURCES)
    for (const c of w.cells.filter((c) => c.terrain !== 'water'))
      assert.equal(w.localEconomy!.reserves[c.id][good], openingResourceReserve(c, good))
  const bare = fixture(),
    before = JSON.stringify(bare)
  assert.equal(remainingResourceReserve(bare, 2, 'iron'), 150000)
  assert.equal(remainingResourceReserve(bare, 2, 'timber'), 4000)
  assert.equal(remainingResourceReserve(bare, 5, 'iron'), 0)
  for (const good of NATURAL_RESOURCES) resourceMapData(bare, good)
  assert.equal(JSON.stringify(bare), before)
})

test('depletion fades the same tile against a fixed opening scale and never restores an exhausted reserve', () => {
  const w = fixture(),
    opening = resourceMapData(w, 'iron')
  w.localEconomy = {
    reserves: {
      4: { iron: 3000, coal: 0, stone: 0, timber: 0 },
      2: { iron: 0, coal: 0, stone: 0, timber: 0 },
    },
  } as NonNullable<World['localEconomy']>
  const depleted = resourceMapData(w, 'iron')
  assert.equal(depleted.maximum, opening.maximum)
  assert.equal(depleted.quantities[4], 3000)
  assert.equal(depleted.quantities[2], 0)
  assert.equal(cellResourcePotential(w, 2, 'iron'), 0)
  assert.deepEqual(resourceColor(depleted, 0), [216, 213, 189])
  assert.deepEqual(resourceColor(depleted, depleted.maximum), RESOURCE_KEYS.iron.rgb)
  assert(resourceColor(depleted, 3000)[0] > resourceColor(depleted, opening.maximum)[0])
  assert.deepEqual(resourceColor(depleted, -1), resourceColor(depleted, 0))
  assert.deepEqual(resourceColor(depleted, Infinity), RESOURCE_KEYS.iron.rgb)
  const middle = resourceColor(depleted, depleted.midpoint)
  assert(Math.abs(middle[0] - (216 + 158) / 2) <= 1)
})

test('resource observation survives every dossier filter without changing economic state or randomness', () => {
  const w = generateWorld('resource subscription invariance', 3, 4)
  ensureAdaptiveWorld(w)
  const cell = w.cells.find((c) => c.terrain !== 'water')!
  w.localEconomy!.reserves[cell.id].iron = 123.456
  const before = canonicalHash(w)
  for (const selection of [undefined, null, 0]) {
    const observed = { ...viewSnapshot(w, selection), cells: w.cells }
    assert.equal(resourceMapData(observed, 'iron').quantities[cell.id], 123.456)
    for (const good of NATURAL_RESOURCES)
      assert.deepEqual(resourceMapData(observed, good), resourceMapData(w, good))
  }
  assert.equal(canonicalHash(w), before)
})

test('physical pointer picking agrees at tile edges in both map presentations', () => {
  const w = fixture(),
    data = resourceMapData(w, 'iron'),
    m = METERS_PER_MAP_UNIT
  assert.equal(resourceAtPoint(w, data, { x: CELL_SIZE * m, y: 0 })?.cell, 1)
  assert.equal(resourceAtPoint(w, data, { x: CELL_SIZE * m * 0.5, y: CELL_SIZE * m * 0.5 })?.cell, 0)
  for (const point of [
    { x: -1, y: 0 },
    { x: Infinity, y: 0 },
    { x: 3 * CELL_SIZE * m, y: 0 },
    { x: 2.5 * CELL_SIZE * m, y: 1.5 * CELL_SIZE * m },
  ])
    assert.equal(resourceAtPoint(w, data, point), undefined)
})

test('the persistent resource legend has four choices, honest units and a zero-deposit state', () => {
  const w = fixture()
  for (const good of NATURAL_RESOURCES) {
    const data = resourceMapData(w, good),
      html = renderToStaticMarkup(createElement(ResourceLegend, { data, onResource: () => {} }))
    for (const kind of NATURAL_RESOURCES) assert(html.includes(`value="${kind}"`))
    assert(html.includes('Remaining tonnes / terrain tile'))
    assert(html.includes(`value="${good}" selected=""`))
    assert(!html.includes('NaN'))
    if (!data.maximum) assert(html.includes('No deposits in this world'))
    else assert(html.includes(good === 'timber' ? 'can regrow' : 'Finite reserves'))
  }
  assert.equal(resourceQuantity(0), '0 t')
  assert.equal(resourceQuantity(0.2), '<1 t')
  w.localEconomy = {
    reserves: Object.fromEntries(w.cells.map((c) => [c.id, { iron: 0, coal: 0, stone: 0, timber: 0 }])),
  } as NonNullable<World['localEconomy']>
  const exhausted = resourceMapData(w, 'iron')
  assert(exhausted.maximum > 0)
  assert.equal(exhausted.available, false)
  assert(
    renderToStaticMarkup(createElement(ResourceLegend, { data: exhausted, onResource: () => {} })).includes(
      'No remaining reserves.',
    ),
  )
})

test('flat and relief draw the same compact raster, preserve zero deposits and reuse camera redraws', (t) => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'document'),
    w = fixture(),
    data = resourceMapData(w, 'iron')
  let allocations = 0,
    pixels: Uint8ClampedArray | undefined
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: (image: { data: Uint8ClampedArray }) => {
        pixels = image.data
      },
    }),
  }
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: () => {
        allocations++
        return canvas
      },
    },
  })
  t.after(() => {
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else Reflect.deleteProperty(globalThis, 'document')
  })
  const raster = resourceRaster(w, data)
  assert.equal(raster.width, w.width)
  assert.equal(raster.height, w.height)
  assert.deepEqual(Array.from(pixels!.slice(0, 4)), [216, 213, 189, 255])
  assert.equal(pixels![5 * 4 + 3], 0, 'water is transparent')
  const draws: unknown[] = [],
    ctx = {
      imageSmoothingEnabled: true,
      save() {},
      restore() {},
      clip() {},
      drawImage(image: unknown) {
        draws.push(image)
      },
    } as unknown as CanvasRenderingContext2D
  const cache = {
    ocean: {},
    terrain: {},
    relief: {},
    land: {},
    rivers: [],
    worldWidth: 48,
    worldHeight: 32,
  } as unknown as AtlasCache
  for (const relief of [false, true]) drawAtlas(ctx, cache, w, 'resources', 1, relief, false, false, data)
  assert.equal(draws.filter((image) => image === raster).length, 2)
  assert.equal(ctx.imageSmoothingEnabled, true)
  assert.equal(allocations, 1, 'camera draws share the one-pixel-per-tile raster')
  assert.equal(pixels!.byteLength, w.cells.length * 4)
})
