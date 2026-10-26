import { HEX } from './hex'
import type { World } from './types'
import type {
  PointMeters,
  SpatialBounds,
  SpatialFragment,
  AdaptiveNode,
  SpatialInterface,
} from './adaptive-types'

export const METERS_PER_MAP_UNIT = 1000 / (Math.sqrt(3) * HEX)
export function cellPosition(w: World, id: number): PointMeters {
  const c = w.cells[id],
    scale = w.adaptive?.metersPerMapUnit ?? METERS_PER_MAP_UNIT
  return { x: c.x * scale, y: c.y * scale }
}
export function polygonArea(p: PointMeters[]) {
  return (
    Math.abs(
      p.reduce((sum, a, i) => {
        const b = p[(i + 1) % p.length]
        return sum + a.x * b.y - b.x * a.y
      }, 0),
    ) / 2
  )
}
export function cellPolygon(w: World, id: number): PointMeters[] {
  const p = cellPosition(w, id),
    radius = HEX * (w.adaptive?.metersPerMapUnit ?? METERS_PER_MAP_UNIT)
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2
    return { x: p.x + Math.cos(a) * radius, y: p.y + Math.sin(a) * radius }
  })
}
/** Clip the same original land polygon at every level, including thin cut cells. */
export function clipPolygon(polygon: PointMeters[], b: SpatialBounds) {
  let result = polygon
  for (const [axis, edge, direction] of [
    ['x', b.x, 1],
    ['x', b.x + b.size, -1],
    ['y', b.y, 1],
    ['y', b.y + b.size, -1],
  ] as const) {
    const input = result
    result = []
    for (let i = 0; i < input.length; i++) {
      const a = input[i],
        c = input[(i + 1) % input.length]
      const insideA = direction * (a[axis] - edge) >= -1e-8,
        insideC = direction * (c[axis] - edge) >= -1e-8
      if (insideA) result.push(a)
      if (insideA !== insideC) {
        const t = (edge - a[axis]) / (c[axis] - a[axis])
        result.push({ x: a.x + t * (c.x - a.x), y: a.y + t * (c.y - a.y) })
      }
    }
  }
  return result
}
export function rootBounds(w: World): SpatialBounds {
  // Keep legacy addresses stable at the original scale. Inspect the full extent: an odd
  // penultimate row can extend farther east than the final row.
  const radius = HEX * (w.adaptive?.metersPerMapUnit ?? METERS_PER_MAP_UNIT)
  let east = 0,
    south = 0,
    west = -1000,
    north = -1000
  for (const c of w.cells) {
    const p = cellPosition(w, c.id)
    east = Math.max(east, p.x + radius)
    south = Math.max(south, p.y + radius)
    west = Math.min(west, p.x - radius)
    north = Math.min(north, p.y - radius)
  }
  const end = cellPosition(w, w.cells.length - 1)
  const size = 2 ** Math.ceil(Math.log2(Math.max(east - west, south - north, end.x + 2000, end.y + 2000)))
  return { x: west, y: north, size }
}
export function nodeBounds(root: SpatialBounds, address: string) {
  if (!/^r[0-3]*$/.test(address) || address.length > 40) throw new Error('Invalid spatial address')
  let bounds = { ...root }
  for (const digit of address.slice(1)) {
    const quadrant = Number(digit),
      size = bounds.size / 2
    bounds = { x: bounds.x + (quadrant % 2) * size, y: bounds.y + Math.floor(quadrant / 2) * size, size }
  }
  return bounds
}
export function quadrant(p: PointMeters, b: SpatialBounds) {
  return Number(p.x >= b.x + b.size / 2) + 2 * Number(p.y >= b.y + b.size / 2)
}
export function splitFragments(fragments: SpatialFragment[], bounds: SpatialBounds) {
  const output: SpatialFragment[][] = [[], [], [], []]
  for (let i = 0; i < 4; i++) {
    const b = nodeBounds(bounds, 'r' + i)
    for (const f of fragments) {
      const polygon = clipPolygon(f.polygon, b),
        area = polygonArea(polygon)
      if (area > 1e-6) output[i].push({ cell: f.cell, water: f.water, polygon, area })
    }
  }
  return output
}
/** Each coarse/fine face is represented once; geometry never creates a trading partner. */
export function meshInterfaces(nodes: AdaptiveNode[], physical = true): SpatialInterface[] {
  type Edge = { node: AdaptiveNode; start: number; end: number; side: number }
  const axes = [new Map<number, Edge[]>(), new Map<number, Edge[]>()]
  for (const node of nodes) {
    const b = node.bounds
    for (let axis = 0; axis < 2; axis++)
      for (let side = 0; side < 2; side++) {
        const at = (axis ? b.y : b.x) + side * b.size,
          start = axis ? b.x : b.y
        const list = axes[axis].get(at) ?? []
        list.push({ node, start, end: start + b.size, side })
        axes[axis].set(at, list)
      }
  }
  const result: SpatialInterface[] = []
  for (const [dimension, axis] of axes.entries())
    for (const edges of axis.values()) {
      const left = edges.filter((e) => e.side === 0).sort((a, b) => a.start - b.start)
      const right = edges.filter((e) => e.side === 1).sort((a, b) => a.start - b.start)
      let i = 0,
        j = 0
      while (i < left.length && j < right.length) {
        const a = left[i],
          b = right[j],
          length = Math.min(a.end, b.end) - Math.max(a.start, b.start)
        if (length > 1e-6) {
          const ids = [a.node.id, b.node.id].sort()
          if (!physical) result.push({ id: ids.join('|'), a: ids[0], b: ids[1], length })
          else {
            const x = faceIntervals(a.node, dimension, a.side),
              y = faceIntervals(b.node, dimension, b.side)
            const landLength = intervalOverlap(x.land, y.land),
              waterLength = intervalOverlap(x.water, y.water),
              coastLength = intervalOverlap(x.land, y.water) + intervalOverlap(x.water, y.land)
            const contact = landLength + waterLength + coastLength
            if (contact > 1e-6)
              result.push({
                id: ids.join('|'),
                a: ids[0],
                b: ids[1],
                length: contact,
                landLength,
                waterLength,
                coastLength,
              })
          }
        }
        if (a.end <= b.end) i++
        else j++
      }
    }
  return result.sort((a, b) => a.id.localeCompare(b.id))
}

type Interval = [number, number]
function mergeIntervals(intervals: Interval[]): Interval[] {
  const result: Interval[] = []
  for (const [start, end] of intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = result.at(-1)
    if (last && start <= last[1] + 1e-7) last[1] = Math.max(last[1], end)
    else result.push([start, end])
  }
  return result
}
function faceIntervals(node: AdaptiveNode, dimension: number, side: number) {
  const axis = dimension ? 'y' : 'x',
    along = dimension ? 'x' : 'y'
  const at = node.bounds[axis] + side * node.bounds.size
  const land: Interval[] = [],
    water: Interval[] = []
  for (const f of node.fragments)
    for (let i = 0; i < f.polygon.length; i++) {
      const p = f.polygon[i],
        q = f.polygon[(i + 1) % f.polygon.length]
      if (Math.abs(p[axis] - at) < 1e-7 && Math.abs(q[axis] - at) < 1e-7) {
        const start = Math.min(p[along], q[along]),
          end = Math.max(p[along], q[along])
        if (end - start > 1e-7) (f.water ? water : land).push([start, end])
      }
    }
  return { land: mergeIntervals(land), water: mergeIntervals(water) }
}
function intervalOverlap(a: Interval[], b: Interval[]) {
  let i = 0,
    j = 0,
    length = 0
  while (i < a.length && j < b.length) {
    length += Math.max(0, Math.min(a[i][1], b[j][1]) - Math.max(a[i][0], b[j][0]))
    if (a[i][1] <= b[j][1]) i++
    else j++
  }
  return length
}

/** Convex cut-cell membership, including the boundary. */
export function pointInPolygon(point: PointMeters, polygon: PointMeters[]) {
  if (polygon.length < 3) return false
  let sign = 0
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length]
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)
    if (Math.abs(cross) <= 1e-7 * Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))) continue
    if (sign && Math.sign(cross) !== sign) return false
    sign = Math.sign(cross)
  }
  return true
}
