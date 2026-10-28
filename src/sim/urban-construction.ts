import type { World } from './types'
import type { PhysicalSite } from './adaptive-types'
import type { UrbanShape } from './urban-types'

export function urbanShape(site: PhysicalSite): UrbanShape {
  if (!site.parcel || !site.building || !site.fabric)
    throw new Error('Redevelopment requires surveyed premises')
  return structuredClone({
    site: site.id,
    point: { x: site.x, y: site.y },
    cell: site.cell,
    parcel: site.parcel,
    building: site.building,
    capacity: site.capacity,
    fabric: site.fabric,
  })
}

/** Paid projects advance on calendar dates. Six-month integration cannot finish a
 * project early, or require extra UI ticks to pass through intermediate stages. */
export function advanceUrbanConstruction(w: World) {
  const a = w.adaptive,
    u = a?.urban
  if (!a || !u || w.viewOnly) return
  for (const p of u.projects) {
    if (p.started === undefined || ['proposed', 'occupied', 'cancelled'].includes(p.status)) continue
    const elapsed = w.month - p.started
    if (elapsed < p.duration) {
      p.status = elapsed < Math.min(2, p.duration / 3) ? 'clearing' : 'construction'
      continue
    }
    const retained = new Set(p.after.map((s) => s.site))
    const openingValue = p.before.reduce((n, s) => n + (a.sites[s.site].investedValue ?? 0), 0)
    const openingCapacity = p.before.reduce((n, s) => n + a.sites[s.site].openingCapacity, 0)
    for (const shape of p.after) {
      const site = a.sites[shape.site]
      Object.assign(site, {
        ...shape.point,
        cell: shape.cell,
        parcel: structuredClone(shape.parcel),
        building: structuredClone(shape.building),
        capacity: shape.capacity,
        fabric: structuredClone(shape.fabric),
      })
      site.fabric!.altered = p.started + p.duration
      site.investedValue = (openingValue + p.cost) / Math.max(1, p.after.length)
      site.openingCapacity = openingCapacity / Math.max(1, p.after.length)
      delete site.retired
    }
    for (const shape of p.before)
      if (!retained.has(shape.site)) {
        const site = a.sites[shape.site]
        site.capacity = 0
        site.residents = 0
        site.investedValue = 0
        site.openingCapacity = 0
        site.retired = p.started + p.duration
        site.fabric!.successors = [...retained]
      }
    for (const d of p.displaced) {
      const origin = a.sites[d.to],
        target = a.sites[d.from]?.retired === undefined ? a.sites[d.from] : a.sites[p.after[0]?.site]
      if (!target || origin.pool !== target.pool) continue
      const returning = Math.max(
        0,
        Math.min(d.people, origin.residents ?? 0, Math.floor(target.capacity - (target.residents ?? 0))),
      )
      origin.residents = (origin.residents ?? 0) - returning
      target.residents = (target.residents ?? 0) + returning
    }
    if (p.lane) {
      const existing = p.lane.id && a.lanes?.find((l) => l.id === p.lane!.id)
      if (existing)
        Object.assign(existing, {
          points: structuredClone(p.lane.points),
          width: p.lane.width,
          upgraded: p.started + p.duration,
        })
      else
        (a.lanes ??= []).push({
          id: `street:${u.nextLane++}`,
          pool: p.host,
          founded: p.started + p.duration,
          points: structuredClone(p.lane.points),
          width: p.lane.width,
        })
      u.streetRevision++
    }
    p.status = 'occupied'
    p.completed = p.started + p.duration
    u.history.push({ month: p.completed, project: p.id, kind: p.kind, sites: [...p.sites], reason: p.reason })
    a.revision++
  }
}
