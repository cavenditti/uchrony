import { parameterGroup } from './configuration-context'
import type { PointMeters, SettlementLane } from './adaptive-types'
import type { World } from './types'
import { inRiverChannel, riverSectionsNear } from '../map/rivers'
import { CELL_METERS } from './grid'
import { habitableLand } from './terrain-access'
import { footprintConnection } from './residential-geometry'
import { SpatialBuckets } from './spatial-buckets'
import { settlementElevation } from './settlement-terrain'

/** Local streets leave room for a bank path; crossings are scarce shared links. */
export const RIVER_ROADS = parameterGroup('riverRoads')
const distance = (a: PointMeters, b: PointMeters) => Math.hypot(b.x - a.x, b.y - a.y)
const midpoint = (lane: SettlementLane) => ({
  x: (lane.points[0].x + lane.points[1].x) / 2,
  y: (lane.points[0].y + lane.points[1].y) / 2,
})
export function laneTouchesRiver(w: World, points: PointMeters[], width: number) {
  const scale = w.adaptive!.metersPerMapUnit
  return inRiverChannel(
    w,
    points.map((p) => ({ x: p.x / scale, y: p.y / scale })),
    (width / 2 + RIVER_ROADS.setback) / scale,
  )
}

export function nearbyRiverBank(w: World, p: PointMeters, reach = RIVER_ROADS.search) {
  const scale = w.adaptive!.metersPerMapUnit
  const section = riverSectionsNear(w, { x: p.x / scale, y: p.y / scale }, reach / scale)[0]
  if (!section) return
  const center = { x: section.point.x * scale, y: section.point.y * scale }
  const normal = { x: -section.tangent.y, y: section.tangent.x }
  const side = (p.x - center.x) * normal.x + (p.y - center.y) * normal.y < 0 ? -1 : 1
  const radius = section.halfWidth * scale + RIVER_ROADS.approach
  return {
    tangent: section.tangent,
    center,
    point: { x: center.x + normal.x * radius * side, y: center.y + normal.y * radius * side },
    opposite: { x: center.x - normal.x * radius * side, y: center.y - normal.y * radius * side },
  }
}

/** Prefer a short perpendicular span with dry, buildable abutments. Reject
 * estuaries, confluences, tight bends and nearby duplicate crossings. The caller
 * checks land ownership, terrain grade and existing buildings over the full span. */
export function surveyRiverBridge(
  w: World,
  origin: PointMeters,
  lanes: SettlementLane[],
  clear: (a: PointMeters, b: PointMeters, width: number) => boolean,
) {
  const scale = w.adaptive!.metersPerMapUnit,
    width = 5.5
  const sections = riverSectionsNear(
    w,
    { x: origin.x / scale, y: origin.y / scale },
    RIVER_ROADS.search / scale,
  )
  const seen = new Set<string>()
  const options: { points: [PointMeters, PointMeters]; score: number; tangent: PointMeters }[] = []
  for (const section of sections) {
    const center = { x: section.point.x * scale, y: section.point.y * scale }
    const tag = `${Math.round(center.x / 16)}:${Math.round(center.y / 16)}`
    if (seen.has(tag)) continue
    seen.add(tag)
    if (lanes.some((l) => l.bridge && distance(midpoint(l), center) < RIVER_ROADS.spacing)) continue
    const halfSpan = section.halfWidth * scale + RIVER_ROADS.approach
    if (halfSpan * 2 > RIVER_ROADS.maxSpan) continue
    const normal = { x: -section.tangent.y, y: section.tangent.x }
    let a = { x: center.x + normal.x * halfSpan, y: center.y + normal.y * halfSpan }
    let b = { x: center.x - normal.x * halfSpan, y: center.y - normal.y * halfSpan }
    if (distance(b, origin) < distance(a, origin)) [a, b] = [b, a]
    if (laneTouchesRiver(w, [a], width) || laneTouchesRiver(w, [b], width) || !clear(a, b, width)) continue
    // A single water interval is required; crossing a second arm is not a shortcut.
    let runs = 0,
      wetBefore = false,
      wetLength = 0
    const steps = Math.ceil((halfSpan * 2) / 4)
    for (let i = 0; i <= steps; i++) {
      const p = { x: (a.x + ((b.x - a.x) * i) / steps) / scale, y: (a.y + ((b.y - a.y) * i) / steps) / scale }
      const wet = inRiverChannel(w, [p], width / scale / 2)
      if (wet && !wetBefore) runs++
      if (wet) wetLength += (halfSpan * 2) / steps
      wetBefore = wet
    }
    if (runs !== 1 || wetLength > section.halfWidth * scale * 2 + width + 12) continue
    options.push({ points: [a, b], tangent: section.tangent, score: distance(origin, a) + halfSpan * 1.5 })
  }
  return options.sort((a, b) => a.score - b.score)[0]
}

/** Upgrade old street meshes once, preserving every building, account and
 * resident. Dry frontage survives; wet tangles become shared bridge crossings. */
export function reconcileRiverLanes(w: World) {
  const adaptive = w.adaptive
  if (!adaptive || adaptive.riverLaneVersion === 1) return false
  const old = adaptive.lanes ?? []
  const lanes: SettlementLane[] = [],
    ends = new Map<number, PointMeters[]>()
  let changed = false
  for (const lane of old) {
    if (
      lane.bridge ||
      !lane.points.slice(1).some((b, i) => laneTouchesRiver(w, [lane.points[i], b], lane.width))
    ) {
      lanes.push(lane)
      continue
    }
    changed = true
    let run: PointMeters[] = []
    const flush = () => {
      if (run.length >= 2 && distance(run[0], run.at(-1)!) > 2) {
        lanes.push({ ...lane, points: run })
        const tips = ends.get(lane.pool) ?? []
        tips.push(run[0], run.at(-1)!)
        ends.set(lane.pool, tips)
      }
      run = []
    }
    for (let i = 1; i < lane.points.length; i++) {
      const a = lane.points[i - 1],
        b = lane.points[i],
        n = Math.max(1, Math.ceil(distance(a, b) / 4))
      for (let j = i === 1 ? 0 : 1; j <= n; j++) {
        const p = { x: a.x + ((b.x - a.x) * j) / n, y: a.y + ((b.y - a.y) * j) / n }
        if (laneTouchesRiver(w, [run.at(-1) ?? p, p], lane.width)) flush()
        else run.push(p)
      }
    }
    flush()
  }
  if (changed) {
    const buildings = new SpatialBuckets<PointMeters[]>(128)
    for (const site of Object.values(adaptive.sites))
      if (site.building) {
        const xs = site.building.map((p) => p.x),
          ys = site.building.map((p) => p.y)
        buildings.insert(site.building, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys))
      }
    for (const [pool, tips] of ends) {
      const owned = new Set(w.localEconomy!.units[pool].cells)
      const clear = (a: PointMeters, b: PointMeters, width: number) => {
        if (Math.abs(settlementElevation(w, a) - settlementElevation(w, b)) >= 0.025) return false
        const n = Math.max(1, Math.ceil(distance(a, b) / 6))
        for (let i = 0; i <= n; i++) {
          const x = a.x + ((b.x - a.x) * i) / n,
            y = a.y + ((b.y - a.y) * i) / n
          const q = Math.floor(x / CELL_METERS),
            r = Math.floor(y / CELL_METERS),
            id = r * w.width + q
          if (
            q < 0 ||
            r < 0 ||
            q >= w.width ||
            r >= w.height ||
            !owned.has(id) ||
            !habitableLand(w.cells[id])
          )
            return false
        }
        const gap = width / 2 + 1
        return [
          ...buildings.query(
            Math.min(a.x, b.x) - gap,
            Math.min(a.y, b.y) - gap,
            Math.max(a.x, b.x) + gap,
            Math.max(a.y, b.y) + gap,
          ),
        ].every((shape) => footprintConnection(shape, [a, b]).distance >= gap)
      }
      const connection = (p: PointMeters) =>
        tips
          .map((tip) => ({ tip, length: distance(p, tip) }))
          .filter((t) => t.length < RIVER_ROADS.search)
          .sort((a, b) => a.length - b.length)
          .slice(0, 24)
          .find(({ tip }) => !laneTouchesRiver(w, [p, tip], 3.5) && clear(p, tip, 3.5))?.tip
      // Quantized attempts bound migration work even for a densely tangled save.
      const tried = new Set<string>()
      for (const origin of tips) {
        const key = `${Math.floor(origin.x / 80)}:${Math.floor(origin.y / 80)}`
        if (tried.has(key)) continue
        tried.add(key)
        const bridge = surveyRiverBridge(
          w,
          origin,
          lanes,
          (a, b, width) => clear(a, b, width) && !!connection(a) && !!connection(b),
        )
        if (!bridge) continue
        lanes.push({ pool, founded: w.month, width: 5.5, points: bridge.points, bridge: true })
        for (const p of bridge.points) {
          const tip = connection(p)!
          if (distance(p, tip) > 0.1) lanes.push({ pool, founded: w.month, width: 3.5, points: [tip, p] })
        }
      }
    }
    adaptive.lanes = lanes
    adaptive.revision++
  }
  adaptive.riverLaneVersion = 1
  return changed
}
