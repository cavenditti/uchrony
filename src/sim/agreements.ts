import { sameSovereign } from './state-dependencies'
import { institutionEligible } from './institution-lifecycle'
import { relation } from './types'
import { sharedInstitution } from './institutions'
import { borderPolicy, MILITARY_LEVEL, type MilitaryPermission } from './border-policy'
import type { World } from './types'
import type { DiplomaticClause } from './statecraft-types'

export function currentAgreements(world: World) {
  return (
    world.statecraft?.offers.filter(
      (offer) => offer.status === 'ratified' && (offer.ends === 0 || offer.ends > world.month),
    ) ?? []
  )
}
export function agreementTerms(world: World, kind?: DiplomaticClause['kind']) {
  return currentAgreements(world).flatMap((offer) =>
    offer.resolved
      .filter(
        (term) =>
          (!kind || term.kind === kind) && (!term.duration || offer.activated + term.duration > world.month),
      )
      .map((term) => ({ offer, term })),
  )
}
/** Access is directional and can be limited to named host provinces. */
export function diplomaticAccess(
  world: World,
  traveler: number,
  host: number,
  purpose: MilitaryPermission = 'transit',
  region?: number,
) {
  return diplomaticAccessView(world)(traveler, host, purpose, region)
}
/** Index grants once per phase. War and a host's explicit policy override every grant. */
export function diplomaticAccessView(world: World) {
  const grants = new Map<number, Map<number, { level: number; regions: readonly number[] }[]>>()
  const relations = new Map<number, Map<number, World['relations'][number]>>()
  for (const rel of world.relations)
    for (const [a, b] of [
      [rel.a, rel.b],
      [rel.b, rel.a],
    ]) {
      if (!relations.has(a)) relations.set(a, new Map())
      relations.get(a)!.set(b, rel)
    }
  const allow = (traveler: number, host: number, level = 3, regions: readonly number[] = []) => {
    if (!grants.has(traveler)) grants.set(traveler, new Map())
    const hosts = grants.get(traveler)!
    if (!hosts.has(host)) hosts.set(host, [])
    hosts.get(host)!.push({ level, regions })
  }
  for (const { term } of agreementTerms(world)) {
    if (term.kind === 'access' || term.kind === 'transit' || term.kind === 'basing')
      allow(
        term.to,
        term.from,
        term.kind === 'basing' ? 3 : term.kind === 'access' ? 2 : 1,
        term.regions ?? [],
      )
    else if (term.kind === 'alliance') {
      allow(term.from, term.to)
      allow(term.to, term.from)
    }
  }
  for (const body of world.institutions?.organizations ?? [])
    if (body.status !== 'dissolved' && body.charter.powers.includes('defense')) {
      const members = body.members.filter((id) => institutionEligible(world, body, id))
      for (const traveler of members) for (const host of members) allow(traveler, host)
    }
  return (traveler: number, host: number, purpose: MilitaryPermission = 'transit', region?: number) => {
    if (host === -1 || traveler === host) return true
    const rel = relations.get(traveler)?.get(host)
    if (rel?.treaty === 'war') return false
    const policy = borderPolicy(rel, host).military
    const required = MILITARY_LEVEL[purpose]
    if (policy !== 'treaties') return MILITARY_LEVEL[policy] >= required
    if (rel?.treaty === 'alliance' || sameSovereign(world, traveler, host)) return true
    return (
      grants
        .get(traveler)
        ?.get(host)
        ?.some(
          (grant) =>
            grant.level >= required &&
            (!grant.regions.length || (region !== undefined && grant.regions.includes(region))),
        ) ?? false
    )
  }
}
export function preferentialTrade(world: World, a: number, b: number) {
  const rel = relation(world, a, b)
  if (
    rel?.treaty === 'war' ||
    borderPolicy(rel, a).trade !== 'normal' ||
    borderPolicy(rel, b).trade !== 'normal'
  )
    return false
  if (sharedInstitution(world, a, b, 'trade')) return true
  return agreementTerms(world).some(
    ({ term }) =>
      ['trade', 'preferential-trade', 'alliance'].includes(term.kind) &&
      [term.from, term.to].includes(a) &&
      [term.from, term.to].includes(b),
  )
}
