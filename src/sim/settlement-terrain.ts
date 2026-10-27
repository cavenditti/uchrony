import { CELL_METERS } from './grid'
import type { World } from './types'
import type { PointMeters } from './adaptive-types'

/** Interpolation of recorded terrain, not invented sub-cell geology. */
export function settlementElevation(w: World, p: PointMeters) {
  const x = p.x / CELL_METERS - 0.5,
    y = p.y / CELL_METERS - 0.5
  const q = Math.floor(x),
    r = Math.floor(y),
    tx = x - q,
    ty = y - r
  let value = 0
  for (let dy = 0; dy <= 1; dy++)
    for (let dx = 0; dx <= 1; dx++) {
      const ix = Math.max(0, Math.min(w.width - 1, q + dx)),
        iy = Math.max(0, Math.min(w.height - 1, r + dy))
      value += w.cells[iy * w.width + ix].elevation * (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty)
    }
  return value
}
