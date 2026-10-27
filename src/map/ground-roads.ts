import { tradeRoadEdges, traceRoadCurves, type RoadCurve } from './road-curves'
import { habitableLand } from '../sim/terrain-access'
import { cellAt } from '../sim/grid'
import type { World } from '../sim/types'
import { METERS_PER_MAP_UNIT } from '../sim/physical-space'
import { hashSeed } from '../sim/random'

export interface GroundRoad {
  points: { x: number; y: number }[]
  width: number
  kind: 'lane' | 'trade'
  curves?: RoadCurve[]
}
const cache = new WeakMap<
  World,
  {
    revision: number
    month: number
    routes: World['routes']
    traces: World['corridors']
    roads: GroundRoad[]
  }
>()

/** Physical paths remain visible with the freight overlay off. Sea routes never
 * become roads, and shared land edges are painted only once. */
export function groundRoads(w: World) {
  const prior = cache.get(w),
    revision = w.adaptive?.revision ?? w.month
  if (
    prior?.revision === revision &&
    prior.month === w.month &&
    prior.routes === w.routes &&
    prior.traces === w.corridors
  )
    return prior.roads
  const meters = w.adaptive?.metersPerMapUnit ?? METERS_PER_MAP_UNIT
  const roads: GroundRoad[] = (w.adaptive?.lanes ?? [])
    .filter((lane) =>
      lane.points.every((p, i) => {
        const prev = lane.points[Math.max(0, i - 1)]
        const steps = Math.max(1, Math.ceil(Math.hypot(p.x - prev.x, p.y - prev.y) / 128))
        for (let j = 0; j <= steps; j++) {
          const id = cellAt(
            (prev.x + ((p.x - prev.x) * j) / steps) / meters,
            (prev.y + ((p.y - prev.y) * j) / steps) / meters,
            w.width,
            w.height,
          )
          if (id === undefined || !habitableLand(w.cells[id])) return false
        }
        return true
      }),
    )
    .map((lane) => ({
      kind: 'lane',
      width: lane.width / meters,
      points: lane.points.map((p) => ({ x: p.x / meters, y: p.y / meters })),
    }))
  for (const edge of tradeRoadEdges(w).values())
    roads.push({ kind: 'trade', width: 5 / meters, points: edge.points, curves: edge.curves })
  cache.set(w, { revision, month: w.month, routes: w.routes, traces: w.corridors, roads })
  return roads
}

/** Ground pigment, rendered into the same canvas/terrain overlay in both views.
 * Soft shoulders, exposed earth and broken wheel wear have no extruded meshes. */
export function drawGroundRoads(
  ctx: CanvasRenderingContext2D,
  w: World,
  scale: number,
  window: { x: number; y: number; width: number; height: number },
  land: Path2D,
) {
  const roads = groundRoads(w).filter((road) => {
    const xs = road.points.map((p) => p.x),
      ys = road.points.map((p) => p.y)
    return (
      Math.min(...xs) < window.x + window.width &&
      Math.max(...xs) > window.x &&
      Math.min(...ys) < window.y + window.height &&
      Math.max(...ys) > window.y
    )
  })
  ctx.save()
  ctx.clip(land, 'evenodd')
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const batches = new Map<number, Path2D>()
  for (const road of roads) {
    const width = Math.max(road.width, 0.65 / scale)
    const path = batches.get(width) ?? new Path2D()
    if (road.curves) traceRoadCurves(path, road.curves)
    else road.points.forEach((p, i) => (i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)))
    batches.set(width, path)
  }
  // One paint operation per width: shared endpoints do not acquire dark alpha
  // seams, and curves keep the same shoulders through bends and junctions.
  for (const [width, path] of batches) {
    ctx.setLineDash([])
    ctx.strokeStyle = '#6c62442b'
    ctx.lineWidth = width * 1.65
    ctx.stroke(path)
    ctx.strokeStyle = '#ae9670a8'
    ctx.lineWidth = width * 1.18
    ctx.stroke(path)
    ctx.strokeStyle = '#c5ad80df'
    ctx.lineWidth = width * 0.82
    ctx.stroke(path)
    if (width * scale >= 3) {
      const salt = hashSeed(`${w.seed}:road-wear:${width}`)
      ctx.lineDashOffset = (salt % 13) * width
      ctx.setLineDash([width * 0.45, width * 0.8, width * 0.2, width * 1.6])
      ctx.strokeStyle = '#735b3d40'
      ctx.lineWidth = width * 0.24
      ctx.stroke(path)
      ctx.setLineDash([])
    }
  }
  ctx.restore()
}
