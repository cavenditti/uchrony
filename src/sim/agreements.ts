import { sharedInstitution } from './institutions'
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
export function diplomaticAccess(world: World, traveler: number, host: number) {
  if (sharedInstitution(world, traveler, host, 'defense')) return true
  return agreementTerms(world).some(
    ({ term }) =>
      (term.kind === 'alliance' &&
        [term.from, term.to].includes(traveler) &&
        [term.from, term.to].includes(host)) ||
      (term.kind === 'access' && term.from === host && term.to === traveler),
  )
}
export function preferentialTrade(world: World, a: number, b: number) {
  if (sharedInstitution(world, a, b, 'trade')) return true
  return agreementTerms(world).some(
    ({ term }) =>
      ['trade', 'alliance'].includes(term.kind) &&
      [term.from, term.to].includes(a) &&
      [term.from, term.to].includes(b),
  )
}
