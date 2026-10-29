import { DEFAULT_CONFIGURATION_VALUES, type ConfigurationValues } from './configuration-defaults'
import { BIOMES, CROPS } from './climate-types'
import { configurationHelp } from './configuration-help'

export const CONFIGURATION_GROUPS: Record<keyof ConfigurationValues, { label: string; description: string }> =
  {
    starting: {
      label: 'Starting conditions',
      description: 'Opening cash, people and resources given to states when the world is created.',
    },
    geography: { label: 'Geography', description: 'Creation only. Relief, climate and province layout.' },
    founding: {
      label: 'Settlement expedition costs',
      description:
        'Resources spent to found new settlements during play. These are costs, not opening state endowments.',
    },
    frontierPolitics: {
      label: 'Frontier politics',
      description: 'City charters, solvency, household contributions and enclosed land claims.',
    },
    consumptionBudget: {
      label: 'Consumption budget',
      description: 'Relative household spending weights; at least one must remain positive.',
    },
    materialCoverage: {
      label: 'Material coverage',
      description: 'Relative weights used to combine material coverage; at least one must remain positive.',
    },
    basePrices: {
      label: 'Opening prices',
      description: 'Creation only. Initial nominal prices, in crowns per tonne.',
    },
    householdNeeds: {
      label: 'Household consumption',
      description: 'Monthly tonnes per person before living-standard adjustments.',
    },
    wageSkills: {
      label: 'Wage differentials',
      description: 'Relative wage multipliers by economic stratum.',
    },
    recipes: {
      label: 'Production recipes',
      description: 'Tonnes of inputs required per tonne of manufactured output.',
    },
    conditions: {
      label: 'World pressures',
      description: 'Resource abundance, disturbances and political extremes.',
    },
    climate: {
      label: 'Climate & biomes',
      description: 'Annual temperature, growing seasons, and an exhaustive biome matrix.',
    },
    model: {
      label: 'Population & economy',
      description: 'Demography, labor, firms and banking. Monthly rates are fractions per month.',
    },
    decisions: {
      label: 'Government decisions',
      description: 'Behavioral weights and enabled mechanisms; no extra people or assets.',
    },
    expansion: {
      label: 'Settlement & expansion',
      description: 'Requirements and incentives for founding, development and accession.',
    },
    monetary: {
      label: 'Monetary policy',
      description: 'Annual rate targets and responses. Existing observations are retained.',
    },
    settlements: {
      label: 'Urban settlement',
      description: 'Classification thresholds, moving friction and accessibility.',
    },
    urbanIntegration: {
      label: 'City integration',
      description: 'Time and relative wealth needed for incorporation and merger.',
    },
    farming: {
      label: 'Agriculture',
      description: 'Materials, labor and duration for future funded improvements.',
    },
    transportProjects: {
      label: 'Transport construction',
      description: 'Resource and technology requirements for new public works.',
    },
    tradeMemory: {
      label: 'Trade memory',
      description: 'How quickly established freight relationships adjust.',
    },
    corridors: { label: 'Trade corridors', description: 'Learning, decay and route review intervals.' },
    corridorBundling: {
      label: 'Shared corridors',
      description: 'Bounds for sharing nearby routes and accepting detours.',
    },
    roads: { label: 'Road networks', description: 'Development gates and permitted road detours.' },
    shipping: { label: 'Shipping networks', description: 'Permitted sailing detours and shortcuts.' },
    harbors: { label: 'Harbor activity', description: 'Memory and decay of observed harbor throughput.' },
    riverRoads: {
      label: 'River crossings',
      description: 'Distances in metres for future bridge and bank surveys.',
    },
  }
export interface ConfigurationField {
  path: string
  group: keyof ConfigurationValues
  label: string
  kind: 'number' | 'boolean' | 'select'
  min?: number
  max?: number
  integer?: boolean
  options?: readonly string[]
  creationOnly: boolean
  description: string
  unit?: string
}
const bounds: Record<string, [number, number, boolean?]> = {
  'conditions.instability': [0, 3],
  'conditions.abundance': [0.35, 1.6],
  'conditions.extremity': [0, 2],
  'geography.erosionPasses': [1, 48, true],
  'geography.channelRunoff': [1, 1000],
  'settlements.searchMeters': [100, 12000],
  'riverRoads.buildingSetback': [0, 100],
  'founding.people': [1, 10000, true],
  'founding.reserve': [0, 100000, true],
  'founding.cash': [0, 1e6],
  'founding.food': [0, 1e6],
  'founding.timber': [0, 1e6],
  'founding.stone': [0, 1e6],
  'founding.tools': [0, 1e6],
  'founding.range': [1, 100, true],
  'founding.reserveMonths': [0, 24],
  'frontierPolitics.cityPopulation': [1, 1e6, true],
  'frontierPolitics.solventStability': [0, 100],
  'frontierPolitics.solventLegitimacy': [0, 100],
  'frontierPolitics.solventFood': [0, 2],
  'frontierPolitics.enclaveAreaKm2': [0, 100],
  'geography.seaLevelOffset': [-0.04, 0.04],
  'geography.relief': [0.25, 2],
  'geography.moistureOffset': [-0.4, 0.4],
  'geography.temperatureOffset': [-0.3, 0.3],
  'geography.provinceCount': [0, 1400, true],
  'starting.year': [1, 10000, true],
  'starting.populationScale': [0.1, 10],
  'starting.capitalPopulation': [100, 100000, true],
  'starting.marketPopulation': [0, 100000, true],
  'starting.marketVariation': [0, 100000, true],
  'starting.hamletPopulation': [0, 10000, true],
  'starting.hamletVariation': [0, 10000, true],
  'starting.hamletOneIn': [1, 10000, true],
  'starting.marketOneIn': [1, 10000, true],
  'starting.childrenShare': [0, 0.8],
  'starting.adultShare': [0.1, 1],
  'starting.treasury': [0, 1e9],
  'starting.settledTreasury': [0, 1e9],
  'starting.debt': [0, 1e9],
  'starting.stability': [0, 100],
  'starting.legitimacy': [0, 100],
  'model.openingMaximumAgeMonths': [960, 2400, true],
  'model.elderOpeningDecayYears': [1, 40],
  'monetary.inertia': [0, 0.9999],
  'model.bankCount': [1, 20, true],
  'model.bankCapitalRatio': [0.01, 1],
  'model.policyRateMonthly': [0, 0.1],
  'model.bankLoanSpread': [0, 0.1],
  'model.adultAgeMonths': [120, 360, true],
  'model.retirementAgeMonths': [480, 1200, true],
  'model.maximumAgeMonths': [960, 2400, true],
  'model.femaleBirthShare': [0, 1],
  'model.childFoodEquivalent': [0.1, 2],
  'model.elderFoodEquivalent': [0.1, 2],
  'model.desiredChildrenBase': [0, 12],
  'model.ruralFamilyMotive': [0, 10],
  'model.urbanFamilyCost': [0, 10],
  'model.consumptionRiskAversion': [0.01, 10],
  'model.loanResetMonths': [1, 120, true],
  'model.inventoryMonths': [0.1, 24],
  'model.constructionMonths': [1, 120, true],
  'model.defaultAfterMonths': [1, 120, true],
  'model.fullBuiltPopulationPerCell': [100, 1e6, true],
  'model.ageingHazardSlope': [0, 0.15],
  'model.infrastructureServiceProductivity': [0, 0.1],
  'decisions.foodSatiation': [1, 3],
  'expansion.economicWeight': [0, 10],
  'expansion.peerWeight': [0, 10],
  'expansion.pioneerPeople': [1, 10000, true],
  'expansion.homeReserve': [0, 100000, true],
  'expansion.homeFoodMonths': [0, 24],
  'expansion.range': [1, 100, true],
  'expansion.reviewMonths': [1, 120, true],
  'expansion.sitesPerProvince': [1, 32, true],
  'expansion.minimumFood': [0, 2],
  'expansion.minimumStability': [0, 100],
  'expansion.accessionMonths': [1, 1200, true],
  'expansion.mandateMonths': [1, 1200, true],
  'expansion.prosperityMonths': [1, 1200, true],
  'expansion.enterprisePopulation': [1, 100000, true],
  'expansion.enterpriseEquity': [0, 1000],
  'expansion.charterWealthPerPerson': [0, 10],
  'expansion.charterCapitalPerPerson': [0, 10],
  'expansion.charterMinimumCapital': [0, 10000],
  'expansion.urbanOpportunityPopulation': [0, 1e7, true],
  'climate.equatorTemperature': [-30, 60],
  'climate.latitudeTemperatureDrop': [0, 100],
  'climate.elevationThreshold': [0, 1],
  'climate.elevationLapseRate': [0, 100],
  'climate.seasonPhaseMonth': [0, 11, true],
  'climate.growthMinimum': [0, 2],
  'climate.growthRange': [0.01, 2],
  'monetary.target': [-0.1, 0.5],
  'monetary.neutralRealRate': [-0.1, 0.5],
  'monetary.inflationResponse': [0, 5],
  'monetary.unemploymentResponse': [0, 5],
  'settlements.villagePopulation': [1, 1e6, true],
  'settlements.townPopulation': [2, 1e7, true],
  'settlements.cityPopulation': [3, 1e8, true],
  'settlements.minimumDensity': [1, 1e6],
  'settlements.accessMinutes': [1, 240],
  'urbanIntegration.incorporationMonths': [1, 1200, true],
  'urbanIntegration.mergerMonths': [1, 2400, true],
  'urbanIntegration.prestigeRatio': [1, 10],
  'urbanIntegration.wealthRatio': [1, 10],
  'urbanIntegration.mergerPrestigeRatio': [1, 10],
  'urbanIntegration.mergerWealthRatio': [1, 10],
  'farming.timber': [0, 1000],
  'farming.stone': [0, 1000],
  'farming.laborMonths': [1, 10000],
  'farming.fertility': [0.001, 1],
  'farming.duration': [1, 120, true],
  'tradeMemory.idleMonths': [1, 1200, true],
  'corridors.replanMonths': [1, 120, true],
  'corridors.minimumPathMonths': [1, 1200, true],
  'corridorBundling.radius': [1, 32, true],
  'corridorBundling.minimumSharedEdges': [1, 64, true],
  'corridorBundling.passes': [1, 8, true],
  'roads.maximumDetour': [1, 10],
  'roads.infrastructure': [0, 1.2],
  'roads.logistics': [0, 10, true],
  'roads.shortcutRatio': [1, 10],
  'shipping.maximumDetour': [1, 10],
  'shipping.shortcutRatio': [1, 10],
  'harbors.idleMonths': [1, 1200, true],
  'harbors.halfLifeMonths': [1, 1200],
  'riverRoads.setback': [0, 100],
  'riverRoads.approach': [1, 100],
  'riverRoads.maxSpan': [1, 1000],
  'riverRoads.spacing': [1, 2000],
  'riverRoads.search': [1, 1000],
}
const labels: Record<string, string> = {
  'founding.cash': 'Expedition cash cost',
  'starting.treasury': 'Initial treasury per frontier state',
  'starting.settledTreasury': 'Initial treasury per established state',
}
export const configurationLabel = (key: string) =>
  key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase())
export function configurationValue(values: ConfigurationValues, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], values)
}
export function setConfigurationValue(
  values: ConfigurationValues,
  path: string,
  value: unknown,
): ConfigurationValues {
  const copy = structuredClone(values)
  const keys = path.split('.')
  let target = copy as unknown as Record<string, unknown>
  for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>
  target[keys.at(-1)!] = value
  return copy
}
export const CONFIGURATION_FIELDS: ConfigurationField[] = []
function register(value: unknown, path: string) {
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) register(child, path ? `${path}.${key}` : key)
    return
  }
  if (path === 'model.version' || path.endsWith('.label')) return
  const [group] = path.split('.') as [keyof ConfigurationValues]
  let range = bounds[path]
  if (!range && typeof value === 'number') {
    if (group === 'basePrices') range = [0.01, 100000]
    else if (group === 'wageSkills') range = [0.01, 10]
    else if (group === 'recipes') range = [0.000001, 10]
    else if (path.startsWith('starting.policies.')) range = [0, 100]
    else if (path.startsWith('climate.temperatureThresholds.')) range = [-100, 100]
    else if (path.startsWith('starting.capitalStocks.')) range = [0, 1e7]
    else if (path.startsWith('starting.technology.')) range = [0, 6, true]
    else if (group === 'starting' && path.endsWith('Scale')) range = [0, 5]
    else if (group === 'transportProjects') range = path.endsWith('.technology') ? [0, 8, true] : [0, 1e7]
    else range = [0, 1] // Remaining coefficients are explicitly fractions/probabilities.
  }
  const key = path.startsWith('model.fertilityAnnual.')
    ? `Annual fertility · ages ${15 + Number(path.split('.').at(-1)) * 5}–${19 + Number(path.split('.').at(-1)) * 5}`
    : path.split('.').slice(1).map(configurationLabel).join(' · ')
  CONFIGURATION_FIELDS.push({
    path,
    group,
    label: labels[path] ?? key,
    kind: typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'select',
    ...(range ? { min: range[0], max: range[1], integer: range[2] } : {}),
    ...(typeof value === 'string'
      ? {
          options:
            path === 'starting.policies.migration'
              ? ['open', 'controlled', 'closed']
              : path === 'starting.policies.priority'
                ? ['balanced', 'agriculture', 'industry', 'military']
                : path === 'starting.researchFocus'
                  ? ['agriculture', 'industry', 'medicine', 'logistics', 'military', 'governance']
                  : path.startsWith('climate.crops.')
                    ? CROPS
                    : BIOMES,
        }
      : {}),
    creationOnly:
      group === 'starting' ||
      group === 'geography' ||
      group === 'basePrices' ||
      [
        'model.openingMaximumAgeMonths',
        'model.elderOpeningDecayYears',
        'model.bankCount',
        'model.adultAgeMonths',
        'model.retirementAgeMonths',
        'model.fullBuiltPopulationPerCell',
      ].includes(path),
    description: configurationHelp(path),
    unit:
      path.startsWith('climate.temperatureThresholds.') ||
      ['climate.equatorTemperature', 'climate.latitudeTemperatureDrop'].includes(path)
        ? '°C'
        : path === 'climate.elevationLapseRate'
          ? '°C / elevation unit'
          : ['founding.cash', 'starting.treasury', 'starting.settledTreasury', 'starting.debt'].includes(path)
            ? 'thousand crowns'
            : undefined,
  })
}
register(DEFAULT_CONFIGURATION_VALUES, '')
