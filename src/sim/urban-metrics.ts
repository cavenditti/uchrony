import type { World } from './types'
import { polygonArea } from './physical-space'

/** Pure physical census, shared by the controlled and full-engine experiments. */
export function urbanMetrics(w: World) {
  const sites = Object.values(w.adaptive?.sites ?? {}).filter((s) => s.retired === undefined)
  const homes = sites.filter((s) => s.kind === 'residential')
  const capacity = homes.reduce((n, s) => n + s.capacity, 0)
  const residents = homes.reduce((n, s) => n + (s.residents ?? 0), 0)
  return {
    month: w.month,
    residents,
    capacity,
    vacancies: homes.reduce((n, s) => n + Math.max(0, s.capacity - (s.residents ?? 0)), 0),
    occupiedBuildings: homes.filter((s) => s.building && (s.residents ?? 0) > 0).length,
    buildings: sites.filter((s) => s.building).length,
    footprintArea: sites.reduce((n, s) => n + (s.building ? polygonArea(s.building) : 0), 0),
    employment: (w.economy?.firms ?? []).filter((f) => f.active).reduce((n, f) => n + f.employment, 0),
    pendingCapacity: (w.adaptive?.construction ?? []).reduce((n, p) => n + p.capacity, 0),
    laneMeters: (w.adaptive?.lanes ?? []).reduce(
      (n, l) =>
        n +
        l.points.slice(1).reduce((m, p, i) => m + Math.hypot(p.x - l.points[i].x, p.y - l.points[i].y), 0),
      0,
    ),
    geometry: sites
      .filter((s) => s.building)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((s) => [s.id, s.building]),
  }
}
