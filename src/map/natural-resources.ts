/** Quantitative resource cartography. One sample is one physical terrain tile;
 * district boundaries and productive facilities never create natural endowments. */
import { cellAt } from '../sim/grid'
import { openingResourceReserve, remainingResourceReserve, type NaturalResource } from '../sim/landscape'
import { METERS_PER_MAP_UNIT } from '../sim/physical-space'
import { clamp, type World } from '../sim/types'

export const RESOURCE_KEYS = {
  iron: { name: 'Iron ore', color: '#9e4e38', rgb: [158, 78, 56] },
  coal: { name: 'Coal', color: '#394d6b', rgb: [57, 77, 107] },
  stone: { name: 'Stone', color: '#897350', rgb: [137, 115, 80] },
  timber: { name: 'Timber', color: '#2c7759', rgb: [44, 119, 89] },
} as const satisfies Record<NaturalResource, { name: string; color: string; rgb: readonly number[] }>
export const RESOURCE_ZERO_COLOR = '#d8d5bd'
const ZERO_RGB = [216, 213, 189] as const

export interface ResourceMapData {
  good: NaturalResource
  quantities: Float64Array
  maximum: number
  midpoint: number
  logMaximum: number
  available: boolean
}

/** O(terrain samples), once per displayed snapshot/selection. The opening-world
 * maximum anchors the legend through depletion; log scaling keeps small deposits visible. */
export function resourceMapData(w: World, good: NaturalResource): ResourceMapData {
  const quantities = new Float64Array(w.cells.length)
  let maximum = 0,
    available = false
  for (const c of w.cells) {
    if (c.terrain === 'water') continue
    quantities[c.id] = remainingResourceReserve(w, c.id, good)
    available ||= quantities[c.id] > 0
    maximum = Math.max(maximum, openingResourceReserve(c, good), quantities[c.id])
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
  return RESOURCE_KEYS[data.good].rgb.map((end, i) => Math.round(ZERO_RGB[i] + (end - ZERO_RGB[i]) * t))
}

/** Physical pointer coordinates work in both the flat atlas and ray-picked relief. */
export function resourceAtPoint(w: World, data: ResourceMapData, point: { x: number; y: number }) {
  const meters = w.adaptive?.metersPerMapUnit ?? METERS_PER_MAP_UNIT
  const cell = cellAt(point.x / meters, point.y / meters, w.width, w.height)
  return cell === undefined || w.cells[cell].terrain === 'water'
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
    if (c.terrain === 'water') continue
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
