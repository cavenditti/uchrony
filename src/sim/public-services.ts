import type { Region, World } from './types'
import { economicRegions, provinceId } from './local-units'

/** Base-wage-valued labor actually bought this month, including delegated shares. */
export function realService(
  w: World,
  r: Region,
  kind: 'education' | 'administration' | 'infrastructure' | 'research' | 'military' | 'policing',
): number {
  const p = w.economy?.producers[r.id]
  if (!p) return 0
  const d = w.regions[provinceId(r)].delegation
  const local =
    kind === 'administration'
      ? (p.provincialServices ?? 0) * 0.1
      : (kind === 'education' || kind === 'infrastructure' || kind === 'policing') && d?.powers.includes(kind)
        ? ((p.provincialServices ?? 0) * 0.9) / Math.max(1, d.powers.filter((x) => x !== 'taxation').length)
        : 0
  return local + (kind === 'policing' ? 0 : (p[`${kind}Services`] ?? 0))
}
export function provincialRealService(w: World, r: Region, kind: 'policing' | 'administration') {
  return w.localEconomy
    ? economicRegions(w)
        .filter((u) => u.province === r.id)
        .reduce((sum, u) => sum + realService(w, u, kind), 0)
    : realService(w, r, kind)
}

export function nationalRealService(w: World, nation: number, kind: 'research' | 'administration') {
  return economicRegions(w)
    .filter((r) => r.nation === nation)
    .reduce((sum, r) => sum + realService(w, r, kind), 0)
}

/** Agreements run before this month's production, so they share last month's output. */
export function previousResearchOutput(w: World, nation: number) {
  return economicRegions(w)
    .filter((r) => r.nation === nation)
    .reduce((sum, r) => sum + (w.economy?.producers[r.id]?.previousResearchServices ?? 0), 0)
}
