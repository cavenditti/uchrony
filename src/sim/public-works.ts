import { parameterGroup } from './configuration-context'
import { governance } from './governance'
import { population, type World, type Good } from './types'
import { publicExpense } from './ledger'
import { marketStore, recordUse } from './national-accounts'
import { transportNetwork } from './transport'
import { economicRegions, provinceId } from './local-units'
import { event } from './simulation-events'

export const TRANSPORT_PROJECTS = parameterGroup('transportProjects')
export type TransportProject = keyof typeof TRANSPORT_PROJECTS
export const PUBLIC_WORKS = ['road', 'school', 'paved-road', 'railway', 'port'] as const
export type PublicWork = (typeof PUBLIC_WORKS)[number]

/** A quote is read-only and shared by player commands, cabinet and agent menus. */
export function publicWorkQuote(w: World, region: number, kind: PublicWork) {
  const r = w.regions[region]
  const p =
    kind === 'road' || kind === 'school'
      ? { cost: kind === 'road' ? 600 : 500, timber: 50, stone: 70, iron: 0, tools: 0, technology: 0 }
      : TRANSPORT_PROJECTS[kind]
  const n = w.nations[r?.nation]
  let obstacle = ''
  if (!n || n.extinct !== undefined || r.control)
    obstacle = 'Construction requires a controlled home province.'
  else if (n.technologies.logistics < p.technology)
    obstacle = `Transport works require logistics level ${p.technology}.`
  else if (kind === 'port' && !transportNetwork(w).harbors.some((h) => h.region === r.id))
    obstacle = 'Harbor docks require an accessible coastal port.'
  else if (
    kind === 'road'
      ? r.infrastructure >= 1.5
      : kind === 'school'
        ? r.literacy >= 0.99
        : kind === 'port'
          ? (r.publicWorks?.harbor ?? 0) >= 3
          : r.publicWorks?.road === 'rail' || (kind === 'paved-road' && r.publicWorks?.road === 'paved')
  )
    obstacle = 'This improvement is already complete.'
  else if (n.treasury < p.cost) obstacle = `Construction requires ${p.cost}k crowns in the treasury.`
  else if ((['timber', 'stone', 'iron', 'tools'] as const).some((g) => r.stocks[g] < p[g]))
    obstacle = 'Construction requires sufficient timber, stone, iron and tools in the provincial depot.'
  return { ...p, obstacle }
}

/** Relative local benefit per crown, used to rank feasible public investments.
 * These are decision utilities, not promised yields or additions to GDP. */
export function publicWorkValue(w: World, region: number, kind: PublicWork, cost: number) {
  const r = w.regions[region],
    n = w.nations[r.nation]
  const benefit =
    kind === 'school'
      ? (1 - r.literacy) * (1 + (n.character?.effective.openness ?? 0.5))
      : kind === 'road'
        ? Math.max(0, 1.5 - r.infrastructure)
        : kind === 'port'
          ? 0.8
          : kind === 'railway'
            ? 1.2
            : 0.9
  return (population(r) * benefit) / cost
}

/** Paid local improvements propagate to district signals so aggregation cannot
 * erase a road or school on the following tick. Materials are consumed once. */
export function buildPublicWork(w: World, region: number, kind: PublicWork) {
  if (kind !== 'road' && kind !== 'school') return buildTransport(w, region, kind)
  const q = publicWorkQuote(w, region, kind)
  if (q.obstacle) return q.obstacle
  const r = w.regions[region],
    n = governance(w, r.nation)
  publicExpense(w, n.id, q.cost, 'public construction', r.id)
  for (const good of ['timber', 'stone'] as const) {
    recordUse(w, marketStore(r.id), good, q[good])
    r.stocks[good] -= q[good]
    r.consumption[good] += q[good]
  }
  const units = new Set([r, ...economicRegions(w).filter((u) => provinceId(u) === region)])
  const groups = new Set([...units].flatMap((u) => u.communities ?? []))
  for (const unit of units) {
    if (kind === 'road') unit.infrastructure = Math.min(1.5, unit.infrastructure + 0.2)
    else unit.literacy = Math.min(0.99, unit.literacy + 0.08)
  }
  if (kind === 'road') {
    r.publicWorks = { ...r.publicWorks, road: r.publicWorks?.road ?? 'gravel' }
    // The district values already include this political change; prevent the
    // next linkDistrictPeople pass from applying the provincial delta twice.
    const signal = w.localEconomy?.provinceSignals?.[r.id]
    if (signal) signal.infrastructure = r.infrastructure
  } else for (const group of groups) group.literacy = Math.min(0.99, group.literacy + 0.08)
  event(
    w,
    'economy',
    `${r.name} invests in ${kind === 'road' ? 'transport' : 'education'}`,
    `The project uses ${q.cost}k crowns, ${q.timber} t timber, and ${q.stone} t stone.`,
    n.id,
    r.id,
  )
  return `Investment completed in ${r.name}.`
}

/** Apply a prevalidated transport recipe to the existing provincial network. */
export function buildTransport(w: World, region: number, kind: TransportProject) {
  const quote = publicWorkQuote(w, region, kind)
  if (quote.obstacle) return quote.obstacle
  const r = w.regions[region],
    p = TRANSPORT_PROJECTS[kind],
    n = governance(w, r.nation)
  const goods = ['timber', 'stone', 'iron', 'tools'] as const
  publicExpense(w, n.id, p.cost, 'public transport construction', r.id)
  for (const g of goods) {
    recordUse(w, marketStore(r.id), g as Good, p[g])
    r.stocks[g] -= p[g]
    r.consumption[g] += p[g]
  }
  r.publicWorks = {
    ...r.publicWorks,
    ...(kind === 'port'
      ? { harbor: (r.publicWorks?.harbor ?? 0) + 1 }
      : { road: kind === 'railway' ? ('rail' as const) : ('paved' as const) }),
  }
  return `${p.label} completed in ${r.name}. Existing transport corridors now use the improvement.`
}
