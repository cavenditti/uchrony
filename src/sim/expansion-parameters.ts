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

export const EXPANSION_PROFILES = {
  baseline: {
    economicWeight: 1,
    peerWeight: 0,
    pioneerPeople: 200,
    homeReserve: 600,
    homeFoodMonths: 1.5,
    range: 24,
    reviewMonths: 6,
    sitesPerProvince: 1,
    minimumFood: 0.85,
    minimumStability: 40,
    savingShare: 0,
    developmentShare: 0,
    accessionMonths: 120,
    mandateMonths: 36,
    influenceRate: 0.015,
    prosperityMonths: 60,
    militaryDrive: 0,
    enterprisePopulation: 500,
    enterpriseEquity: 1,
    charterWealthPerPerson: 0.012,
    charterCapitalPerPerson: 0.001,
    charterMinimumCapital: 1,
    urbanOpportunityPopulation: 0,
  },
  economic: {
    economicWeight: 1.8,
    peerWeight: 0.45,
    pioneerPeople: 200,
    homeReserve: 500,
    homeFoodMonths: 1,
    range: 28,
    reviewMonths: 6,
    sitesPerProvince: 4,
    minimumFood: 0.85,
    minimumStability: 40,
    savingShare: 0.08,
    developmentShare: 0.1,
    accessionMonths: 96,
    mandateMonths: 30,
    influenceRate: 0.02,
    prosperityMonths: 48,
    militaryDrive: 0.15,
    enterprisePopulation: 100,
    enterpriseEquity: 0.1,
    charterWealthPerPerson: 0.004,
    charterCapitalPerPerson: 0.0004,
    charterMinimumCapital: 0.4,
    urbanOpportunityPopulation: 50000,
  },
  competitive: {
    economicWeight: 2.2,
    peerWeight: 0.8,
    pioneerPeople: 160,
    homeReserve: 400,
    homeFoodMonths: 0.75,
    range: 32,
    reviewMonths: 6,
    sitesPerProvince: 6,
    minimumFood: 0.82,
    minimumStability: 38,
    savingShare: 0.15,
    developmentShare: 0.2,
    accessionMonths: 72,
    mandateMonths: 24,
    influenceRate: 0.025,
    prosperityMonths: 48,
    militaryDrive: 0.3,
    enterprisePopulation: 80,
    enterpriseEquity: 0.05,
    charterWealthPerPerson: 0.003,
    charterCapitalPerPerson: 0.0003,
    charterMinimumCapital: 0.3,
    urbanOpportunityPopulation: 50000,
  },
  expansionist: {
    economicWeight: 3,
    peerWeight: 1.2,
    pioneerPeople: 120,
    homeReserve: 300,
    homeFoodMonths: 0.5,
    range: 40,
    reviewMonths: 3,
    sitesPerProvince: 8,
    minimumFood: 0.78,
    minimumStability: 35,
    savingShare: 0.25,
    developmentShare: 0.3,
    accessionMonths: 48,
    mandateMonths: 18,
    influenceRate: 0.035,
    prosperityMonths: 36,
    militaryDrive: 0.5,
    enterprisePopulation: 60,
    enterpriseEquity: 0.025,
    charterWealthPerPerson: 0.0025,
    charterCapitalPerPerson: 0.00025,
    charterMinimumCapital: 0.25,
    urbanOpportunityPopulation: 50000,
  },
} satisfies Record<string, ExpansionParameters>
export type ExpansionProfile = keyof typeof EXPANSION_PROFILES
// Selected after the paired-seed evaluation; the baseline remains reproducible.
export const DEFAULT_EXPANSION_PROFILE: ExpansionProfile = 'expansionist'
let current: Readonly<ExpansionParameters> = EXPANSION_PROFILES[DEFAULT_EXPANSION_PROFILE]
export const expansionParameters = () => current
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
