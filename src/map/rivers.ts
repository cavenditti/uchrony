import { neighbors } from '../sim/grid'
import { SpatialBuckets } from '../sim/spatial-buckets'
import type { Cell, World } from '../sim/types'
import type { Point } from './geometry'

export interface RiverCurve {
  from: number
  to: number
  a: Point
  b: Point
  c: Point
  d: Point
  flow: number
  endFlow?: number
  /** True only when this reach ends in a water cell, not at an inland junction. */
  mouth?: boolean
}

/** Drainage is topology; its presentation is a continuous curve in geographic coordinates.
 * No province, district, or quadtree address participates in these control points.
 */
export function riverCurves(world: Pick<World, 'cells' | 'width' | 'height'>): RiverCurve[] {
  const { cells } = world
  const downstream = new Map<number, number>(),
    upstream = new Map<number, Cell>(),
    tributaries = new Map<number, number>()
  for (const cell of cells) {
    if (!cell.river || cell.terrain === 'water') continue
    const next =
      cell.downstream === undefined
        ? neighbors(cell.id, world.width, world.height)
            .map((id) => cells[id])
            .filter((c) => (c.river || c.terrain === 'water') && c.elevation < cell.elevation)
            .sort((a, b) => a.elevation - b.elevation || a.id - b.id)[0]
        : cells[cell.downstream]
    if (!next || next.id === cell.id) continue
    downstream.set(cell.id, next.id)
    tributaries.set(next.id, (tributaries.get(next.id) ?? 0) + 1)
    const incoming = upstream.get(next.id)
    if (!incoming || (cell.riverFlow ?? 1) > (incoming.riverFlow ?? 1)) upstream.set(next.id, cell)
  }
  const tangent = (cell: Cell, fallback: Point) => {
    const before = upstream.get(cell.id),
      after = cells[downstream.get(cell.id) ?? -1]
    const a = before ?? cell,
      b = after ?? cell
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length = Math.hypot(dx, dy)
    return length > 0 ? { x: dx / length, y: dy / length } : fallback
  }
  const curves: RiverCurve[] = []
  // Simplify whole reaches, stopping at EVERY confluence. Fitting one curve per
  // simulation edge merely rounds a grid staircase; reach-scale fitting removes it.
  for (const head of downstream.keys()) {
    if (tributaries.get(head) === 1) continue
    const chain = [cells[head]]
    let id = head
    while (downstream.has(id)) {
      id = downstream.get(id)!
      chain.push(cells[id])
      if (tributaries.get(id) !== 1) break
    }
    const points = simplifyReach(chain, 8.4)
    let first = 0
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i],
        d = points[i + 1],
        dx = d.x - a.x,
        dy = d.y - a.y
      const length = Math.hypot(dx, dy),
        direction = { x: dx / (length || 1), y: dy / (length || 1) }
      const along = (before: Cell, after: Cell) => {
        const x = after.x - before.x,
          y = after.y - before.y,
          size = Math.hypot(x, y)
        return size ? { x: x / size, y: y / size } : direction
      }
      let start = i ? along(points[i - 1], d) : tangent(a, direction),
        end = i + 2 < points.length ? along(a, points[i + 2]) : tangent(d, direction)
      // At a sharp tributary join, never curl backwards into an unrelated catchment.
      if (start.x * dx + start.y * dy <= 0) start = direction
      if (end.x * dx + end.y * dy <= 0) end = direction
      const reach = length * 0.36
      const curve: RiverCurve = {
        from: a.id,
        to: d.id,
        a: { x: a.x, y: a.y },
        d: { x: d.x, y: d.y },
        b: { x: a.x + start.x * reach, y: a.y + start.y * reach },
        c: { x: d.x - end.x * reach, y: d.y - end.y * reach },
        flow: Math.max(1, a.riverFlow ?? 14),
        endFlow: Math.max(1, d.riverFlow ?? a.riverFlow ?? 14),
        mouth: d.terrain === 'water',
      }
      let last = first + 1
      while (chain[last].id !== d.id) last++
      // Smooth within the real drainage corridor, including on narrow peninsulas.
      // If a long tangent bows beyond it, relax toward the simplified chord.
      const linearB = { x: a.x + dx / 3, y: a.y + dy / 3 },
        linearC = { x: a.x + (dx * 2) / 3, y: a.y + (dy * 2) / 3 }
      for (let attempt = 0; attempt < 8; attempt++) {
        let outside = false
        for (let step = 1; step < 24 && !outside; step++) {
          const p = riverPoint(curve, step / 24)
          let distance = Infinity
          for (let j = first; j < last; j++)
            distance = Math.min(distance, segmentDistanceSquared(p, chain[j], chain[j + 1]))
          outside = distance > 8.4 ** 2
        }
        if (!outside) break
        const blend = attempt === 7 ? 0 : 0.5
        curve.b = {
          x: linearB.x + (curve.b.x - linearB.x) * blend,
          y: linearB.y + (curve.b.y - linearB.y) * blend,
        }
        curve.c = {
          x: linearC.x + (curve.c.x - linearC.x) * blend,
          y: linearC.y + (curve.c.y - linearC.y) * blend,
        }
      }
      first = last
      curves.push(curve)
    }
  }
  return curves
}

function segmentDistanceSquared(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
  return (p.x - a.x - dx * t) ** 2 + (p.y - a.y - dy * t) ** 2
}

/** Douglas–Peucker keeps bends that leave a narrow geographic river corridor. */
function simplifyReach(points: Cell[], tolerance: number): Cell[] {
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const pending = [[0, points.length - 1]]
  while (pending.length) {
    const [first, last] = pending.pop()!,
      a = points[first],
      b = points[last]
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length = dx * dx + dy * dy
    let farthest = -1,
      distance = tolerance * tolerance
    for (let i = first + 1; i < last; i++) {
      const p = points[i],
        t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (length || 1)))
      const delta = (p.x - a.x - dx * t) ** 2 + (p.y - a.y - dy * t) ** 2
      if (delta > distance) {
        farthest = i
        distance = delta
      }
    }
    if (farthest >= 0) {
      keep[farthest] = 1
      pending.push([first, farthest], [farthest, last])
    }
  }
  return points.filter((_, i) => keep[i])
}

export function riverPoint(curve: RiverCurve, t: number): Point {
  const u = 1 - t
  return {
    x: u ** 3 * curve.a.x + 3 * u * u * t * curve.b.x + 3 * u * t * t * curve.c.x + t ** 3 * curve.d.x,
    y: u ** 3 * curve.a.y + 3 * u * u * t * curve.b.y + 3 * u * t * t * curve.c.y + t ** 3 * curve.d.y,
  }
}

export function riverPaths(curves: RiverCurve[]) {
  return curves.map((curve) => {
    const path = new Path2D()
    path.moveTo(curve.a.x, curve.a.y)
    path.bezierCurveTo(curve.b.x, curve.b.y, curve.c.x, curve.c.y, curve.d.x, curve.d.y)
    return { path, flow: curve.flow }
  })
}

/** One cross-section contract for rendered channels and town setbacks. */
export function riverHalfWidth(curve: RiverCurve, t: number) {
  const flow = curve.flow + ((curve.endFlow ?? curve.flow) - curve.flow) * t
  return Math.min(6, 0.35 + Math.sqrt(flow) * 0.13) / 2
}

type Channel = { a: Point; b: Point; halfWidth: number }
const channelIndexes = new WeakMap<readonly Cell[], SpatialBuckets<Channel>>()

/** Short chords of every rendered reach, indexed once per geography. */
function channelIndex(world: Pick<World, 'cells' | 'width' | 'height'>) {
  let index = channelIndexes.get(world.cells)
  if (index) return index
  index = new SpatialBuckets<Channel>(8)
  for (const curve of riverCurves(world)) {
    const span =
      Math.hypot(curve.b.x - curve.a.x, curve.b.y - curve.a.y) +
      Math.hypot(curve.c.x - curve.b.x, curve.c.y - curve.b.y) +
      Math.hypot(curve.d.x - curve.c.x, curve.d.y - curve.c.y)
    const steps = Math.max(2, Math.ceil(span / 0.5))
    for (let i = 0; i < steps; i++) {
      const a = riverPoint(curve, i / steps),
        b = riverPoint(curve, (i + 1) / steps),
        halfWidth = Math.max(riverHalfWidth(curve, i / steps), riverHalfWidth(curve, (i + 1) / steps))
      index.insert(
        { a, b, halfWidth },
        Math.min(a.x, b.x) - halfWidth,
        Math.min(a.y, b.y) - halfWidth,
        Math.max(a.x, b.x) + halfWidth,
        Math.max(a.y, b.y) + halfWidth,
      )
    }
  }
  channelIndexes.set(world.cells, index)
  return index
}

/** Whether a footprint (map units) comes within `setback` of rendered river
 * water. Lot surveys and town rendering share this test, so a building is
 * neither planned nor drawn inside the visible channel. */
export function inRiverChannel(
  world: Pick<World, 'cells' | 'width' | 'height'>,
  footprint: readonly Point[],
  setback = 0,
) {
  const xs = footprint.map((p) => p.x),
    ys = footprint.map((p) => p.y)
  let wet = false
  channelIndex(world).visit(
    Math.min(...xs) - setback,
    Math.min(...ys) - setback,
    Math.max(...xs) + setback,
    Math.max(...ys) + setback,
    (channel) => {
      wet ||= polygonSegmentDistance(footprint, channel.a, channel.b) < channel.halfWidth + setback
    },
  )
  return wet
}

/** Widest rendered channel within `reach` of a point, in map units; 0 away from rivers. */
export function riverWidthNear(world: Pick<World, 'cells' | 'width' | 'height'>, p: Point, reach: number) {
  let width = 0
  channelIndex(world).visit(p.x - reach, p.y - reach, p.x + reach, p.y + reach, (channel) => {
    if (segmentDistanceSquared(p, channel.a, channel.b) < (channel.halfWidth + reach) ** 2)
      width = Math.max(width, channel.halfWidth * 2)
  })
  return width
}

/** Local channel sections, with a stable tangent and the closest centreline point.
 * Road surveys use the same water geometry as buildings and the renderer. */
export function riverSectionsNear(world: Pick<World, 'cells' | 'width' | 'height'>, p: Point, reach: number) {
  return [...channelIndex(world).query(p.x - reach, p.y - reach, p.x + reach, p.y + reach)]
    .map(({ a, b, halfWidth }) => {
      const dx = b.x - a.x,
        dy = b.y - a.y,
        length = Math.hypot(dx, dy)
      const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length ** 2)) : 0
      const point = { x: a.x + t * dx, y: a.y + t * dy }
      return {
        point,
        tangent: { x: dx / (length || 1), y: dy / (length || 1) },
        halfWidth,
        distance: Math.hypot(p.x - point.x, p.y - point.y),
      }
    })
    .filter((s) => s.distance < reach + s.halfWidth)
    .sort(
      (a, b) =>
        a.distance - a.halfWidth - (b.distance - b.halfWidth) ||
        a.point.x - b.point.x ||
        a.point.y - b.point.y,
    )
}

/** Length of a straight segment lying over rendered river water, in map units. */
export function riverCrossing(world: Pick<World, 'cells' | 'width' | 'height'>, a: Point, b: Point) {
  const length = Math.hypot(b.x - a.x, b.y - a.y),
    steps = Math.max(1, Math.ceil(length / 0.05)),
    index = channelIndex(world)
  let wet = 0
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps,
      p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    let inside = false
    index.visit(p.x, p.y, p.x, p.y, (channel) => {
      inside ||= segmentDistanceSquared(p, channel.a, channel.b) < channel.halfWidth ** 2
    })
    if (inside) wet += length / steps
  }
  return wet
}

function polygonSegmentDistance(polygon: readonly Point[], a: Point, b: Point) {
  if (insidePolygon(a, polygon)) return 0
  let distance = Infinity
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i],
      q = polygon[(i + 1) % polygon.length]
    const d = { x: q.x - p.x, y: q.y - p.y },
      e = { x: b.x - a.x, y: b.y - a.y },
      det = d.x * e.y - d.y * e.x
    if (Math.abs(det) > 1e-12) {
      const t = ((a.x - p.x) * e.y - (a.y - p.y) * e.x) / det,
        u = ((a.x - p.x) * d.y - (a.y - p.y) * d.x) / det
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0
    }
    distance = Math.min(
      distance,
      segmentDistanceSquared(p, a, b),
      segmentDistanceSquared(a, p, q),
      segmentDistanceSquared(b, p, q),
    )
  }
  return Math.sqrt(distance)
}

function insidePolygon(point: Point, polygon: readonly Point[]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j]
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside
  }
  return inside
}

/** Approximate distance from each reach's downstream end to open water. Following
 * drainage keeps the estuary continuous across joins without tinting nearby inland rivers.
 */
export function riverOutletDistances(curves: RiverCurve[], lengths: number[]) {
  const outgoing = new Map(curves.map((curve, i) => [curve.from, i]))
  const distances = new Float64Array(curves.length).fill(NaN)
  for (let i = 0; i < curves.length; i++) {
    if (!Number.isNaN(distances[i])) continue
    const pending: [number, number][] = [],
      seen = new Set<number>()
    let current = i
    while (Number.isNaN(distances[current])) {
      if (curves[current].mouth) {
        distances[current] = 0
        break
      }
      const next = outgoing.get(curves[current].to)
      if (next === undefined || seen.has(current)) {
        distances[current] = Infinity
        break
      }
      seen.add(current)
      pending.push([current, next])
      current = next
    }
    for (let j = pending.length - 1; j >= 0; j--) {
      const [from, to] = pending[j]
      distances[from] = lengths[to] + distances[to]
    }
  }
  return distances
}
