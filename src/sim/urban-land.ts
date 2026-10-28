import type { World } from './types'
import type { PointMeters } from './adaptive-types'
import { CELL_METERS } from './grid'
import { habitableLand } from './terrain-access'

export function urbanCellAt(w: World, p: PointMeters) {
  if (p.x < 0 || p.y < 0 || p.x >= w.width * CELL_METERS || p.y >= w.height * CELL_METERS) return -1
  return Math.floor(p.y / CELL_METERS) * w.width + Math.floor(p.x / CELL_METERS)
}
export function urbanHost(w: World, cell: number) {
  return w.localEconomy?.active.find((id) => w.localEconomy!.units[id].cells.includes(cell))
}
export function urbanLand(w: World, p: PointMeters, nation: number) {
  const cell = urbanCellAt(w, p),
    c = w.cells[cell]
  return c &&
    habitableLand(c) &&
    w.regions[c.region]?.nation === nation &&
    (w.regions[c.region]?.devastation ?? 0) <= 0.9
    ? cell
    : -1
}
/** Continuous same-country land. Accounting cells are sampled, never obstacles. */
export function urbanLandSegment(w: World, a: PointMeters, b: PointMeters, nation: number) {
  const steps = Math.max(1, Math.ceil(Math.hypot(a.x - b.x, a.y - b.y) / 8))
  for (let i = 0; i <= steps; i++)
    if (
      urbanLand(
        w,
        {
          x: a.x + ((b.x - a.x) * i) / steps,
          y: a.y + ((b.y - a.y) * i) / steps,
        },
        nation,
      ) < 0
    )
      return false
  return true
}
