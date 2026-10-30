/** Quantitative resource cartography. One sample is one physical terrain tile;
 * district boundaries and productive facilities never create natural endowments. */
import { cellAt } from '../sim/grid'
import { NATURAL_RESOURCES, openingResourceReserve, remainingResourceReserve } from '../sim/landscape'
import { EXTENDED_MINERALS, fishCapacity, openingMineralStock } from '../sim/resource-extraction'
import { METERS_PER_MAP_UNIT } from '../sim/physical-space'
import { clamp, GOOD_LABELS, type World } from '../sim/types'

/** Map choices include every physical natural stock. Manufactured goods and
 * farm output are inventories rather than unextracted terrain endowments. */
export const MAPPED_RESOURCES = [...NATURAL_RESOURCES, ...EXTENDED_MINERALS, 'fish'] as const
export type MappedResource = (typeof MAPPED_RESOURCES)[number]

export const RESOURCE_KEYS = {
  iron: { name: 'Iron ore', color: '#9e4e38', rgb: [158, 78, 56] },
  coal: { name: 'Coal', color: '#394d6b', rgb: [57, 77, 107] },
  stone: { name: 'Stone', color: '#897350', rgb: [137, 115, 80] },
  timber: { name: 'Timber', color: '#2c7759', rgb: [44, 119, 89] },
  clay: { name: GOOD_LABELS.clay, color: '#aa6740', rgb: [170, 103, 64] },
  salt: { name: GOOD_LABELS.salt, color: '#8987a8', rgb: [137, 135, 168] },
  preciousOre: { name: GOOD_LABELS.preciousOre, color: '#b79225', rgb: [183, 146, 37] },
  fish: { name: 'Coastal fish', color: '#57b8b8', rgb: [87, 184, 184] },
} as const satisfies Record<MappedResource, { name: string; color: string; rgb: readonly number[] }>
export const RESOURCE_ZERO_COLOR = '#d8d5bd'
export const RESOURCE_WATER_ZERO_COLOR = '#304e54'
const ZERO_RGB = [216, 213, 189] as const
const WATER_ZERO_RGB = [48, 78, 84] as const

export interface ResourceMapData {
  good: MappedResource
  quantities: Float64Array
  maximum: number
  midpoint: number
  logMaximum: number
  available: boolean
}

/** Read existing cell reservoirs without initializing stocks or renewing fish.
 * Absence of the whole reservoir means untouched geography; a missing/depleted
 * entry in an initialized reservoir must never refill itself during inspection. */
function resourceStock(
  w: World,
  cell: number,
  good: MappedResource,
  source: 'opening' | 'remaining',
): number {
  switch (good) {
    case 'clay':
    case 'salt':
    case 'preciousOre':
      return source === 'opening' || !w.resourceStocks
        ? openingMineralStock(w, cell, good)
        : (w.resourceStocks.minerals[cell]?.[good] ?? 0)
    case 'fish':
      return source === 'opening' || !w.resourceStocks
        ? fishCapacity(w, cell)
        : (w.resourceStocks.fish[cell] ?? 0)
    default:
      return source === 'opening'
        ? openingResourceReserve(w.cells[cell], good)
        : remainingResourceReserve(w, cell, good)
  }
}

/** Water stocks stay on water cells, including zero-stock offshore tiles. */
function resourceSurface(w: World, cell: number, good: MappedResource) {
  return (w.cells[cell].terrain === 'water') === (good === 'fish')
}

/** O(terrain samples), once per displayed snapshot/selection. The opening-world
 * maximum anchors the legend through depletion; log scaling keeps small deposits visible. */
export function resourceMapData(w: World, good: MappedResource): ResourceMapData {
  const quantities = new Float64Array(w.cells.length)
  let maximum = 0,
    available = false
  for (const c of w.cells) {
    if (!resourceSurface(w, c.id, good)) continue
    quantities[c.id] = resourceStock(w, c.id, good, 'remaining')
    available ||= quantities[c.id] > 0
    maximum = Math.max(maximum, resourceStock(w, c.id, good, 'opening'), quantities[c.id])
  }
  return {
    good,
    quantities,
    maximum,
    midpoint: Math.sqrt(1 + maximum) - 1,
    logMaximum: Math.log1p(maximum),
    available,
  }
}

/** Palette and legend use the same logarithmic interpolation; zero is neutral land. */
export function resourceColor(data: ResourceMapData, quantity: number): readonly number[] {
  const t = data.logMaximum ? clamp(Math.log1p(Math.max(0, quantity)) / data.logMaximum) : 0
  const zero = data.good === 'fish' ? WATER_ZERO_RGB : ZERO_RGB
  return RESOURCE_KEYS[data.good].rgb.map((end, i) => Math.round(zero[i] + (end - zero[i]) * t))
}

/** Physical pointer coordinates work in both the flat atlas and ray-picked relief. */
export function resourceAtPoint(w: World, data: ResourceMapData, point: { x: number; y: number }) {
  const meters = w.adaptive?.metersPerMapUnit ?? METERS_PER_MAP_UNIT
  const cell = cellAt(point.x / meters, point.y / meters, w.width, w.height)
  return cell === undefined || !resourceSurface(w, cell, data.good)
    ? undefined
    : { cell, quantity: data.quantities[cell] }
}

/** Explicit tonne units distinguish deposits from monthly output and merchant stock. */
export function resourceQuantity(quantity: number) {
  return `${quantity > 0 && quantity < 1 ? '<1' : Math.round(quantity).toLocaleString()} t`
}

const rasters = new WeakMap<ResourceMapData, HTMLCanvasElement>()
/** A pixel per sample keeps camera redraws O(1). No full-world high-resolution
 * texture or per-cell Path2D is retained; superseded snapshot rasters can be collected. */
export function resourceRaster(w: World, data: ResourceMapData) {
  let canvas = rasters.get(data)
  if (canvas) return canvas
  canvas = document.createElement('canvas')
  canvas.width = w.width
  canvas.height = w.height
  const ctx = canvas.getContext('2d')!,
    image = ctx.createImageData(w.width, w.height),
    palette = new Uint8ClampedArray(256 * 3)
  // Quantize only colour, never reserve values or the tooltip. A tiny lookup
  // avoids allocating one RGB array for every terrain sample in a new snapshot.
  for (let step = 0; step < 256; step++) {
    const color = resourceColor(data, Math.expm1((data.logMaximum * step) / 255))
    for (let i = 0; i < 3; i++) palette[step * 3 + i] = color[i]
  }
  for (const c of w.cells) {
    if (!resourceSurface(w, c.id, data.good)) continue
    const offset = c.id * 4,
      shade = data.logMaximum
        ? Math.round(clamp(Math.log1p(data.quantities[c.id]) / data.logMaximum) * 255)
        : 0
    for (let i = 0; i < 3; i++) image.data[offset + i] = palette[shade * 3 + i]
    image.data[offset + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  rasters.set(data, canvas)
  return canvas
}

const oceans = new WeakMap<ResourceMapData, HTMLCanvasElement>()
/** The flat atlas and the relief's separate sea mesh share the same fish raster.
 * Compose once per snapshot, retaining nearest-tile sampling through camera redraws. */
export function resourceOceanRaster(w: World, data: ResourceMapData, ocean: HTMLCanvasElement) {
  if (data.good !== 'fish') return ocean
  let canvas = oceans.get(data)
  if (canvas) return canvas
  canvas = document.createElement('canvas')
  canvas.width = ocean.width
  canvas.height = ocean.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(ocean, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(resourceRaster(w, data), 0, 0, canvas.width, canvas.height)
  oceans.set(data, canvas)
  return canvas
}
