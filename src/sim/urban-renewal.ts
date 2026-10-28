import type { World } from './types'
import type { PhysicalSite } from './adaptive-types'
import type { UrbanUse, UrbanProjectKind } from './urban-types'
import { polygonArea } from './physical-space'
import { urbanCellAt } from './urban-land'
import { rectangularFootprint } from './urban-growth'
import { urbanShape } from './urban-construction'
import { dominantUrbanUse } from './urban-fabric'
import { urbanLocationSnapshot, recordUrbanPressure } from './urban-location'
import {
  activeUrbanProject,
  fundUrbanProject,
  nearestFrontage,
  proposeUrbanProject,
  urbanShapeClear,
} from './urban-projects'

/** Prepare one durable physical alteration. Old centres retain their fabric:
 * repairs and modest additions compete with more disruptive redevelopment. */
export function planUrbanRenewal(
  w: World,
  site: PhysicalSite,
  kind: UrbanProjectKind,
  use: UrbanUse = dominantUrbanUse(site),
  partner?: PhysicalSite,
) {
  const before = partner ? [site, partner] : [site],
    shape = urbanShape(site)
  const oldArea = before.reduce((n, s) => n + s.fabric!.floorArea, 0)
  if (kind === 'repair') shape.fabric.condition = 1
  if (kind === 'extend') {
    const addition = Math.min(polygonArea(shape.building) * 0.5, shape.fabric.floorArea * 0.25)
    if (shape.fabric.floorArea + addition > polygonArea(shape.building) * 4) return undefined
    shape.fabric.floorArea += addition
    shape.fabric.uses.housing += addition
    shape.capacity += addition / 28
  }
  if (kind === 'convert') {
    const dominant = dominantUrbanUse(site),
      housingBefore = shape.fabric.uses.housing,
      share = Math.min(shape.fabric.uses[dominant], shape.fabric.floorArea * 0.35)
    if (dominant === use || share <= 1) return undefined
    shape.fabric.uses[dominant] -= share
    shape.fabric.uses[use] += share
    // Preserve existing residential density when removing housing. A spacious
    // low-capacity home must not gain residents' places by becoming a workshop.
    shape.capacity =
      shape.fabric.uses.housing < housingBefore
        ? (shape.capacity * shape.fabric.uses.housing) / housingBefore
        : shape.capacity + (shape.fabric.uses.housing - housingBefore) / 28
  }
  if (kind === 'replace' || kind === 'consolidate') {
    const points = before.flatMap((s) => s.building!),
      left = Math.min(...points.map((p) => p.x)),
      right = Math.max(...points.map((p) => p.x))
    const top = Math.min(...points.map((p) => p.y)),
      bottom = Math.max(...points.map((p) => p.y))
    shape.point = { x: (left + right) / 2, y: (top + bottom) / 2 }
    shape.cell = urbanCellAt(w, shape.point)
    const angle = nearestFrontage(w, shape.point)?.angle ?? 0
    const width = partner ? right - left : Math.sqrt(polygonArea(shape.building)) * 1.1
    const footprint = before.reduce((n, s) => n + polygonArea(s.building!), 0)
    // Spanning the gap between lots must not turn that gap into free floor area.
    const depth = partner
      ? Math.min(bottom - top, footprint / width)
      : Math.sqrt(polygonArea(shape.building)) / 1.1
    shape.building = rectangularFootprint(shape.point, width, depth, angle)
    const size =
      Math.max(
        ...shape.building.map((p) => Math.abs(p.x - shape.point.x)),
        ...shape.building.map((p) => Math.abs(p.y - shape.point.y)),
      ) *
        2 +
      4
    shape.parcel = { x: shape.point.x - size / 2, y: shape.point.y - size / 2, size }
    // Consolidation keeps every existing square metre and resident capacity.
    for (const other of before.slice(1)) {
      for (const key of Object.keys(shape.fabric.uses) as UrbanUse[])
        shape.fabric.uses[key] += other.fabric!.uses[key]
      shape.capacity += other.capacity
      shape.fabric.occupants.push(...other.fabric!.occupants)
    }
    shape.fabric.floorArea = oldArea
    shape.fabric.condition = 1
    shape.fabric.predecessors = [...new Set([...shape.fabric.predecessors, ...before.map((s) => s.id)])]
  }
  if (['production', 'logistics'].includes(use)) {
    const firms = (w.economy?.firms ?? []).filter(
      (f) =>
        f.active &&
        f.employment > 0 &&
        (f.locality ?? f.region) === site.pool &&
        f.specialization !== 'agricultural',
    )
    const firm = firms.sort((a, b) => b.employment - a.employment || a.id - b.id)[0]
    if (!firm) return undefined
    shape.fabric.occupants = [...new Set([...shape.fabric.occupants, `firm:${firm.id}`])]
  }
  if (use === 'market')
    shape.fabric.occupants = [...new Set([...shape.fabric.occupants, `market:${site.pool}`])]
  if (use === 'civic')
    shape.fabric.occupants = [...new Set([...shape.fabric.occupants, `services:${site.pool}`])]
  if (!urbanShapeClear(w, shape, new Set(before.map((s) => s.id)))) return undefined
  return proposeUrbanProject(
    w,
    kind,
    before,
    [shape],
    {
      repair: 'Repair worn fabric while retaining its footprint and occupants.',
      extend: 'Add housing floor space where occupied buildings face sustained demand.',
      convert: `Adapt existing floor space to ${use} near reachable demand.`,
      replace: 'Rebuild worn premises along their established street frontage.',
      consolidate: 'Combine neighbouring underused premises into a coherent street-facing building.',
      connect: '',
      widen: '',
      realign: '',
    }[kind],
    kind === 'repair' ? 1 - site.fabric!.condition : 0.2,
  )
}

/** Calendar-based reviews are bounded. At most 48 premises are considered every
 * six months; the rotating deterministic window prevents starvation in big worlds. */
export function advanceUrbanRenewal(w: World) {
  const a = w.adaptive,
    u = a?.urban
  if (!a || !u || w.viewOnly) return
  const elapsed = Math.max(0, w.month - u.lastMonth)
  if (!elapsed) return
  const previous = u.lastMonth
  u.lastMonth = w.month
  if (!u.enabled) return
  const pending = new Set(u.projects.filter(activeUrbanProject).flatMap((p) => p.sites))
  for (const p of a.construction ?? []) pending.add(p.site)
  const sites = Object.values(a.sites).filter(
    (s) => s.retired === undefined && s.building && s.parcel && s.fabric && !s.premises,
  )
  for (const s of sites)
    if (!pending.has(s.id)) {
      const aging = Math.max(0, w.month - Math.max(previous, s.fabric!.altered))
      s.fabric!.condition = Math.max(0.4, Math.round((s.fabric!.condition - aging * 0.0006) * 1e9) / 1e9)
    }
  if (Math.floor(previous / 6) === Math.floor(w.month / 6)) return
  const locations = urbanLocationSnapshot(w)
  const pools = new Map<number, PhysicalSite[]>()
  for (const site of sites)
    if (!pending.has(site.id) && w.month - site.fabric!.altered >= 24) {
      const list = pools.get(site.pool) ?? []
      list.push(site)
      pools.set(site.pool, list)
    }
  const poolIds = [...pools.keys()].sort((a, b) => a - b)
  const offset = (Math.floor(w.month / 6) * 6) % Math.max(1, poolIds.length)
  const candidates: PhysicalSite[] = []
  for (let i = 0; i < Math.min(6, poolIds.length); i++) {
    const list = pools.get(poolIds[(offset + i) % poolIds.length])!
    list.sort(
      (a, b) =>
        a.fabric!.condition - b.fabric!.condition ||
        a.fabric!.altered - b.fabric!.altered ||
        a.id.localeCompare(b.id),
    )
    candidates.push(...list.slice(0, 8))
  }
  const funded = new Set<number>()
  for (const site of candidates) {
    if (pending.has(site.id)) continue
    const location = locations(site),
      current = dominantUrbanUse(site),
      p = w.economy?.producers[site.pool]
    // Empty scores cannot invent tenants, customers, or public service funding.
    const allowed: UrbanUse[] = ['housing']
    if (
      (w.economy?.firms ?? []).some(
        (f) =>
          f.active &&
          f.employment > 0 &&
          (f.locality ?? f.region) === site.pool &&
          f.specialization !== 'agricultural',
      )
    )
      allowed.push('production', 'logistics')
    if ((p?.sales ?? 0) > 0 && location.residents > 12) allowed.push('market')
    if ((p?.publicServices ?? 0) > 0 && location.residents > 12) allowed.push('civic')
    // Saturated local supply prevents repeated conversions into vacant uses.
    const supply = sites.filter((s) => Math.hypot(s.x - site.x, s.y - site.y) < 400)
    const score = (use: UrbanUse) =>
      location.scores[use] -
      (use === 'housing' ? 0 : Math.min(0.4, supply.reduce((n, s) => n + s.fabric!.uses[use], 0) / 6000))
    const use = allowed.reduce((best, next) => (score(next) > score(best) ? next : best), current)
    recordUrbanPressure(w, site, use, score(use))
    const persistent = w.month - u.pressure[site.id].since >= 6
    if (funded.has(site.pool)) continue
    let project
    if (site.fabric!.condition < 0.62) project = planUrbanRenewal(w, site, 'replace')
    if (!project && site.fabric!.condition < 0.83) project = planUrbanRenewal(w, site, 'repair')
    if (!project && persistent && use !== current && score(use) > score(current) + 0.04)
      project = planUrbanRenewal(w, site, 'convert', use)
    if (!project && (site.residents ?? 0) >= site.capacity * 0.92 && location.jobs > 5)
      project = planUrbanRenewal(w, site, 'extend')
    if (
      !project &&
      use === current &&
      w.month - site.fabric!.altered >= 60 &&
      (site.residents ?? 0) < site.capacity * 0.65 &&
      location.residents + location.jobs > 30
    ) {
      const partner = sites
        .filter(
          (s) =>
            s.id !== site.id &&
            s.pool === site.pool &&
            !pending.has(s.id) &&
            (s.residents ?? 0) < s.capacity * 0.65 &&
            Math.hypot(s.x - site.x, s.y - site.y) < 65,
        )
        .sort((a, b) => a.id.localeCompare(b.id))[0]
      if (partner) project = planUrbanRenewal(w, site, 'consolidate', current, partner)
    }
    if (project && fundUrbanProject(w, project)) {
      funded.add(site.pool)
      for (const id of project.sites) pending.add(id)
    }
  }
}
