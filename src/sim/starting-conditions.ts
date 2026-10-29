import { DEFAULT_CONFIGURATION_VALUES, type ConfigurationValues } from './configuration-defaults'
import { GOODS, clamp, population, type Nation, type Region } from './types'

/** Apply a scenario once, before cohorts, bank accounts and firms are created.
 * Multipliers retain the generated spatial differences. Counts are apportioned
 * with the remainder in elders so no person disappears through age rounding. */
export function applyStartingEndowments(
  regions: Region[],
  nations: Nation[],
  start: 'settled' | 'frontier',
  opening: ConfigurationValues['starting'],
) {
  for (const region of regions) {
    if (
      opening.populationScale !== 1 ||
      opening.childrenShare !== DEFAULT_CONFIGURATION_VALUES.starting.childrenShare ||
      opening.adultShare !== DEFAULT_CONFIGURATION_VALUES.starting.adultShare
    ) {
      const people = Math.round(population(region) * opening.populationScale)
      const children = Math.floor(people * opening.childrenShare)
      const adults = Math.floor(people * opening.adultShare)
      region.population = { children, adults, elders: people - children - adults }
    }
    for (const [field, scale] of [
      ['urban', opening.urbanScale],
      ['literacy', opening.literacyScale],
      ['health', opening.healthScale],
      ['happiness', opening.happinessScale],
      ['infrastructure', opening.infrastructureScale],
      ['industry', opening.industryScale],
    ] as const)
      region[field] = clamp(
        region[field] * scale,
        0,
        field === 'industry' || field === 'infrastructure' ? 1.2 : 1,
      )
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
