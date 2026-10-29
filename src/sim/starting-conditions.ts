import { DEFAULT_CONFIGURATION_VALUES, type ConfigurationValues } from './configuration-defaults'
import { GOODS, clamp, population, type Nation, type Region } from './types'

export function apportionPopulation(
  people: number,
  opening: Pick<ConfigurationValues['starting'], 'childrenShare' | 'adultShare'>,
) {
  const children = Math.floor(people * opening.childrenShare)
  const adults = Math.floor(people * opening.adultShare)
  return { children, adults, elders: people - children - adults }
}

const REGION_SCALES = [
  ['urban', 'urbanScale', 1],
  ['literacy', 'literacyScale', 1],
  ['health', 'healthScale', 1],
  ['happiness', 'happinessScale', 1],
  ['infrastructure', 'infrastructureScale', 1.2],
  ['industry', 'industryScale', 1.2],
] as const

/** Apply a scenario once, before cohorts, bank accounts and firms are created.
 * Multipliers retain the generated spatial differences. Counts are apportioned
 * with the remainder in elders so no person disappears through age rounding. */
export function applyStartingEndowments(
  regions: Region[],
  nations: Nation[],
  start: 'settled' | 'frontier',
  opening: ConfigurationValues['starting'],
) {
  const defaults = DEFAULT_CONFIGURATION_VALUES.starting
  const customDemographics =
    opening.populationScale !== 1 ||
    opening.childrenShare !== defaults.childrenShare ||
    opening.adultShare !== defaults.adultShare

  for (const region of regions) {
    if (customDemographics) {
      region.population = apportionPopulation(
        Math.round(population(region) * opening.populationScale),
        opening,
      )
    }
    for (const [field, scaleKey, max] of REGION_SCALES) {
      region[field] = clamp(region[field] * opening[scaleKey], 0, max)
    }
    for (const good of GOODS) region.stocks[good] *= opening.stockpileScale
  }
  for (const nation of nations) {
    nation.ai = opening.ai
    nation.treasury = start === 'frontier' ? opening.treasury : opening.settledTreasury
    nation.debt = opening.debt
    nation.stability = opening.stability
    nation.legitimacy = opening.legitimacy
    nation.technologies = { ...opening.technology }
  }
}
