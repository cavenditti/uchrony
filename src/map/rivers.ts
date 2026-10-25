import { neighbors } from '../sim/hex'
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
  // simulation edge merely rounds a hex staircase; reach-scale fitting removes it.
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
