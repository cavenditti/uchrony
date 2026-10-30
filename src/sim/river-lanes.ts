import { parameterGroup } from './configuration-context'
import type { PointMeters, SettlementLane } from './adaptive-types'
import type { World } from './types'
import { inRiverChannel, riverSectionsNear } from '../map/rivers'

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
