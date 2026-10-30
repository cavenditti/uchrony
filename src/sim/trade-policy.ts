/** Both market resolutions share bilateral restrictions and whole-route checks.
 * Neutral waypoints cannot bypass an embargo on the actual buyer or seller. */
import { agreementTerms } from './agreements'
import { borderPolicy } from './border-policy'
import { institutionEligible } from './institution-lifecycle'
import type { Good, RouteLeg, World } from './types'

/** Index bilateral access once, avoiding a relation scan for every price comparison. */
export function tradePolicy(w: World) {
  const count = w.nations.length,
    tariffs = new Float64Array(count * count),
    restriction = new Uint8Array(count * count),
    constrained = new Uint8Array(count),
    preference = new Float64Array(count * count).fill(1)
  const prefer = (a: number, b: number, factor: number) => {
    preference[a * count + b] = Math.min(preference[a * count + b], factor)
    preference[b * count + a] = Math.min(preference[b * count + a], factor)
  }
  for (const { term } of agreementTerms(w))
    if (term.kind === 'trade' || term.kind === 'alliance' || term.kind === 'preferential-trade')
      prefer(term.from, term.to, term.kind === 'preferential-trade' ? 0.5 : 0)
  for (const body of w.institutions?.organizations ?? [])
    if (body.charter.powers.includes('trade')) {
      const members = body.members.filter((id) => institutionEligible(w, body, id))
      for (const a of members) for (const b of members) prefer(a, b, 0)
    }
  const treaties = w.nations.map(() => new Map<number, string>())
  for (const rel of w.relations) {
    treaties[rel.a].set(rel.b, rel.treaty)
    treaties[rel.b].set(rel.a, rel.treaty)
    const a = borderPolicy(rel, rel.a).trade,
      b = borderPolicy(rel, rel.b).trade
    const closed = rel.treaty === 'war' || a === 'embargo' || b === 'embargo'
    const value = closed ? 2 : a === 'restricted' || b === 'restricted' ? 1 : 0
    restriction[rel.a * count + rel.b] = restriction[rel.b * count + rel.a] = value
    if (value) constrained[rel.a] = constrained[rel.b] = 1
    if (rel.treaty === 'trade' || rel.treaty === 'alliance') prefer(rel.a, rel.b, 0)
  }
  const treaty = (a: number, b: number) => treaties[a]?.get(b)
  for (let a = 0; a < count; a++)
    for (let b = 0; b < count; b++) {
      if (a === b) continue
      const at = a * count + b
      // Restrictions restore normal duties plus a 25-point surcharge.
      tariffs[at] =
        (w.nations[a].policies.tariff / 100) * (restriction[at] ? 1 : preference[at]) +
        (restriction[at] === 1 ? 0.25 : 0)
    }
  const level = (a: number, b: number) => (a < 0 || b < 0 || a === b ? 0 : restriction[a * count + b])
  const allowed = (a: number, b: number, good?: Good) =>
    level(a, b) < 2 && !(good === 'arms' && level(a, b) === 1)
  const unrestricted = (a: number, b = a) => !constrained[a] && !constrained[b]
  // Political ownership is fixed during a clearing phase; scan each physical
  // path once rather than re-reading every cell for every traded commodity.
  const hosts = new WeakMap<RouteLeg[], number[]>()
  const routeHosts = (legs: RouteLeg[]) => {
    let found = hosts.get(legs)
    if (!found) {
      const ids = new Set<number>()
      for (const leg of legs)
        for (const cell of leg.cells) {
          const r = w.regions[w.cells[cell]?.region]
          if (w.cells[cell]?.terrain !== 'water' && r) ids.add(r.control?.nation ?? r.nation)
        }
      found = [...ids]
      hosts.set(legs, found)
    }
    return found
  }
  return {
    treaty,
    allowed,
    unrestricted,
    routeAllowed: (a: number, b: number, legs: RouteLeg[], good?: Good) =>
      unrestricted(a, b) ||
      (allowed(a, b, good) &&
        routeHosts(legs).every((host) => allowed(a, host, good) && allowed(b, host, good))),
    restricted: (a: number, b: number) => level(a, b) === 1,
    routeRestricted: (a: number, b: number, legs: RouteLeg[]) =>
      !unrestricted(a, b) &&
      (level(a, b) === 1 || routeHosts(legs).some((host) => level(a, host) === 1 || level(b, host) === 1)),
    tariff: (buyer: number, seller: number) =>
      buyer < 0 ? 0 : seller < 0 ? w.nations[buyer].policies.tariff / 100 : tariffs[buyer * count + seller],
  }
}
