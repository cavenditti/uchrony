import { CELL_SIZE, CELL_METERS } from './grid'
import type { World } from './types'
import type {
  PointMeters,
  SpatialBounds,
  SpatialFragment,
  AdaptiveNode,
  SpatialInterface,
} from './adaptive-types'

export const METERS_PER_MAP_UNIT = CELL_METERS / CELL_SIZE
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
    half = CELL_METERS / 2
  return [
    { x: p.x - half, y: p.y - half },
    { x: p.x + half, y: p.y - half },
    { x: p.x + half, y: p.y + half },
    { x: p.x - half, y: p.y + half },
  ]
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
  return { x: 0, y: 0, size: CELL_METERS * 2 ** Math.ceil(Math.log2(Math.max(w.width, w.height))) }
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

/** Fine square leaves need area and source ownership on every tick, but their
 * four polygon vertices only for an actual geometry query. Keep those vertices
 * lazy instead of allocating millions of identical rectangle corner objects. */
class SquareFragment implements SpatialFragment {
  readonly area: number
  private points?: PointMeters[]
  constructor(
    readonly cell: number,
    readonly water: boolean | undefined,
    readonly bounds: SpatialBounds,
  ) {
    this.area = bounds.size ** 2
  }
  get polygon() {
    const { x, y, size } = this.bounds
    return (this.points ??= [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ])
  }
}

export function splitFragments(fragments: SpatialFragment[], bounds: SpatialBounds) {
  // Once refinement is wholly inside one aligned terrain sample, clipping a
  // rectangle against its four quadrants is exact. Irregular/clipped fragments
  // retain the general polygon path below.
  if (fragments.length === 1) {
    const f = fragments[0]
    const aligned =
      f instanceof SquareFragment
        ? f.bounds.x === bounds.x && f.bounds.y === bounds.y && f.bounds.size === bounds.size
        : f.area === bounds.size ** 2 &&
          f.polygon.length === 4 &&
          f.polygon.every(
            (p) =>
              (p.x === bounds.x || p.x === bounds.x + bounds.size) &&
              (p.y === bounds.y || p.y === bounds.y + bounds.size),
          )
    if (aligned)
      return [0, 1, 2, 3].map((q) => [
        new SquareFragment(f.cell, f.water, {
          x: bounds.x + ((q % 2) * bounds.size) / 2,
          y: bounds.y + (Math.floor(q / 2) * bounds.size) / 2,
          size: bounds.size / 2,
        }),
      ])
  }
  const output: SpatialFragment[][] = [[], [], [], []]
  // Dyadic sample boundaries align with the tree. Most fragments therefore
  // belong wholly to one child, with no clipping or polygon allocation needed.
  const middle = { x: bounds.x + bounds.size / 2, y: bounds.y + bounds.size / 2 }
  const crossing: SpatialFragment[] = []
  for (const f of fragments) {
    const left = f.polygon.every((p) => p.x <= middle.x)
    const right = f.polygon.every((p) => p.x >= middle.x)
    const top = f.polygon.every((p) => p.y <= middle.y)
    const bottom = f.polygon.every((p) => p.y >= middle.y)
    if ((left || right) && (top || bottom)) output[Number(!left) + 2 * Number(!top)].push(f)
    else crossing.push(f)
  }
  for (let i = 0; i < 4; i++) {
    const b = nodeBounds(bounds, 'r' + i)
    for (const f of crossing) {
      const polygon = clipPolygon(f.polygon, b),
        area = polygonArea(polygon)
      if (area > 1e-6) output[i].push({ cell: f.cell, water: f.water, polygon, area })
    }
  }
  return output
}
/** Each coarse/fine face is represented once; geometry never creates a trading partner. */
export function meshInterfaces(
  nodes: AdaptiveNode[],
  physical = true,
  adjacent?: (a: AdaptiveNode, b: AdaptiveNode) => void,
): SpatialInterface[] {
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
          if (adjacent) adjacent(a.node, b.node)
          else {
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
        }
        if (a.end <= b.end) i++
        else j++
      }
    }
  return result.sort((a, b) => a.id.localeCompare(b.id))
}

/** Balancing needs only the offending leaves, not allocated/sorted interfaces. */
export function unbalancedMeshNodes(nodes: AdaptiveNode[]) {
  const split = new Set<string>()
  if (!nodes.length) return split
  const depth = nodes.reduce((max, n) => Math.max(max, n.id.length - 1), 0)
  if (depth <= 16) {
    // Quadtree addresses are Morton intervals. Binary-search the leaf across
    // each face, avoiding four edge objects per leaf and a global face sort.
    // A fine face cannot straddle a coarser neighbour's dyadic boundary, so its
    // midpoint finds every neighbour that could violate the 2:1 rule.
    const ordered = nodes.every((node, i) => i === 0 || nodes[i - 1].id < node.id)
      ? nodes
      : [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const starts = new Float64Array(ordered.length),
      ends = new Float64Array(ordered.length)
    for (let i = 0; i < ordered.length; i++) {
      const id = ordered[i].id,
        span = 4 ** (depth - id.length + 1)
      starts[i] = (parseInt(id.slice(1), 4) || 0) * span
      ends[i] = starts[i] + span
    }
    const extent = 2 ** depth,
      rootSize = nodes[0].bounds.size * 2 ** (nodes[0].id.length - 1),
      unit = rootSize / extent
    const spread = (value: number) => {
      value = (value | (value << 8)) & 0x00ff00ff
      value = (value | (value << 4)) & 0x0f0f0f0f
      value = (value | (value << 2)) & 0x33333333
      return (value | (value << 1)) & 0x55555555
    }
    const check = (x: number, y: number, size: number) => {
      if (x < 0 || y < 0 || x >= extent || y >= extent) return
      const code = (spread(x) | (spread(y) << 1)) >>> 0
      let lo = 0,
        hi = ordered.length
      while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (starts[mid] <= code) lo = mid + 1
        else hi = mid
      }
      const index = lo - 1
      if (index >= 0 && code < ends[index] && ordered[index].bounds.size > size * 2)
        split.add(ordered[index].id)
    }
    for (const node of nodes) {
      const { x, y, size } = node.bounds,
        q = x / unit,
        r = y / unit,
        span = size / unit,
        midX = Math.floor(q + span / 2),
        midY = Math.floor(r + span / 2)
      // An offending neighbour is at least four times larger. Its face must
      // align with that coarser lattice; interior fine faces cannot touch it.
      const coarseSpan = span * 4
      if (q % coarseSpan === 0) check(q - 1, midY, size)
      if ((q + span) % coarseSpan === 0) check(q + span, midY, size)
      if (r % coarseSpan === 0) check(midX, r - 1, size)
      if ((r + span) % coarseSpan === 0) check(midX, r + span, size)
    }
    return split
  }
  // Retain general support for trees deeper than the 32-bit Morton domain.
  meshInterfaces(nodes, false, (a, b) => {
    if (a.bounds.size > b.bounds.size * 2) split.add(a.id)
    if (b.bounds.size > a.bounds.size * 2) split.add(b.id)
  })
  return split
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
