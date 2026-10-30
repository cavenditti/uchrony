/** Deposits are finite physical stocks, independent of map detail subscriptions. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ResourceLegend, ResourceTileDetails } from '../src/components/ResourceLegend'
import { drawAtlas, type AtlasCache } from '../src/map/renderer'
import {
  RESOURCE_KEYS,
  MAPPED_RESOURCES,
  resourceAtPoint,
  resourceColor,
  resourceMapData,
  resourceQuantity,
  resourceRaster,
  resourceOceanRaster,
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
import {
  EXTENDED_MINERALS,
  ensureResourceStocks,
  fishCapacity,
  openingMineralStock,
} from '../src/sim/resource-extraction'
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
  return {
    seed: 'resource-map-fixture',
    cells,
    width: 3,
    height: 2,
    month: 0,
    regions: [],
    nations: [],
  } as unknown as World
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
  const stocks = ensureResourceStocks(w)
  for (const good of EXTENDED_MINERALS) {
    const cell = w.cells.find((c) => openingMineralStock(w, c.id, good) > 0)!
    stocks.minerals[cell.id][good] = 0.123
  }
  const water = w.cells.find((c) => fishCapacity(w, c.id) > 0)!
  stocks.fish[water.id] = 12.345
  const before = canonicalHash(w)
  for (const selection of [undefined, null, 0]) {
    const observed = { ...viewSnapshot(w, selection), cells: w.cells }
    assert.equal(resourceMapData(observed, 'iron').quantities[cell.id], 123.456)
    for (const good of MAPPED_RESOURCES)
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

test('the persistent resource legend offers every natural stock with honest units and renewal guidance', () => {
  const w = fixture()
  assert.deepEqual(
    [...MAPPED_RESOURCES],
    ['iron', 'coal', 'stone', 'timber', 'clay', 'salt', 'preciousOre', 'fish'],
  )
  for (const good of MAPPED_RESOURCES) {
    const data = resourceMapData(w, good),
      html = renderToStaticMarkup(createElement(ResourceLegend, { data, onResource: () => {} }))
    for (const kind of MAPPED_RESOURCES) assert(html.includes(`value="${kind}"`))
    assert.equal((html.match(/<option /g) ?? []).length, MAPPED_RESOURCES.length)
    assert(
      html.includes(good === 'fish' ? 'Fish biomass (t) / water tile' : 'Remaining tonnes / terrain tile'),
    )
    assert(html.includes(`value="${good}" selected=""`))
    assert(!html.includes('NaN'))
    if (!data.maximum)
      assert(html.includes(good === 'fish' ? 'No coastal fish stocks' : 'No deposits in this world'))
    else
      assert(
        html.includes(
          good === 'timber' ? 'can regrow' : good === 'fish' ? 'stocks can recover' : 'Finite reserves',
        ),
      )
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

test('extended mineral maps read finite reservoirs, preserve opening scales and never reseed missing entries', () => {
  const w = generateWorld('extended resource map reserves', 3, 4),
    before = canonicalHash(w)
  for (const good of EXTENDED_MINERALS) {
    const data = resourceMapData(w, good)
    assert(data.maximum > 0)
    for (const c of w.cells) assert.equal(data.quantities[c.id], openingMineralStock(w, c.id, good))
  }
  assert.equal(w.resourceStocks, undefined)
  assert.equal(canonicalHash(w), before, 'opening views must not initialize economic stocks')
  const stocks = ensureResourceStocks(w)
  for (const good of EXTENDED_MINERALS) {
    const opening = resourceMapData(w, good),
      cell = w.cells.find((c) => opening.quantities[c.id] > 0)!
    stocks.minerals[cell.id][good] = 1.234
    assert.equal(resourceMapData(w, good).quantities[cell.id], 1.234)
    for (const stock of Object.values(stocks.minerals)) stock[good] = 0
    const depleted = resourceMapData(w, good)
    assert.equal(depleted.maximum, opening.maximum)
    assert.equal(depleted.available, false)
    assert.deepEqual(resourceColor(depleted, 0), [216, 213, 189])
    delete stocks.minerals[cell.id]
    assert.equal(resourceMapData(w, good).quantities[cell.id], 0)
  }
})

test('coastal fish display shared water biomass without renewing it or assigning it to land', () => {
  const w = fixture(),
    opening = resourceMapData(w, 'fish'),
    meters = METERS_PER_MAP_UNIT,
    point = { x: 2.5 * CELL_SIZE * meters, y: 1.5 * CELL_SIZE * meters }
  assert.equal(opening.quantities[5], fishCapacity(w, 5))
  assert(opening.quantities[5] > 0)
  assert(opening.quantities.slice(0, 5).every((quantity) => quantity === 0))
  assert.equal(w.resourceStocks, undefined)
  const stocks = ensureResourceStocks(w)
  stocks.fish[5] = 12.345
  w.month++
  const before = JSON.stringify(w),
    data = resourceMapData(w, 'fish')
  assert.equal(data.maximum, opening.maximum)
  assert.deepEqual(resourceAtPoint(w, data, point), { cell: 5, quantity: 12.345 })
  assert.equal(resourceAtPoint(w, data, { x: 0, y: 0 }), undefined)
  assert.equal(resourceAtPoint(w, resourceMapData(w, 'clay'), point), undefined)
  const readout = renderToStaticMarkup(
    createElement(ResourceTileDetails, { data, tile: resourceAtPoint(w, data, point)! }),
  )
  assert(readout.includes('Water tile 5'))
  assert(readout.includes('Shared coastal biomass'))
  assert(!readout.includes('Unextracted reserve'))
  assert.equal(JSON.stringify(w), before)
  stocks.fish[5] = 0
  const depleted = resourceMapData(w, 'fish')
  assert.equal(depleted.available, false)
  assert.equal(depleted.maximum, opening.maximum)
  assert(
    renderToStaticMarkup(createElement(ResourceLegend, { data: depleted, onResource: () => {} })).includes(
      'No remaining fish stocks.',
    ),
  )
  w.cells[5].terrain = 'plains'
  const landOnly = { ...w, cells: [...w.cells] }
  assert(
    renderToStaticMarkup(
      createElement(ResourceLegend, { data: resourceMapData(landOnly, 'fish'), onResource: () => {} }),
    ).includes('No coastal fish stocks in this world.'),
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

test('every resource raster respects its physical surface and fish is visible before land clipping', (t) => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'document'),
    w = fixture(),
    canvases: {
      width: number
      height: number
      pixels?: Uint8ClampedArray
      draws: unknown[]
      getContext: () => unknown
    }[] = []
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: () => {
        const canvas = {
          width: 0,
          height: 0,
          pixels: undefined as Uint8ClampedArray | undefined,
          draws: [] as unknown[],
          getContext: () => ({
            imageSmoothingEnabled: true,
            createImageData: (width: number, height: number) => ({
              data: new Uint8ClampedArray(width * height * 4),
            }),
            putImageData: (image: { data: Uint8ClampedArray }) => {
              canvas.pixels = image.data
            },
            drawImage: (image: unknown) => {
              canvas.draws.push(image)
            },
          }),
        }
        canvases.push(canvas)
        return canvas
      },
    },
  })
  t.after(() => {
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else Reflect.deleteProperty(globalThis, 'document')
  })
  for (const good of MAPPED_RESOURCES) {
    const data = resourceMapData(w, good),
      raster = resourceRaster(w, data),
      pixels = canvases.at(-1)!.pixels!
    for (const cell of w.cells) {
      const present = (cell.terrain === 'water') === (good === 'fish')
      assert.equal(pixels[cell.id * 4 + 3], present ? 255 : 0, `${good} tile ${cell.id}`)
      if (present) {
        const color = resourceColor(data, data.quantities[cell.id])
        for (let channel = 0; channel < 3; channel++)
          assert(Math.abs(pixels[cell.id * 4 + channel] - color[channel]) <= 1)
      }
    }
    assert.equal(resourceRaster(w, data), raster)
  }
  const data = resourceMapData(w, 'fish'),
    ocean = { width: 48, height: 32 } as HTMLCanvasElement,
    painted = resourceOceanRaster(w, data, ocean),
    composite = canvases.at(-2)!,
    raster = canvases.at(-1)!,
    allocations = canvases.length
  assert.equal(painted, composite)
  assert.deepEqual(composite.draws, [ocean, raster])
  assert.equal(resourceOceanRaster(w, data, ocean), painted)
  assert.equal(resourceOceanRaster(w, resourceMapData(w, 'clay'), ocean), ocean)
  const calls: { image: unknown; clipped: boolean }[] = []
  let clipped = false
  const ctx = {
    save() {},
    restore() {
      clipped = false
    },
    clip() {
      clipped = true
    },
    drawImage(image: unknown) {
      calls.push({ image, clipped })
    },
  } as unknown as CanvasRenderingContext2D
  const cache = {
    ocean,
    terrain: {},
    relief: {},
    land: {},
    rivers: [],
    worldWidth: 48,
    worldHeight: 32,
  } as unknown as AtlasCache
  for (const relief of [false, true]) drawAtlas(ctx, cache, w, 'resources', 1, relief, false, false, data)
  assert.equal(calls.filter((call) => call.image === painted && !call.clipped).length, 2)
  assert.equal(
    calls.filter((call) => call.image === raster).length,
    0,
    'fish cannot be hidden behind the land clip',
  )
  assert.equal(canvases.length, allocations, 'flat and relief reuse the same ocean composition')
})
