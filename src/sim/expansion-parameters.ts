import { configurationValues } from './configuration-context'
/** Synthetic behavioral coefficients. Scenarios are compared with identical
 * opening worlds; no profile supplies extra people, goods or money. */
export interface ExpansionParameters {
  economicWeight: number
  peerWeight: number
  pioneerPeople: number
  homeReserve: number
  homeFoodMonths: number
  range: number
  reviewMonths: number
  sitesPerProvince: number
  minimumFood: number
  minimumStability: number
  savingShare: number
  developmentShare: number
  accessionMonths: number
  mandateMonths: number
  influenceRate: number
  prosperityMonths: number
  militaryDrive: number
  enterprisePopulation: number
  enterpriseEquity: number
  charterWealthPerPerson: number
  charterCapitalPerPerson: number
  charterMinimumCapital: number
  urbanOpportunityPopulation: number
}

import { EXPANSION_PROFILES } from './configuration-defaults'
export { EXPANSION_PROFILES } from './configuration-defaults'
export type ExpansionProfile = keyof typeof EXPANSION_PROFILES
// Selected after the paired-seed evaluation; the baseline remains reproducible.
export const DEFAULT_EXPANSION_PROFILE: ExpansionProfile = 'expansionist'
let current: Readonly<ExpansionParameters> | undefined
export const expansionParameters = () => current ?? configurationValues().expansion
/** Synchronous experiment scope, like simulation-period. It never modifies a
 * world's opening balances, persisted policies, or another experiment's defaults. */
export function withExpansionParameters<T>(parameters: Readonly<ExpansionParameters>, run: () => T): T {
  const previous = current
  current = parameters
  try {
    return run()
  } finally {
    current = previous
  }
}
