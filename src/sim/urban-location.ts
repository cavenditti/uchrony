import type { World } from './types'
import type { CompetitiveFirm } from './economic-types'
import type { PhysicalSite, PointMeters } from './adaptive-types'
import { type UrbanUse, URBAN_USES } from './urban-types'
import { SpatialBuckets } from './spatial-buckets'
import { urbanStreetRoute } from './urban-streets'
import { urbanCellAt, urbanLandSegment } from './urban-land'
import { laneTouchesRiver } from './river-lanes'
import { simulationMonths } from './simulation-period'

export interface UrbanLocation {
  scores: Record<UrbanUse, number>
  reasons: Record<UrbanUse, string>
  residents: number
  jobs: number
  freight: number
  services: number
  congestion: number
}
interface Source extends PointMeters {
  nation: number
  residents: number
  jobs: number
  production: number
  market: number
  services: number
  freight: number
}

/** Distribute a firm's existing jobs among real premises, retaining unsurveyed
 * employment at its legacy support until enough floor space actually exists. */
export function urbanEmploymentIndex(w: World) {
  const result = new Map<string, PhysicalSite[]>()
  for (const site of Object.values(w.adaptive?.sites ?? {}))
    if (site.retired === undefined && site.building)
      for (const id of site.fabric?.occupants ?? []) {
        const list = result.get(id) ?? []
        list.push(site)
        result.set(id, list)
      }
  return result
}

export function urbanEmploymentLocations(w: World, firm: CompetitiveFirm, index = urbanEmploymentIndex(w)) {
  const anchor = w.adaptive?.sites[`firm:${firm.id}`]
  if (!anchor || !firm.active) return []
  const premises = (index.get(`firm:${firm.id}`) ?? []).filter((s) => s.id !== anchor.id)
  const capacities = premises.map(
    (s) =>
      (s.fabric!.uses.production + s.fabric!.uses.logistics) /
      18 /
      Math.max(1, s.fabric!.occupants.filter((id) => id.startsWith('firm:')).length),
  )
  const capacity = capacities.reduce((a, b) => a + b, 0)
  const placed = Math.min(firm.employment, capacity)
  const result = premises.map((site, i) => ({
    site,
    workers: (placed * capacities[i]) / Math.max(1, capacity),
  }))
  if (firm.employment > placed) result.push({ site: anchor, workers: firm.employment - placed })
  return result
}

/** A frozen, bounded local choice snapshot. Saturation and competition prevent
 * a single high-scoring centre from absorbing every activity. No monetary flow. */
export function urbanLocationSnapshot(w: World) {
  const index = new SpatialBuckets<Source>(256)
  const add = (p: PointMeters, partial: Partial<Source>) => {
    const cell = w.cells[urbanCellAt(w, p)],
      nation = cell && w.regions[cell.region]?.nation
    if (nation === undefined || nation < 0) return
    index.insert(
      { ...p, nation, residents: 0, jobs: 0, production: 0, market: 0, services: 0, freight: 0, ...partial },
      p.x,
      p.y,
    )
  }
  const sites = Object.values(w.adaptive?.sites ?? {})
  for (const s of sites) {
    if (s.retired !== undefined) continue
    if (s.kind === 'residential' && s.residents) add(s, { residents: s.residents })
    if (s.kind === 'market') {
      const p = w.economy?.producers?.[s.pool]
      if (p)
        add(s, {
          market: Math.max(0, p.sales) / Math.max(0.0001, p.wage) / simulationMonths(),
          services: Math.max(0, p.publicServices) / Math.max(0.0001, p.wage) / simulationMonths(),
        })
    }
    if (s.kind === 'civic') add(s, { services: s.capacity })
  }
  // Build premises lookup once, rather than scanning the city for each firm.
  const placed = new Map<string, PhysicalSite[]>()
  for (const site of sites)
    if (site.retired === undefined && site.building)
      for (const id of site.fabric?.occupants ?? []) {
        const list = placed.get(id) ?? []
        list.push(site)
        placed.set(id, list)
      }
  for (const f of w.economy?.firms ?? []) {
    const s = w.adaptive?.sites[`firm:${f.id}`]
    if (!f.active || !s) continue
    const nonfarm = 1 - (f.laborMix?.food ?? (f.specialization === 'agricultural' ? 1 : 0.5))
    const premises = (placed.get(`firm:${f.id}`) ?? []).filter((p) => p.id !== s.id)
    let remaining = f.employment
    for (const p of premises) {
      const jobs = Math.min(
        remaining,
        (p.fabric!.uses.production + p.fabric!.uses.logistics) / 18 / Math.max(1, p.fabric!.occupants.length),
      )
      add(p, { jobs, production: jobs * nonfarm })
      remaining -= jobs
    }
    add(s, {
      jobs: remaining + Math.max(0, f.desiredEmployment - f.employment),
      production: remaining * nonfarm,
    })
  }
  const meters = w.adaptive?.metersPerMapUnit ?? 1024 / 12
  for (const c of w.corridors ?? [])
    if (c.traffic > 0) {
      const a = w.cells[c.a],
        b = w.cells[c.b]
      if (!a || !b) continue
      add(
        { x: ((a.x + b.x) * meters) / 2, y: ((a.y + b.y) * meters) / 2 },
        { freight: c.traffic / simulationMonths() },
      )
    }
  const memo = new Map<string, UrbanLocation>()
  return (p: PointMeters): UrbanLocation => {
    const key = `${p.x}:${p.y}`
    const cached = memo.get(key)
    if (cached) return cached
    const nation = w.regions[w.cells[urbanCellAt(w, p)]?.region]?.nation
    let residents = 0,
      jobs = 0,
      production = 0,
      market = 0,
      services = 0,
      freight = 0
    const nearby = [...index.query(p.x - 1000, p.y - 1000, p.x + 1000, p.y + 1000)]
      .filter((s) => s.nation === nation)
      .map((s) => ({ s, distance: Math.hypot(s.x - p.x, s.y - p.y) }))
      .filter((s) => s.distance <= 1000)
      .sort((a, b) => a.distance - b.distance || a.s.x - b.s.x || a.s.y - b.s.y)
      .slice(0, 64)
    for (const { s, distance } of nearby) {
      const route = distance > 1 ? urbanStreetRoute(w, p, s, 20) : undefined
      if (route === null) continue
      if (!route && (!urbanLandSegment(w, p, s, nation) || laneTouchesRiver(w, [p, s], 0))) continue
      const time = route?.minutes ?? distance / (4000 / 60)
      const weight = Math.exp(-time / 6)
      residents += s.residents * weight
      jobs += s.jobs * weight
      production += s.production * weight
      market += s.market * weight
      services += s.services * weight
      freight += s.freight * weight
    }
    const sat = (v: number, scale: number) => v / (scale + v)
    const people = sat(residents, 80),
      work = sat(jobs, 50),
      suppliers = sat(production, 35)
    const cargo = sat(freight, 30),
      service = sat(services, 25),
      shops = sat(market, 30)
    const congestion = sat(residents + jobs, 450),
      shortage = people * (1 - service)
    const scores: Record<UrbanUse, number> = {
      housing: 0.35 + work * 0.38 + service * 0.22 + shops * 0.12 - suppliers * 0.12 - congestion * 0.22,
      production: 0.15 + people * 0.28 + suppliers * 0.24 + cargo * 0.3 - congestion * 0.18,
      market: 0.12 + people * 0.5 + work * 0.2 + cargo * 0.08 - shops * 0.16 - congestion * 0.1,
      logistics: 0.1 + cargo * 0.55 + suppliers * 0.22 - congestion * 0.2,
      civic: 0.1 + shortage * 0.5 + work * 0.1,
    }
    const result = {
      scores,
      residents,
      jobs,
      freight,
      services,
      congestion,
      reasons: {
        housing: 'Access to jobs and funded services, balanced against crowding and workshop nuisance.',
        production: 'Nearby workers, suppliers and freight access reduce operating distances.',
        market:
          'Reachable customers and workplaces support local trade; nearby competitors reduce the advantage.',
        logistics: 'Recorded freight and nearby production support storage and handling space.',
        civic: 'Reachable residents with limited existing service provision create local need.',
      },
    }
    memo.set(key, result)
    return result
  }
}

export function preferredUrbanUse(location: UrbanLocation): UrbanUse {
  return URBAN_USES.reduce((a, b) => (location.scores[b] > location.scores[a] ? b : a), 'housing')
}

export function recordUrbanPressure(w: World, site: PhysicalSite, use: UrbanUse, score: number) {
  const u = w.adaptive?.urban
  if (!u) return
  const prior = u.pressure[site.id]
  u.pressure[site.id] = {
    use,
    score,
    since: prior?.use === use && w.month - prior.reviewed <= 12 ? prior.since : w.month,
    reviewed: w.month,
  }
}
