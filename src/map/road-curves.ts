import { cellAt, movementNeighbors } from '../sim/grid'
import { habitableLand } from '../sim/terrain-access'
import { traversableLegs } from '../sim/transport'
import { METERS_PER_MAP_UNIT } from '../sim/physical-space'
import type { World } from '../sim/types'

export interface RoadPoint {
  x: number
  y: number
}
export interface RoadCurve {
  from: RoadPoint
  control: RoadPoint
  to: RoadPoint
}
export interface RoadEdge {
  a: number
  b: number
  curves: RoadCurve[]
  points: RoadPoint[]
}
export const roadKey = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`
const midpoint = (a: RoadPoint, b: RoadPoint): RoadPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const reverse = (c: RoadCurve): RoadCurve => ({ from: c.to, control: c.control, to: c.from })
const cache = new WeakMap<
  World,
  {
    revision: number
    month: number
    routes: World['routes']
    traces: World['corridors']
    edges: Map<string, RoadEdge>
  }
>()

/** The actual road graph supplies joins, not the individual shipment paths.
 * Inside an ordinary bend, a quadratic joins the two edge midpoints. Its convex
 * hull lies wholly in that source cell; smoothing cannot cut across a blocked
 * neighbour. Junctions, ports and building frontages retain their exact anchors.
 * Both halves of each bend belong to their respective edges, so opposite freight,
 * remembered roads and quantity overlays all share one continuous geometry. */
export function tradeRoadEdges(w: World) {
  const revision = w.adaptive?.revision ?? 0,
    prior = cache.get(w)
  if (
    prior &&
    prior.revision === revision &&
    prior.month === w.month &&
    prior.routes === w.routes &&
    prior.traces === w.corridors
  )
    return prior.edges
  const pairs = new Map<string, [number, number]>(),
    adjacent = new Map<number, Set<number>>()
  const add = (a: number, b: number) => {
    if (
      !w.cells[a] ||
      !w.cells[b] ||
      !habitableLand(w.cells[a]) ||
      !habitableLand(w.cells[b]) ||
      !movementNeighbors(w.cells, a, w.width, w.height).includes(b)
    )
      return
    const key = roadKey(a, b)
    if (pairs.has(key)) return
    pairs.set(key, [Math.min(a, b), Math.max(a, b)])
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      const list = adjacent.get(from) ?? new Set<number>()
      list.add(to)
      adjacent.set(from, list)
    }
  }
  const anchored = new Set(w.regions.map((r) => r.center))
  for (const trace of w.corridors ?? [])
    if (trace.familiarity > 0.06 || trace.traffic > 0) add(trace.a, trace.b)
  for (const route of w.routes) {
    if (!route.legs || !traversableLegs(w, route.legs)) continue
    for (const leg of route.legs) {
      if (leg.mode === 'land') for (let i = 1; i < leg.cells.length; i++) add(leg.cells[i - 1], leg.cells[i])
      else {
        anchored.add(leg.cells[0])
        anchored.add(leg.cells.at(-1)!)
      }
    }
  }
  // These streets were surveyed against a straight freight frontage. Their
  // physical connection must not drift when a cartographic bend is softened.
  for (const home of w.viewHomes ?? Object.values(w.adaptive?.sites ?? {}))
    if (home.building) anchored.add(home.cell)
  const meters = w.adaptive?.metersPerMapUnit ?? METERS_PER_MAP_UNIT
  for (const lane of w.adaptive?.lanes ?? [])
    for (const p of lane.points) {
      const cell = cellAt(p.x / meters, p.y / meters, w.width, w.height)
      if (cell !== undefined) anchored.add(cell)
    }
  const half = (id: number, other: number): RoadCurve => {
    const node = w.cells[id],
      end = midpoint(node, w.cells[other]),
      arms = [...adjacent.get(id)!].sort((a, b) => a - b)
    if (arms.length !== 2 || anchored.has(id))
      return { from: { x: node.x, y: node.y }, control: midpoint(node, end), to: end }
    const opposite = midpoint(node, w.cells[arms.find((a) => a !== other)!])
    const control = midpoint(node, end)
    return { from: midpoint(midpoint(opposite, node), control), control, to: end }
  }
  const edges = new Map<string, RoadEdge>()
  for (const [key, [a, b]] of [...pairs].sort((x, y) => x[1][0] - y[1][0] || x[1][1] - y[1][1])) {
    const curves = [half(a, b), reverse(half(b, a))]
    const points = [curves[0].from]
    // Arc-length samples only drive symbolic cargo, never routing or freight cost.
    // Sixteen subdivisions per half keep the largest corner error below 0.5 m.
    for (const c of curves)
      for (let i = 1; i <= 16; i++) {
        const t = i / 16,
          u = 1 - t
        points.push({
          x: u * u * c.from.x + 2 * u * t * c.control.x + t * t * c.to.x,
          y: u * u * c.from.y + 2 * u * t * c.control.y + t * t * c.to.y,
        })
      }
    edges.set(key, { a, b, curves, points })
  }
  cache.set(w, { revision, month: w.month, routes: w.routes, traces: w.corridors, edges })
  return edges
}

export function orientedRoadCurves(edge: RoadEdge, from: number) {
  return from === edge.a ? edge.curves : [...edge.curves].reverse().map(reverse)
}

/** Ground paint and the trade highlight use the exact same quadratic commands. */
export function traceRoadCurves(
  path: Pick<CanvasRenderingContext2D, 'moveTo' | 'quadraticCurveTo'>,
  curves: RoadCurve[],
  move = true,
) {
  if (move && curves.length) path.moveTo(curves[0].from.x, curves[0].from.y)
  for (const c of curves) path.quadraticCurveTo(c.control.x, c.control.y, c.to.x, c.to.y)
}
