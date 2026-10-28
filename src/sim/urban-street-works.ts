import type { World } from './types'
import type { PointMeters, SettlementLane } from './adaptive-types'
import { footprintConnection } from './residential-geometry'
import { laneTouchesRiver } from './river-lanes'
import { urbanLandSegment } from './urban-land'
import { urbanStreetGraph, urbanStreetRoute } from './urban-streets'
import { activeUrbanProject, fundUrbanProject, proposeUrbanProject } from './urban-projects'
import { crossedPeriodMonth } from './simulation-period'

const length = (points: PointMeters[]) =>
  points.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0)

/** A widened/realigned street must fit its whole usable width. Existing houses
 * are not silently removed to make a line look straighter. */
export function urbanStreetClear(w: World, points: PointMeters[], width: number, pool: number) {
  const nation = w.localEconomy!.units[pool].nation
  if (laneTouchesRiver(w, points, width)) return false
  for (let i = 1; i < points.length; i++) {
    if (!urbanLandSegment(w, points[i - 1], points[i], nation)) return false
    for (const s of Object.values(w.adaptive!.sites))
      if (
        s.retired === undefined &&
        s.building &&
        !s.premises &&
        footprintConnection([points[i - 1], points[i]], s.building).distance < width / 2 + 1
      )
        return false
  }
  return true
}

export function planUrbanStreetWork(
  w: World,
  lane: SettlementLane,
  kind: 'connect' | 'widen' | 'realign',
  points = lane.points,
) {
  const width = kind === 'widen' ? Math.min(8, lane.width + 2) : lane.width
  if (kind === 'widen' && width <= lane.width) return undefined
  if (!urbanStreetClear(w, points, width, lane.pool)) return undefined
  if (kind === 'realign') {
    if (length(points) >= length(lane.points) * 0.85) return undefined
    // Retain junctions: a bend joined by another street cannot be erased.
    const graph = urbanStreetGraph(w)
    if (
      graph.nodes.some(
        (p, i) =>
          graph.edges[i].length > 2 &&
          footprintConnection([p], lane.points).distance < 0.1 &&
          footprintConnection([p], points).distance > 0.1,
      )
    )
      return undefined
  }
  const project = proposeUrbanProject(
    w,
    kind,
    [],
    [],
    {
      connect: 'Connect nearby street ends where a shorter route serves existing activity.',
      widen: 'Widen a busy local street where there is enough clear land.',
      realign: 'Shorten a winding street while preserving buildings and junctions.',
    }[kind],
    kind === 'widen'
      ? width / lane.width - 1
      : Math.max(0.1, 1 - length(points) / Math.max(1, length(lane.points))),
    {
      ...(kind === 'connect' ? {} : { id: lane.id }),
      width,
      points,
      before: lane.points,
    },
    lane.pool,
  )
  return project
}

/** Use existing population and jobs as a bounded service-load estimate. This
 * does not create trips, employment, trade, or production in the accounts. */
export function updateUrbanStreetLoads(w: World) {
  const graph = urbanStreetGraph(w)
  for (const lane of w.adaptive!.lanes ?? []) lane.load = 0
  for (const site of Object.values(w.adaptive!.sites)) {
    if (site.retired !== undefined) continue
    const people =
      site.kind === 'residential' ? (site.residents ?? 0) : site.kind === 'establishment' ? site.capacity : 0
    if (people <= 0) continue
    let best: { lane: SettlementLane; distance: number } | undefined
    for (const i of graph.buckets.query(site.x - 64, site.y - 64, site.x + 64, site.y + 64)) {
      const s = graph.segments[i],
        d = footprintConnection([site], [graph.nodes[s.a], graph.nodes[s.b]]).distance
      if (d <= 64 && (!best || d < best.distance)) best = { lane: s.lane, distance: d }
    }
    if (best) best.lane.load = (best.lane.load ?? 0) + people
  }
  // Load changes route costs even when the physical line remains unchanged.
  w.adaptive!.revision++
}

export function advanceUrbanStreets(w: World) {
  const a = w.adaptive,
    u = a?.urban
  if (!a || !u?.enabled || w.viewOnly || !crossedPeriodMonth(w.month, 0, 6)) return
  updateUrbanStreetLoads(w)
  const lanes = (a.lanes ?? []).filter((l) => l.id && w.month - (l.upgraded ?? l.founded) >= 24)
  const pending = new Set(
    u.projects
      .filter(activeUrbanProject)
      .filter((p) => p.lane)
      .map((p) => p.host),
  )
  const limit = Math.min(32, lanes.length),
    offset = (Math.floor(w.month / 6) * 32) % Math.max(1, lanes.length)
  for (let n = 0; n < limit; n++) {
    const lane = lanes[(offset + n) % lanes.length]
    if (pending.has(lane.pool) || (lane.load ?? 0) < 12) continue
    let project
    if ((lane.load ?? 0) > lane.width * 20) project = planUrbanStreetWork(w, lane, 'widen')
    if (!project && lane.points.length > 2)
      project = planUrbanStreetWork(w, lane, 'realign', [lane.points[0], lane.points.at(-1)!])
    if (!project) {
      const ends = [lane.points[0], lane.points.at(-1)!]
      const pairs = (a.lanes ?? [])
        .filter(
          (l) =>
            l !== lane && w.localEconomy!.units[l.pool].nation === w.localEconomy!.units[lane.pool].nation,
        )
        .flatMap((l) =>
          [l.points[0], l.points.at(-1)!].flatMap((to) =>
            ends.map((from) => ({ from, to, d: Math.hypot(from.x - to.x, from.y - to.y) })),
          ),
        )
        .filter((p) => p.d > 8 && p.d < 250)
        .sort((a, b) => a.d - b.d)
        .slice(0, 8)
      for (const pair of pairs) {
        const route = urbanStreetRoute(w, pair.from, pair.to, 30)
        if (route && route.minutes <= (pair.d / 70) * 1.3) continue
        project = planUrbanStreetWork(w, lane, 'connect', [pair.from, pair.to])
        if (project) break
      }
    }
    if (project && fundUrbanProject(w, project, 0.1)) pending.add(lane.pool)
  }
}
