import { commutesAt } from './commute-ledger'
import { queryAdaptiveLeaves, queryAdaptiveSitesInBounds } from './adaptive-grid'
import { cellPosition } from './physical-space'
import { activeJurisdictions } from './jurisdictions'
import { hashSeed } from './random'
import { population } from './types'
import { STRATA, type EconomicStratum } from './economic-types'
import type { World } from './types'
import type { SpatialBounds } from './adaptive-types'
import type { PopulationCommunity } from './population-types'

/** Conditional age/sex sampling from the census, using a separate, stateless display hash. */
function representativePerson(
  groups: PopulationCommunity[],
  month: number,
  seed: number,
  employed: boolean,
  jobs: Map<EconomicStratum, number>,
  stratum?: EconomicStratum,
) {
  const adults = new Map<EconomicStratum, number>()
  for (const group of groups)
    for (const [born, f, m] of group.ageCohorts ?? []) {
      if (month - born >= 216 && month - born < 780) {
        const s = group.stratum ?? 'laborer'
        adults.set(s, (adults.get(s) ?? 0) + f + m)
      }
    }
  const entries = groups
    .filter((g) => !stratum || (g.stratum ?? 'laborer') === stratum)
    .flatMap((g) =>
      (g.ageCohorts ?? []).flatMap(([born, female, male]) => {
        const working = month - born >= 216 && month - born < 780,
          s = g.stratum ?? 'laborer'
        const fraction = employed
          ? working
            ? 1
            : 0
          : working
            ? Math.max(0, 1 - (jobs.get(s) ?? 0) / Math.max(1, adults.get(s) ?? 0))
            : 1
        return [
          {
            age: Math.floor((month - born) / 12),
            sex: 'female' as const,
            stratum: s,
            weight: female * fraction,
          },
          { age: Math.floor((month - born) / 12), sex: 'male' as const, stratum: s, weight: male * fraction },
        ].filter((entry) => entry.weight > 0)
      }),
    )
  let draw = (seed / 0x100000000) * entries.reduce((sum, e) => sum + e.weight, 0)
  return entries.find((entry) => (draw -= entry.weight) < 0) ?? entries.at(-1)
}

export interface InspectionRequest {
  id: number
  bounds: SpatialBounds
  detail: 'region' | 'street'
  month?: number
}
export interface RepresentativeRoutine {
  id: string
  home: string
  workplace?: string
  stratum: EconomicStratum
  weight: number
  age: string
  sex: 'female' | 'male'
  activities: { hour: number; label: string; site: string }[]
  journeys?: { start: number; end: number; points: { x: number; y: number }[] }[]
}
export interface InspectionSnapshot {
  request: number
  revision: number
  month: number
  bounds: SpatialBounds
  population: number
  representedWorkers: number
  capacity: number
  jurisdictions: { id: string; name: string; level: string }[]
  sites: {
    id: string
    kind: string
    x: number
    y: number
    capacity: number
    residents: number
    jobs: number
  }[]
  routines: RepresentativeRoutine[]
  totalSites: number
  sampled: boolean
  nodes: { id: string; bounds: SpatialBounds; population: number; jobs: number }[]
}
/** Conditional representative day, never an authoritative individual or a second economic tick. */
export function inspectWorld(w: World, request: InspectionRequest): InspectionSnapshot {
  if (!w.adaptive || !w.localEconomy) throw new Error('Advance one month to initialize detailed inspection.')
  const b = request.bounds
  if (
    !Number.isSafeInteger(request.id) ||
    ![b.x, b.y, b.size].every(Number.isFinite) ||
    b.size <= 0 ||
    b.size > 1e7
  )
    throw new Error('Invalid inspection bounds')
  if (request.month !== undefined && request.month !== w.month)
    throw new Error('The requested month is no longer current; refresh inspection.')
  const members = queryAdaptiveSitesInBounds(w, b)
  const firmJobs = new Map((w.economy?.firms ?? []).map((f) => [`firm:${f.id}`, f.active ? f.employment : 0]))
  const counts = (s: (typeof members)[number]) =>
    s.kind === 'residential' ? (s.residents ?? w.localEconomy!.units[s.pool].residents[s.cell] ?? 0) : 0
  const people = members.reduce((sum, s) => sum + counts(s), 0)
  const memberCells = new Set(members.map((s) => s.cell))
  // Bounds on returned geometry are visual sampling only; totals always cover every selected site.
  const limit = request.detail === 'street' ? 256 : 64
  const selected = members
    .filter((_, i) => i % Math.max(1, Math.ceil(members.length / limit)) === 0)
    .slice(0, limit)
  const routines: RepresentativeRoutine[] = []
  for (const home of selected.filter((s) => s.kind === 'residential' && counts(s) > 0).slice(0, 24)) {
    const pool = w.localEconomy.units[home.pool],
      share = counts(home) / Math.max(1, population(pool))
    const groups = (w.regions[pool.province].communities ?? []).filter(
      (g) => (g.locality ?? pool.province) === pool.id,
    )
    const seed = hashSeed(`${w.seed}:inspection:${home.id}:${w.month}`)
    const paid = commutesAt(w, home.pool)
    const jobs = new Map(
      STRATA.map((s) => [s, paid.filter((f) => f.stratum === s).reduce((sum, f) => sum + f.workers, 0)]),
    )
    let covered = 0
    for (const stratum of STRATA) {
      const flows = paid.filter((flow) => flow.stratum === stratum)
      const total = flows.reduce((sum, f) => sum + f.workers * share, 0)
      if (!total) continue
      let draw = ((hashSeed(`${seed}:${stratum}`) / 0x100000000) * total) / share
      const flow = flows.find((f) => (draw -= f.workers) <= 0) ?? flows[flows.length - 1],
        travelHours = flow.minutes / 60
      const path = flow.route ? w.adaptive.commuteRoutes?.[flow.route]?.cells : flow.cells
      const workplace = w.adaptive.sites[flow.workplace]
      const points = [
        { x: home.x, y: home.y },
        ...(path ?? []).map((cell) => cellPosition(w, cell)),
        { x: workplace.x, y: workplace.y },
      ]
      const person = representativePerson(
        groups,
        w.month,
        hashSeed(`${seed}:${stratum}:person`),
        true,
        jobs,
        stratum,
      )
      routines.push({
        id: `${home.id}:${stratum}:employed:${w.month}`,
        home: home.id,
        workplace: flow.workplace,
        stratum,
        weight: total,
        age: person ? String(person.age) : 'working age',
        sex: person?.sex ?? 'female',
        journeys: [
          { start: 8 - travelHours, end: 8, points },
          { start: 17, end: 17 + travelHours, points: [...points].reverse() },
        ],
        activities: [
          { hour: 0, label: 'At home', site: home.id },
          {
            hour: 8 - travelHours,
            label: `Travel to work · ${Math.round(flow.minutes)} min`,
            site: flow.workplace,
          },
          { hour: 8, label: 'At work', site: flow.workplace },
          { hour: 17, label: 'Travel home', site: home.id },
          { hour: 17 + travelHours, label: 'At home', site: home.id },
        ],
      })
      covered += total
    }
    const residual = Math.max(0, counts(home) - covered)
    if (residual) {
      // Unemployed adults, children and elders are never assigned a paid job for appearance's sake.
      const person = representativePerson(groups, w.month, hashSeed(`${seed}:other:person`), false, jobs)
      routines.push({
        id: `${home.id}:other:${w.month}`,
        home: home.id,
        stratum: person?.stratum ?? 'laborer',
        weight: residual,
        age: person ? String(person.age) : 'unrecorded',
        sex: person?.sex ?? 'female',
        activities: [
          { hour: 0, label: 'At home / local activity', site: home.id },
          { hour: 10, label: 'Visit local market', site: `market:${home.pool}` },
          { hour: 12, label: 'At home / local activity', site: home.id },
        ],
      })
    }
  }
  const nodes = queryAdaptiveLeaves(w, b).filter(
    (n) =>
      n.bounds.x < b.x + b.size &&
      n.bounds.x + n.bounds.size > b.x &&
      n.bounds.y < b.y + b.size &&
      n.bounds.y + n.bounds.size > b.y,
  )
  // Include the bounded routine destinations even when outside the selected viewport.
  const geometry = new Map(selected.map((site) => [site.id, site]))
  for (const routine of routines)
    for (const activity of routine.activities) {
      const site = w.adaptive.sites[activity.site]
      if (site) geometry.set(site.id, site)
    }
  return {
    request: request.id,
    revision: w.adaptive.revision,
    month: w.month,
    bounds: { ...b },
    population: people,
    representedWorkers: members.reduce((sum, s) => sum + (firmJobs.get(s.entity) ?? 0), 0),
    capacity: members.filter((s) => s.kind === 'residential').reduce((sum, s) => sum + s.capacity, 0),
    jurisdictions: activeJurisdictions(w)
      .filter((j) => j.cells.some((c) => memberCells.has(c)))
      .map(({ id, name, level }) => ({ id, name, level })),
    sites: [...geometry.values()].map((s) => ({
      id: s.id,
      kind: s.kind,
      x: s.x,
      y: s.y,
      capacity: s.capacity,
      residents: counts(s),
      jobs: firmJobs.get(s.entity) ?? 0,
    })),
    routines,
    totalSites: members.length,
    sampled: selected.length < members.length,
    nodes: nodes
      .filter((_, i) => i % Math.max(1, Math.ceil(nodes.length / limit)) === 0)
      .map(({ id, bounds, population, jobs }) => ({ id, bounds: { ...bounds }, population, jobs })),
  }
}
export function inspectionAround(w: World, cell: number, radius = 1500): SpatialBounds {
  const p = cellPosition(w, cell)
  return { x: p.x - radius, y: p.y - radius, size: radius * 2 }
}
