import { CELL_SIZE, cellAt } from '../sim/grid'
import type { World } from '../sim/types'
import { buildGeometry, type Point, type Ring } from './geometry'

type Geography = Pick<World, 'cells' | 'width' | 'height'>
type Curve = { a: Point; b: Point; c: Point }
const cache = new WeakMap<World['cells'], LandSurface>()
const middle = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

/** The same midpoint/quadratic outline as pathFor(coast, true). Height is not
 * a land mask: smoothed relief can extend underneath the transparent sea. */
export class LandSurface {
  private rows = new Map<number, Curve[]>()
  constructor(rings: Ring[]) {
    for (const ring of rings)
      ring.forEach((b, i) => {
        const a = middle(ring[(i + ring.length - 1) % ring.length], b),
          c = middle(b, ring[(i + 1) % ring.length])
        for (
          let row = Math.floor(Math.min(a.y, c.y) / CELL_SIZE);
          row <= Math.floor(Math.max(a.y, c.y) / CELL_SIZE);
          row++
        ) {
          const curves = this.rows.get(row) ?? []
          curves.push({ a, b, c })
          this.rows.set(row, curves)
        }
      })
  }
  contains(x: number, y: number) {
    let inside = false
    for (const { a, b, c } of this.rows.get(Math.floor(y / CELL_SIZE)) ?? []) {
      if (a.y > y === c.y > y) continue
      // Coast segments are monotone in y. Bisection avoids cancellation in the
      // quadratic roots and agrees at shared endpoints with the even/odd rule.
      let lo = 0,
        hi = 1
      for (let i = 0; i < 30; i++) {
        const t = (lo + hi) / 2,
          u = 1 - t
        if (u * u * a.y + 2 * u * t * b.y + t * t * c.y < y === a.y < c.y) lo = t
        else hi = t
      }
      const t = (lo + hi) / 2,
        u = 1 - t
      if (x < u * u * a.x + 2 * u * t * b.x + t * t * c.x) inside = !inside
    }
    return inside
  }
  shore(land: Point, water: Point) {
    if (!this.contains(land.x, land.y) || this.contains(water.x, water.y)) return null
    let lo = 0,
      hi = 1
    for (let i = 0; i < 30; i++) {
      const t = (lo + hi) / 2
      if (this.contains(land.x + (water.x - land.x) * t, land.y + (water.y - land.y) * t)) lo = t
      else hi = t
    }
    return { x: land.x + (water.x - land.x) * lo, y: land.y + (water.y - land.y) * lo }
  }
}

export function landSurface(world: Geography) {
  let surface = cache.get(world.cells)
  if (!surface) {
    let regions = 0
    for (const cell of world.cells) regions = Math.max(regions, cell.region + 1)
    surface = new LandSurface(buildGeometry(world.cells, world.width, world.height, regions).coast)
    cache.set(world.cells, surface)
  }
  return surface
}

/** Interior cells cannot be clipped by shore smoothing; avoid coastline work
 * for the overwhelmingly common inland building/tree samples. */
export function renderedLand(world: Geography, x: number, z: number) {
  const id = cellAt(x, z, world.width, world.height)
  if (id === undefined) return false
  const cell = world.cells[id]
  if (cell.terrain === 'water') return false
  if (cell.q > 0 && cell.r > 0 && cell.q < world.width - 1 && cell.r < world.height - 1) {
    let inland = true
    for (let dr = -1; dr <= 1; dr++)
      for (let dq = -1; dq <= 1; dq++)
        if (world.cells[id + dr * world.width + dq].terrain === 'water') inland = false
    if (inland) return true
  }
  return landSurface(world).contains(x, z)
}

export function footprint(x: number, z: number, width: number, depth: number, angle: number) {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([u, v]) => ({
    x: x + ((u * width) / 2) * Math.cos(angle) + ((v * depth) / 2) * Math.sin(angle),
    z: z - ((u * width) / 2) * Math.sin(angle) + ((v * depth) / 2) * Math.cos(angle),
  }))
}
