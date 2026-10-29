import { DEFAULT_CONFIGURATION_VALUES, type ConfigurationValues } from './configuration-defaults'
import { BIOMES, CROPS, MOISTURE_BANDS, TEMPERATURE_BANDS } from './climate-types'
import { configurationHelp } from './configuration-help'
import { STRATA } from './economic-types'
import { FIELDS, GOODS, type Policies } from './types'

export interface ConfigurationGroupMeta {
  readonly label: string
  readonly description: string
  /** When true, every field in this group is locked after world generation. */
  readonly creationOnly?: boolean
}

/**
 * UI and schema metadata for each top-level parameter group.
 * The key order here defines the section order in `ConfigurationEditor`.
 */
export const CONFIGURATION_GROUPS: Record<keyof ConfigurationValues, ConfigurationGroupMeta> = {
  starting: {
    label: 'Starting conditions',
    description: 'Opening cash, people and resources given to states when the world is created.',
    creationOnly: true,
  },
  geography: {
    label: 'Geography',
    description: 'Creation only. Relief, climate and province layout.',
    creationOnly: true,
  },
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
    creationOnly: true,
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
  corridors: {
    label: 'Trade corridors',
    description: 'Learning, decay and route review intervals.',
  },
  corridorBundling: {
    label: 'Shared corridors',
    description: 'Bounds for sharing nearby routes and accepting detours.',
  },
  roads: {
    label: 'Road networks',
    description: 'Development gates and permitted road detours.',
  },
  shipping: {
    label: 'Shipping networks',
    description: 'Permitted sailing detours and shortcuts.',
  },
  harbors: {
    label: 'Harbor activity',
    description: 'Memory and decay of observed harbor throughput.',
  },
  riverRoads: {
    label: 'River crossings',
    description: 'Distances in metres for future bridge and bank surveys.',
  },
}

export interface NumberFieldSpec {
  readonly kind: 'number'
  readonly min: number
  readonly max: number
  readonly integer?: boolean
  readonly unit?: string
  readonly label?: string
  readonly creationOnly?: boolean
}

export interface BooleanFieldSpec {
  readonly kind: 'boolean'
  readonly label?: string
  readonly creationOnly?: boolean
}

export interface SelectFieldSpec<T extends string = string> {
  readonly kind: 'select'
  readonly options: readonly T[]
  readonly label?: string
  readonly creationOnly?: boolean
}

/**
 * Marks a field inside `ConfigurationValues` (such as `model.version` or
 * `transportProjects[kind].label`) that is part of the serialized data structure
 * for display/versioning contracts, but is not a tunable simulation parameter.
 * Readonly fields are omitted from `CONFIGURATION_FIELDS` (so the UI never
 * renders controls for them) and are checked against `DEFAULT_CONFIGURATION_VALUES`
 * during validation.
 */
export interface ReadonlyFieldSpec {
  readonly kind: 'readonly'
  readonly error: string
}

export type LeafFieldSpec = NumberFieldSpec | BooleanFieldSpec | SelectFieldSpec | ReadonlyFieldSpec

/**
 * Maps the structure of `ConfigurationValues` to a matching tree of field specs.
 *
 * Why each condition wraps `[T] extends [...]` in a 1-tuple:
 * A naked `T extends string` distributes over string-literal union types such as
 * `Research = 'agriculture' | 'industry' | ...`, which would turn
 * `SchemaNode<Research>` into `SelectFieldSpec<'agriculture'> | SelectFieldSpec<'industry'> | ...`
 * and reject `SelectFieldSpec<Research>`. Wrapping in `[T]` disables union
 * distribution so `SelectFieldSpec<T>` checks against the full union `T`.
 */
export type SchemaNode<T> = [T] extends [number]
  ? NumberFieldSpec | ReadonlyFieldSpec
  : [T] extends [boolean]
    ? BooleanFieldSpec
    : [T] extends [string]
      ? SelectFieldSpec<T> | ReadonlyFieldSpec
      : [T] extends [readonly (infer U)[]]
        ? readonly SchemaNode<U>[]
        : [T] extends [object]
          ? { readonly [K in keyof T]: SchemaNode<T[K]> }
          : never

const num = (
  min: number,
  max: number,
  options?: Omit<NumberFieldSpec, 'kind' | 'min' | 'max'>,
): NumberFieldSpec => ({
  kind: 'number',
  min,
  max,
  ...options,
})

const int = (
  min: number,
  max: number,
  options?: Omit<NumberFieldSpec, 'kind' | 'min' | 'max' | 'integer'>,
): NumberFieldSpec => ({
  kind: 'number',
  min,
  max,
  integer: true,
  ...options,
})

/** Bounded `[0, 1]` range for shares, probabilities, and monthly/annual rates. */
const unitInterval = (options?: Omit<NumberFieldSpec, 'kind' | 'min' | 'max'>): NumberFieldSpec =>
  num(0, 1, options)

const bool = (options?: Omit<BooleanFieldSpec, 'kind'>): BooleanFieldSpec => ({
  kind: 'boolean',
  ...options,
})

const select = <T extends string>(
  options: readonly T[],
  meta?: Omit<SelectFieldSpec<T>, 'kind' | 'options'>,
): SelectFieldSpec<T> => ({
  kind: 'select',
  options,
  ...meta,
})

const readOnly = (error: string): ReadonlyFieldSpec => ({
  kind: 'readonly',
  error,
})

/** Builds a homogeneous record of field specs keyed by a known tuple of domain keys (e.g. `GOODS`, `BIOMES`). */
const recordOf = <K extends string, S>(keys: readonly K[], spec: S): Record<K, S> =>
  Object.fromEntries(keys.map((key) => [key, spec])) as Record<K, S>

const MIGRATION_OPTIONS: readonly Policies['migration'][] = ['open', 'controlled', 'closed']
const PRIORITY_OPTIONS: readonly Policies['priority'][] = ['balanced', 'agriculture', 'industry', 'military']

const TRANSPORT_PROJECT_SPEC = {
  label: readOnly('Transport project names are read-only.'),
  cost: num(0, 1e7),
  timber: num(0, 1e7),
  stone: num(0, 1e7),
  iron: num(0, 1e7),
  tools: num(0, 1e7),
  technology: int(0, 8),
} as const

/**
 * Exhaustive compile-time checked specification for every configuration field.
 * Adding or renaming any key in `DEFAULT_CONFIGURATION_VALUES` without updating
 * this schema is a compile-time TypeScript error.
 */
export const CONFIGURATION_SCHEMA: SchemaNode<ConfigurationValues> = {
  starting: {
    treasury: num(0, 1e9, { label: 'Initial treasury per frontier state', unit: 'thousand crowns' }),
    settledTreasury: num(0, 1e9, {
      label: 'Initial treasury per established state',
      unit: 'thousand crowns',
    }),
    debt: num(0, 1e9, { unit: 'thousand crowns' }),
    year: int(1, 10000),
    capitalPopulation: int(100, 100000),
    populationScale: num(0.1, 10),
    ai: bool(),
    policyFromLeaders: bool(),
    researchFromLeaders: bool(),
    researchFocus: select(FIELDS),
    policies: {
      tax: num(0, 100),
      welfare: num(0, 100),
      education: num(0, 100),
      military: num(0, 100),
      research: num(0, 100),
      tariff: num(0, 100),
      conscription: num(0, 100),
      migration: select(MIGRATION_OPTIONS),
      priority: select(PRIORITY_OPTIONS),
    },
    marketPopulation: int(0, 100000),
    marketVariation: int(0, 100000),
    hamletPopulation: int(0, 10000),
    hamletVariation: int(0, 10000),
    hamletOneIn: int(1, 10000),
    marketOneIn: int(1, 10000),
    childrenShare: num(0, 0.8),
    adultShare: num(0.1, 1),
    stability: num(0, 100),
    legitimacy: num(0, 100),
    urbanScale: num(0, 5),
    literacyScale: num(0, 5),
    healthScale: num(0, 5),
    happinessScale: num(0, 5),
    infrastructureScale: num(0, 5),
    industryScale: num(0, 5),
    stockpileScale: num(0, 5),
    armyScale: num(0, 5),
    fleets: bool(),
    capitalStocks: recordOf(GOODS, num(0, 1e7)),
    technology: recordOf(FIELDS, int(0, 6)),
  },
  geography: {
    seaLevelOffset: num(-0.04, 0.04),
    relief: num(0.25, 2),
    moistureOffset: num(-0.4, 0.4),
    temperatureOffset: num(-0.3, 0.3),
    provinceCount: int(0, 1400),
    erosionPasses: int(1, 48),
    channelRunoff: num(1, 1000),
  },
  founding: {
    people: int(1, 10000),
    reserve: int(0, 100000),
    cash: num(0, 1e6, { label: 'Expedition cash cost', unit: 'thousand crowns' }),
    food: num(0, 1e6),
    timber: num(0, 1e6),
    stone: num(0, 1e6),
    tools: num(0, 1e6),
    range: int(1, 100),
    reserveMonths: num(0, 24),
  },
  frontierPolitics: {
    influence: unitInterval(),
    cityPopulation: int(1, 1e6),
    contribution: unitInterval(),
    solventStability: num(0, 100),
    solventLegitimacy: num(0, 100),
    solventFood: num(0, 2),
    enclaveAreaKm2: num(0, 100),
  },
  consumptionBudget: recordOf(GOODS, unitInterval()),
  materialCoverage: recordOf(GOODS, unitInterval()),
  basePrices: recordOf(GOODS, num(0.01, 100000)),
  householdNeeds: recordOf(GOODS, unitInterval()),
  wageSkills: recordOf(STRATA, num(0.01, 10)),
  recipes: {
    tools: { iron: num(1e-6, 10), coal: num(1e-6, 10), timber: num(1e-6, 10) },
    textiles: { timber: num(1e-6, 10), food: num(1e-6, 10) },
    arms: { iron: num(1e-6, 10), coal: num(1e-6, 10), tools: num(1e-6, 10) },
  },
  conditions: {
    instability: num(0, 3),
    abundance: num(0.35, 1.6),
    extremity: num(0, 2),
  },
  climate: {
    equatorTemperature: num(-30, 60, { unit: '°C' }),
    latitudeTemperatureDrop: num(0, 100, { unit: '°C' }),
    elevationThreshold: unitInterval(),
    elevationLapseRate: num(0, 100, { unit: '°C / elevation unit' }),
    seasonPhaseMonth: int(0, 11),
    growthMinimum: num(0, 2),
    growthRange: num(0.01, 2),
    amplitudes: recordOf(BIOMES, unitInterval()),
    crops: recordOf(BIOMES, select(CROPS)),
    temperatureThresholds: recordOf(
      ['freezing', 'cold', 'mild', 'warm'] as const,
      num(-100, 100, { unit: '°C' }),
    ),
    moistureThresholds: recordOf(['dry', 'seasonal', 'moderate'] as const, unitInterval()),
    matrix: recordOf(TEMPERATURE_BANDS, recordOf(MOISTURE_BANDS, select(BIOMES))),
    terrainOverrides: recordOf(['tundra', 'desert'] as const, recordOf(TEMPERATURE_BANDS, select(BIOMES))),
  },
  model: {
    version: readOnly('The model version is read-only.'),
    // Changing bankCount, age-class boundaries, or fullBuiltPopulationPerCell after
    // generation would invalidate existing bank-account IDs, age-cohort bin arrays,
    // or built-lot geometry, so these six model fields are locked during live play.
    bankCount: int(1, 20, { creationOnly: true }),
    bankCapitalRatio: num(0.01, 1),
    policyRateMonthly: num(0, 0.1),
    bankLoanSpread: num(0, 0.1),
    adultAgeMonths: int(120, 360, { creationOnly: true }),
    retirementAgeMonths: int(480, 1200, { creationOnly: true }),
    maximumAgeMonths: int(960, 2400),
    openingMaximumAgeMonths: int(960, 2400, { creationOnly: true }),
    elderOpeningDecayYears: num(1, 40, { creationOnly: true }),
    femaleBirthShare: unitInterval(),
    childFoodEquivalent: num(0.1, 2),
    elderFoodEquivalent: num(0.1, 2),
    desiredChildrenBase: num(0, 12),
    ruralFamilyMotive: num(0, 10),
    urbanFamilyCost: num(0, 10),
    jobSeparationMonthly: unitInterval(),
    matchingEfficiency: unitInterval(),
    matchingElasticity: unitInterval(),
    wageRenegotiationMonthly: unitInterval(),
    workerBargainingPower: unitInterval(),
    consumptionRiskAversion: num(0.01, 10),
    loanResetMonths: int(1, 120),
    referenceUnemployment: unitInterval(),
    infrastructureServiceProductivity: num(0, 0.1),
    infrastructureWearMonthly: unitInterval(),
    fertilityAnnual: Array.from({ length: 7 }, (_, i) =>
      unitInterval({ label: `Annual fertility · ages ${15 + i * 5}–${19 + i * 5}` }),
    ),
    infantHazardAnnual: unitInterval(),
    childHazardAnnual: unitInterval(),
    adultHazardAnnual: unitInterval(),
    ageingHazardScale: unitInterval(),
    ageingHazardSlope: num(0, 0.15),
    forecastAdjustment: unitInterval(),
    inventoryMonths: num(0.1, 24),
    depreciationMonthly: unitInterval(),
    constructionMonths: int(1, 120),
    dividendShare: unitInterval(),
    creditRepaymentMonthly: unitInterval(),
    defaultAfterMonths: int(1, 120),
    defaultRecovery: unitInterval(),
    mobilityMonthly: unitInterval(),
    fullBuiltPopulationPerCell: int(100, 1e6, { creationOnly: true }),
  },
  decisions: {
    development: bool(),
    agriculture: bool(),
    renewal: bool(),
    realCosts: bool(),
    merchantRelease: unitInterval(),
    workDisutility: unitInterval(),
    investmentShare: unitInterval(),
    investmentAdjustment: unitInterval(),
    readiness: unitInterval(),
    warThreshold: unitInterval(),
    foodSatiation: num(1, 3),
  },
  expansion: {
    economicWeight: num(0, 10),
    peerWeight: num(0, 10),
    pioneerPeople: int(1, 10000),
    homeReserve: int(0, 100000),
    homeFoodMonths: num(0, 24),
    range: int(1, 100),
    reviewMonths: int(1, 120),
    sitesPerProvince: int(1, 32),
    minimumFood: num(0, 2),
    minimumStability: num(0, 100),
    savingShare: unitInterval(),
    developmentShare: unitInterval(),
    accessionMonths: int(1, 1200),
    mandateMonths: int(1, 1200),
    influenceRate: unitInterval(),
    prosperityMonths: int(1, 1200),
    militaryDrive: unitInterval(),
    enterprisePopulation: int(1, 100000),
    enterpriseEquity: num(0, 1000),
    charterWealthPerPerson: num(0, 10),
    charterCapitalPerPerson: num(0, 10),
    charterMinimumCapital: num(0, 10000),
    urbanOpportunityPopulation: int(0, 1e7),
  },
  monetary: {
    target: num(-0.1, 0.5),
    neutralRealRate: num(-0.1, 0.5),
    referenceUnemployment: unitInterval(),
    inflationResponse: num(0, 5),
    unemploymentResponse: num(0, 5),
    inertia: num(0, 0.9999),
    expectationAdjustment: unitInterval(),
  },
  settlements: {
    villagePopulation: int(1, 1e6),
    townPopulation: int(2, 1e7),
    cityPopulation: int(3, 1e8),
    minimumDensity: num(1, 1e6),
    entryBuiltCover: unitInterval(),
    retainedBuiltCover: unitInterval(),
    movingFriction: unitInterval(),
    annualMovingHazard: unitInterval(),
    accessMinutes: num(1, 240),
    searchMeters: num(100, 12000),
  },
  urbanIntegration: {
    incorporationMonths: int(1, 1200),
    mergerMonths: int(1, 2400),
    prestigeRatio: num(1, 10),
    wealthRatio: num(1, 10),
    mergerPrestigeRatio: num(1, 10),
    mergerWealthRatio: num(1, 10),
  },
  farming: {
    timber: num(0, 1000),
    stone: num(0, 1000),
    laborMonths: num(1, 10000),
    fertility: num(0.001, 1),
    duration: int(1, 120),
  },
  transportProjects: recordOf(['paved-road', 'railway', 'port'] as const, TRANSPORT_PROJECT_SPEC),
  tradeMemory: {
    improvement: unitInterval(),
    adjustment: unitInterval(),
    idleMonths: int(1, 1200),
  },
  corridors: {
    gain: unitInterval(),
    evaporation: unitInterval(),
    discount: unitInterval(),
    trafficAdjustment: unitInterval(),
    replanMonths: int(1, 120),
    minimumPathMonths: int(1, 1200),
    improvement: unitInterval(),
  },
  corridorBundling: {
    radius: int(1, 32),
    minimumSharedEdges: int(1, 64),
    travelWeight: unitInterval(),
    maximumExtraEffort: unitInterval(),
    maximumExtraCost: unitInterval(),
    passes: int(1, 8),
  },
  roads: {
    maximumDetour: num(1, 10),
    infrastructure: num(0, 1.2),
    logistics: int(0, 10),
    familiarity: unitInterval(),
    shortcutRatio: num(1, 10),
  },
  shipping: {
    maximumDetour: num(1, 10),
    shortcutRatio: num(1, 10),
  },
  harbors: {
    idleMonths: int(1, 1200),
    halfLifeMonths: num(1, 1200),
    adjustment: unitInterval(),
  },
  riverRoads: {
    buildingSetback: num(0, 100),
    setback: num(0, 100),
    approach: num(1, 100),
    maxSpan: num(1, 1000),
    spacing: num(1, 2000),
    search: num(1, 1000),
  },
}

export interface ConfigurationField {
  readonly path: string
  /** Pre-split path segments (`path.split('.')`) cached for allocation-free traversal. */
  readonly keys: readonly string[]
  readonly group: keyof ConfigurationValues
  readonly label: string
  readonly kind: 'number' | 'boolean' | 'select'
  readonly min?: number
  readonly max?: number
  readonly integer?: boolean
  readonly options?: readonly string[]
  readonly creationOnly: boolean
  readonly description: string
  readonly unit?: string
}

export interface ReadonlyConfigurationField {
  readonly path: string
  readonly keys: readonly string[]
  readonly expected: unknown
  readonly error: string
}

/** Converts a camelCase or kebab-case identifier segment into a sentence-cased label. */
export const configurationLabel = (key: string) =>
  key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase())

function isLeafSpec(node: unknown): node is LeafFieldSpec {
  return (
    node !== null &&
    typeof node === 'object' &&
    'kind' in node &&
    typeof (node as { kind: unknown }).kind === 'string' &&
    ['number', 'boolean', 'select', 'readonly'].includes((node as { kind: string }).kind)
  )
}

export const CONFIGURATION_FIELDS: ConfigurationField[] = []
export const READONLY_CONFIGURATION_FIELDS: ReadonlyConfigurationField[] = []

/**
 * Walks `CONFIGURATION_SCHEMA` and `DEFAULT_CONFIGURATION_VALUES` in lockstep at
 * module initialization to populate the flat `CONFIGURATION_FIELDS` and
 * `READONLY_CONFIGURATION_FIELDS` registries.
 *
 * Iterating `Object.keys(defaultRecord)` guarantees that field order within each
 * group matches the property order in `DEFAULT_CONFIGURATION_VALUES`, and calling
 * `configurationHelp(path)` here fails fast at startup if any editable parameter
 * is missing a user-facing explanation.
 */
function buildRegistry(schemaNode: unknown, defaultNode: unknown, keys: readonly string[]) {
  if (isLeafSpec(schemaNode)) {
    const path = keys.join('.')
    if (schemaNode.kind === 'readonly') {
      READONLY_CONFIGURATION_FIELDS.push({
        path,
        keys,
        expected: defaultNode,
        error: schemaNode.error,
      })
      return
    }
    const [group] = keys as [keyof ConfigurationValues]
    const label = schemaNode.label ?? keys.slice(1).map(configurationLabel).join(' · ')
    CONFIGURATION_FIELDS.push({
      path,
      keys,
      group,
      label,
      kind: schemaNode.kind,
      ...(schemaNode.kind === 'number'
        ? { min: schemaNode.min, max: schemaNode.max, integer: schemaNode.integer, unit: schemaNode.unit }
        : {}),
      ...(schemaNode.kind === 'select' ? { options: schemaNode.options } : {}),
      creationOnly: Boolean(CONFIGURATION_GROUPS[group].creationOnly || schemaNode.creationOnly),
      description: configurationHelp(path),
    })
    return
  }
  const schemaRecord = schemaNode as Record<string, unknown>
  const defaultRecord = defaultNode as Record<string, unknown>
  for (const key of Object.keys(defaultRecord)) {
    buildRegistry(schemaRecord[key], defaultRecord[key], [...keys, key])
  }
}

buildRegistry(CONFIGURATION_SCHEMA, DEFAULT_CONFIGURATION_VALUES, [])

/** O(1) lookup of field metadata by dot-separated path. */
export const CONFIGURATION_FIELD_MAP: ReadonlyMap<string, ConfigurationField> = new Map(
  CONFIGURATION_FIELDS.map((field) => [field.path, field]),
)

/** Pre-grouped fields per top-level section so UI rendering avoids filtering all 250+ fields per group. */
export const CONFIGURATION_FIELDS_BY_GROUP: Readonly<
  Record<keyof ConfigurationValues, readonly ConfigurationField[]>
> = Object.fromEntries(
  (Object.keys(CONFIGURATION_GROUPS) as (keyof ConfigurationValues)[]).map((group) => [
    group,
    CONFIGURATION_FIELDS.filter((field) => field.group === group),
  ]),
) as unknown as Record<keyof ConfigurationValues, readonly ConfigurationField[]>

function readKeys(values: ConfigurationValues, keys: readonly string[]): unknown {
  let cursor: unknown = values
  for (const key of keys) cursor = (cursor as Record<string, unknown>)[key]
  return cursor
}

export function configurationValue(
  values: ConfigurationValues,
  pathOrField: string | Pick<ConfigurationField, 'keys'>,
): unknown {
  if (typeof pathOrField !== 'string') return readKeys(values, pathOrField.keys)
  const known = CONFIGURATION_FIELD_MAP.get(pathOrField)
  return readKeys(values, known ? known.keys : pathOrField.split('.'))
}

/**
 * Pure structural-sharing update along `keys`: clones only the ancestor objects/arrays
 * on the path (`O(depth)`, typically 2–3 shallow copies) instead of deep-cloning the
 * entire 250-parameter tree on every edit.
 */
function writeKeys(root: unknown, keys: readonly string[], index: number, nextValue: unknown): unknown {
  if (index === keys.length) return nextValue
  const key = keys[index]
  if (Array.isArray(root)) {
    const copy = [...root]
    copy[Number(key)] = writeKeys(root[Number(key)], keys, index + 1, nextValue)
    return copy
  }
  const record = root as Record<string, unknown>
  return {
    ...record,
    [key]: writeKeys(record[key], keys, index + 1, nextValue),
  }
}

export function setConfigurationValue(
  values: ConfigurationValues,
  pathOrField: string | Pick<ConfigurationField, 'keys'>,
  value: unknown,
): ConfigurationValues {
  const keys =
    typeof pathOrField !== 'string'
      ? pathOrField.keys
      : (CONFIGURATION_FIELD_MAP.get(pathOrField)?.keys ?? pathOrField.split('.'))
  return writeKeys(values, keys, 0, value) as ConfigurationValues
}

/**
 * Resets a subset of `fields` in `values` back to their values in `source`
 * (defaulting to `DEFAULT_CONFIGURATION_VALUES`). When `skipCreationOnly` is
 * true (live-world editing), creation-only fields are left untouched.
 */
export function resetConfigurationFields(
  values: ConfigurationValues,
  fields: readonly ConfigurationField[],
  source: ConfigurationValues = DEFAULT_CONFIGURATION_VALUES,
  skipCreationOnly = false,
): ConfigurationValues {
  let next = values
  for (const field of fields) {
    if (skipCreationOnly && field.creationOnly) continue
    const targetValue = readKeys(source, field.keys)
    if (!Object.is(readKeys(next, field.keys), targetValue)) {
      next = writeKeys(next, field.keys, 0, targetValue) as ConfigurationValues
    }
  }
  return next
}

/**
 * Every registered `ConfigurationField` resolves to a primitive leaf
 * (`number | boolean | string`), so `Object.is` compares values directly without
 * `JSON.stringify` allocations and treats `NaN` (an emptied number input)
 * deterministically.
 */
export function isFieldChanged(
  field: Pick<ConfigurationField, 'keys'>,
  values: ConfigurationValues,
  baseline: ConfigurationValues = DEFAULT_CONFIGURATION_VALUES,
): boolean {
  return !Object.is(readKeys(values, field.keys), readKeys(baseline, field.keys))
}

export function countChangedFields(
  fields: readonly Pick<ConfigurationField, 'keys'>[],
  values: ConfigurationValues,
  baseline: ConfigurationValues = DEFAULT_CONFIGURATION_VALUES,
): number {
  let changed = 0
  for (const field of fields) if (isFieldChanged(field, values, baseline)) changed++
  return changed
}
