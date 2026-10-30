/** Founding and voyages move the same dated households, assets and liabilities.
 * Counts are apportioned once from opening census shares, including housing. */
import { apportion } from './allocation'
import { extractAges } from './age-cohorts'
import { relocateHouseholdClaims } from './district-finance'
import { STRATA, type EconomicStratum } from './economic-types'
import { balance, householdAccount, transfer } from './ledger'
import { addCommunity, communitySize, rollupPopulation } from './population'
import type { PopulationCommunity } from './population-types'
import { residentialSites } from './residential-sites'
import { type Region, type World } from './types'

/** Remove people and their proportional property into an existing receiver. */
export function departSettlers(
  w: World,
  source: Region,
  people: number,
  receiver: (s: EconomicStratum) => string,
) {
  const groups = source.communities!
  const counts = apportion(people, groups.map(communitySize))
  const before = STRATA.map((s) =>
    groups.reduce((sum, g) => sum + ((g.stratum ?? 'laborer') === s ? communitySize(g) : 0), 0),
  )
  const moved = STRATA.map(() => 0)
  const communities: PopulationCommunity[] = []
  groups.forEach((group, i) => {
    if (!counts[i]) return
    const ages = apportion(counts[i], [
      group.population.children,
      group.population.adults,
      group.population.elders,
    ])
    const incoming = extractAges(group, { children: ages[0], adults: ages[1], elders: ages[2] })
    incoming.rootedness *= 0.65
    moved[STRATA.indexOf(group.stratum ?? 'laborer')] += counts[i]
    communities.push(incoming)
  })
  const moves = STRATA.map((s, i) => ({
    from: householdAccount(source.id, s),
    to: receiver(s),
    fraction: moved[i] / Math.max(1, before[i]),
  }))
  relocateHouseholdClaims(w, moves)
  for (const move of moves)
    transfer(w, move.from, move.to, balance(w, move.from) * move.fraction, 'settler household assets')
  const homes = residentialSites(w).filter((s) => s.pool === source.id)
  const departures = apportion(
    people,
    homes.map((s) => s.residents ?? 0),
    homes.map((s) => s.residents ?? 0),
  )
  homes.forEach((s, i) => {
    s.residents! -= departures[i]
  })
  source.migration -= people
  source.populationDynamics!.emigrants += people
  rollupPopulation(source)
  return communities
}

/** Arrival retains ancestry and citizenship; host jurisdiction remains separate. */
export function receiveSettlers(w: World, target: Region, communities: PopulationCommunity[]) {
  const people = communities.reduce((sum, g) => sum + communitySize(g), 0)
  for (const group of communities) {
    group.locality = target.id
    group.host = target.nation
    addCommunity(target.communities!, group)
  }
  target.migration += people
  target.populationDynamics!.immigrants += people
  w.totals.migration += people
  rollupPopulation(target)
  return people
}

/** Return all surviving household claims; empty strata still have heirs. */
export function settleExpeditionAccounts(w: World, target: Region, account: (s: EconomicStratum) => string) {
  const moves = STRATA.map((s) => ({ from: account(s), to: householdAccount(target.id, s), fraction: 1 }))
  relocateHouseholdClaims(w, moves)
  for (const move of moves)
    transfer(w, move.from, move.to, balance(w, move.from), 'settler household arrival')
}
