import { CELL_SIZE } from '../sim/grid'
import { clamp, type World } from '../sim/types'

export type Geography = Pick<World, 'cells' | 'width' | 'height'>
const STRIDE = 8
export interface LandscapeField {
  width: number
  height: number
  spanX: number
  spanY: number
  data: Float32Array
}
const fields = new WeakMap<World['cells'], LandscapeField>()

/** A bounded render lattice reconstructed from actual sample positions, independent of numerical leaf edges.
 * The simulation's administrative quadtree can split/merge without changing this field.
 */
export function landscapeField(world: Geography): LandscapeField {
  const cached = fields.get(world.cells)
  if (cached) return cached
  const spanX = world.width * CELL_SIZE,
    spanY = world.height * CELL_SIZE
  const width = Math.min(768, world.width * 2),
    height = Math.min(496, world.height * 2)
  const support = Math.sqrt((spanX * spanY) / Math.max(1, world.cells.length)) * 2.15
  const columns = Math.ceil(spanX / support) + 2,
    rows = Math.ceil(spanY / support) + 2
  const heads = new Int32Array(columns * rows).fill(-1),
    next = new Int32Array(world.cells.length).fill(-1)
  world.cells.forEach((c, i) => {
    const bin = Math.floor(c.y / support) * columns + Math.floor(c.x / support)
    next[i] = heads[bin]
    heads[bin] = i
  })
  const data = new Float32Array(width * height * STRIDE)
  for (let row = 0; row < height; row++) {
    const y = (row / (height - 1)) * spanY,
      by = Math.floor(y / support)
    for (let col = 0; col < width; col++) {
      const x = (col / (width - 1)) * spanX,
        bx = Math.floor(x / support),
        at = (row * width + col) * STRIDE
      let total = 0
      for (let iy = Math.max(0, by - 1); iy <= Math.min(rows - 1, by + 1); iy++)
        for (let ix = Math.max(0, bx - 1); ix <= Math.min(columns - 1, bx + 1); ix++)
          for (let id = heads[iy * columns + ix]; id >= 0; id = next[id]) {
            const c = world.cells[id],
              distance = ((x - c.x) ** 2 + (y - c.y) ** 2) / support ** 2
            if (distance >= 1) continue
            const weight = (1 - distance) ** 3
            total += weight
            data[at] += c.elevation * weight
            data[at + 1] += c.moisture * weight
            data[at + 2] += (c.terrain === 'forest' ? 1 : 0) * weight
            data[at + 3] += (c.terrain === 'desert' ? 1 : 0) * weight
            data[at + 4] += (c.terrain === 'tundra' ? 1 : 0) * weight
            data[at + 7] += Math.max(0, c.terrain === 'water' ? 0 : c.elevation - 0.095) * weight
          }
      if (total) for (let k = 0; k < STRIDE; k++) data[at + k] /= total
    }
  }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * STRIDE
      data[at + 5] =
        ((data[(y * width + Math.max(0, x - 1)) * STRIDE] -
          data[(y * width + Math.min(width - 1, x + 1)) * STRIDE]) *
          (CELL_SIZE / 2)) /
        (spanX / (width - 1))
      data[at + 6] =
        ((data[(Math.max(0, y - 1) * width + x) * STRIDE] -
          data[(Math.min(height - 1, y + 1) * width + x) * STRIDE]) *
          (CELL_SIZE / 2)) /
        (spanY / (height - 1))
    }
  const field = { width, height, spanX, spanY, data }
  fields.set(world.cells, field)
  return field
}

export function sampleLandscape(field: LandscapeField, x: number, y: number, out: Float64Array) {
  const gx = clamp((x / field.spanX) * (field.width - 1), 0, field.width - 1),
    gy = clamp((y / field.spanY) * (field.height - 1), 0, field.height - 1)
  const ix = Math.floor(gx),
    iy = Math.floor(gy),
    fx = gx - ix,
    fy = gy - iy
  const a = (iy * field.width + ix) * STRIDE,
    b = (iy * field.width + Math.min(ix + 1, field.width - 1)) * STRIDE
  const c = (Math.min(iy + 1, field.height - 1) * field.width + ix) * STRIDE,
    d = (Math.min(iy + 1, field.height - 1) * field.width + Math.min(ix + 1, field.width - 1)) * STRIDE
  for (let k = 0; k < out.length; k++)
    out[k] =
      (field.data[a + k] * (1 - fx) + field.data[b + k] * fx) * (1 - fy) +
      (field.data[c + k] * (1 - fx) + field.data[d + k] * fx) * fy
  return out
}

export function landscapeElevation(field: LandscapeField, x: number, y: number) {
  const gx = clamp((x / field.spanX) * (field.width - 1), 0, field.width - 1),
    gy = clamp((y / field.spanY) * (field.height - 1), 0, field.height - 1)
  const ix = Math.floor(gx),
    iy = Math.floor(gy),
    fx = gx - ix,
    fy = gy - iy
  const a = (iy * field.width + ix) * STRIDE + 7,
    b = (iy * field.width + Math.min(ix + 1, field.width - 1)) * STRIDE + 7
  const c = (Math.min(iy + 1, field.height - 1) * field.width + ix) * STRIDE + 7,
    d = (Math.min(iy + 1, field.height - 1) * field.width + Math.min(ix + 1, field.width - 1)) * STRIDE + 7
  return (
    (field.data[a] * (1 - fx) + field.data[b] * fx) * (1 - fy) +
    (field.data[c] * (1 - fx) + field.data[d] * fx) * fy
  )
}
