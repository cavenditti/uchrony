import { parameterGroup } from './configuration-context'
import { governance } from './governance'
import type { World, Good } from './types'
import { publicExpense } from './ledger'
import { marketStore, recordUse } from './national-accounts'
import { transportNetwork } from './transport'

export const TRANSPORT_PROJECTS = parameterGroup('transportProjects')
export type TransportProject = keyof typeof TRANSPORT_PROJECTS
export function buildTransport(w: World, region: number, kind: TransportProject) {
  const r = w.regions[region],
    p = TRANSPORT_PROJECTS[kind],
    n = governance(w, r.nation)
  if (n.technologies.logistics < p.technology) return `${p.label} require logistics level ${p.technology}.`
  if (kind === 'port' && !transportNetwork(w).harbors.some((h) => h.region === r.id))
    return 'Harbor docks require an accessible coastal port.'
  if (
    kind === 'port'
      ? (r.publicWorks?.harbor ?? 0) >= 3
      : r.publicWorks?.road === 'rail' || (kind === 'paved-road' && r.publicWorks?.road === 'paved')
  )
    return 'This transport improvement is already complete.'
  if (n.treasury < p.cost) return `${p.label} require ${p.cost}k crowns.`
  const goods = ['timber', 'stone', 'iron', 'tools'] as const
  if (goods.some((g) => r.stocks[g] < p[g]))
    return `${p.label} require ${goods
      .filter((g) => p[g])
      .map((g) => `${p[g]} t ${g}`)
      .join(', ')} in the provincial depot.`
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
