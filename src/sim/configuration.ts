import {
  freezeConfiguration,
  DEFAULT_CONFIGURATION_VALUES,
  type ConfigurationValues,
} from './configuration-defaults'
import {
  CONFIGURATION_FIELDS,
  READONLY_CONFIGURATION_FIELDS,
  configurationValue,
  isFieldChanged,
  type ConfigurationField,
} from './configuration-schema'
import { withConfigurationValues } from './configuration-context'
import type { World } from './types'

export interface WorldConfiguration {
  version: 1
  revision: number
  values: ConfigurationValues
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * Stage 1 of validation: structural merge and forward-compatible migration.
 *
 * - Missing keys or subtrees inherit `DEFAULT_CONFIGURATION_VALUES` so older
 *   saves and partial overrides (e.g. `{ model: { bankCapitalRatio: 0.12 } }`)
 *   hydrate cleanly when new parameters are added to the schema.
 * - Unknown/misspelled keys are rejected immediately instead of being silently
 *   ignored, ensuring typos in presets or tests fail loudly.
 */
function mergeKnown(defaults: unknown, input: unknown, path = 'configuration'): unknown {
  if (input === undefined) return structuredClone(defaults)
  if (Array.isArray(defaults)) {
    if (!Array.isArray(input) || input.length !== defaults.length)
      throw new Error(`${path}: wrong number of values.`)
    return defaults.map((item, i) => mergeKnown(item, input[i], `${path}.${i}`))
  }
  if (isRecord(defaults)) {
    if (!isRecord(input)) throw new Error(`${path}: expected an object.`)
    for (const key of Object.keys(input))
      if (!Object.hasOwn(defaults, key)) throw new Error(`${path}.${key}: unknown parameter.`)
    return Object.fromEntries(
      Object.entries(defaults).map(([key, value]) => [key, mergeKnown(value, input[key], `${path}.${key}`)]),
    )
  }
  if (typeof input !== typeof defaults) throw new Error(`${path}: expected ${typeof defaults}.`)
  return input
}

/** Parameters whose mechanism was replaced, as dotted paths. Saved worlds may
 * still carry them; they describe nothing the current simulation reads, so they
 * are dropped before the strict unknown-key check rather than rejecting the save. */
const RETIRED_CONFIGURATION_PATHS: readonly string[] = [
  // Prestige/wealth city integration, replaced by settlement-field place topology.
  'urbanIntegration',
  // Footprint density floor, replaced by the agglomeration reach of places.
  'settlements.minimumDensity',
]
function withoutRetiredPaths(input: unknown): unknown {
  if (!isRecord(input)) return input
  let result = input
  for (const path of RETIRED_CONFIGURATION_PATHS) {
    const [group, key] = path.split('.')
    if (key === undefined) {
      if (Object.hasOwn(result, group))
        result = Object.fromEntries(Object.entries(result).filter(([k]) => k !== group))
    } else if (isRecord(result[group]) && Object.hasOwn(result[group], key))
      result = {
        ...result,
        [group]: Object.fromEntries(Object.entries(result[group]).filter(([k]) => k !== key)),
      }
  }
  return result
}

/**
 * Stage 2 of validation: per-field bounds, integer constraints, and select options
 * driven by the compiled `CONFIGURATION_FIELDS` registry.
 */
function validateField(field: ConfigurationField, value: unknown) {
  if (field.kind === 'number') {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < field.min! ||
      value > field.max! ||
      (field.integer && !Number.isInteger(value))
    ) {
      throw new Error(
        `${field.label} must be ${field.integer ? 'a whole number ' : ''}from ${field.min} to ${field.max}.`,
      )
    }
    return
  }
  if (field.kind === 'select' && !field.options!.includes(value as string)) {
    throw new Error(`${field.label}: choose a supported value.`)
  }
}

function assertStrictlyIncreasing(numbers: readonly number[], label: string) {
  if (numbers.some((number, i) => i > 0 && number <= numbers[i - 1]))
    throw new Error(`${label} must be strictly increasing.`)
}

function hasPositiveTotal(weights: Record<string, number>): boolean {
  return Object.values(weights).some((weight) => weight > 0)
}

/**
 * Stage 3 of validation: cross-field domain invariants that depend on multiple
 * parameters simultaneously and are required for numerical stability.
 */
function validateConfigurationInvariants(values: ConfigurationValues) {
  // Household LES demand and material coverage normalize weights by their sum;
  // an all-zero vector would divide by zero.
  if (!hasPositiveTotal(values.consumptionBudget) || !hasPositiveTotal(values.materialCoverage))
    throw new Error('Consumption and material coverage weights must each have a positive total.')

  // Classification bands and age/settlement tiers rely on ordered cutoffs.
  assertStrictlyIncreasing(Object.values(values.climate.temperatureThresholds), 'Temperature bands')
  assertStrictlyIncreasing(Object.values(values.climate.moistureThresholds), 'Moisture bands')
  assertStrictlyIncreasing(
    [values.model.adultAgeMonths, values.model.retirementAgeMonths, values.model.maximumAgeMonths],
    'Age boundaries',
  )
  assertStrictlyIncreasing(
    [
      values.settlements.villagePopulation,
      values.settlements.townPopulation,
      values.settlements.cityPopulation,
    ],
    'Settlement populations',
  )

  // Initial elder cohorts are distributed between retirementAgeMonths and
  // openingMaximumAgeMonths, which must fit inside the supported lifespan.
  if (
    values.model.openingMaximumAgeMonths <= values.model.retirementAgeMonths ||
    values.model.openingMaximumAgeMonths > values.model.maximumAgeMonths
  )
    throw new Error('Opening maximum age must exceed retirement age and not exceed maximum age.')

  // Elders receive the residual `1 - childrenShare - adultShare`, which cannot be negative.
  if (values.starting.childrenShare + values.starting.adultShare > 1)
    throw new Error('Starting children and adult shares cannot exceed 1 together.')

  // `provinceCount === 0` selects the scale-default province count; explicit counts
  // below 48 cannot support multi-state capital placement and frontier expansion.
  if (values.geography.provinceCount > 0 && values.geography.provinceCount < 48)
    throw new Error('Province count must be 0 (automatic) or at least 48.')

  // Hysteresis in urban footprint classification requires the retention threshold
  // to be no higher than the entry threshold, otherwise cells would oscillate.
  if (values.settlements.retainedBuiltCover > values.settlements.entryBuiltCover)
    throw new Error('Retained built cover cannot exceed entry built cover.')

  // Place status uses two hysteresis bands on prominence; inverted bands would
  // flip a centre between quarter and independent place every refresh.
  if (values.placeTopology.release <= values.placeTopology.incorporation)
    throw new Error('Quarter release prominence must exceed incorporation prominence.')
  if (values.placeTopology.quarterRetirement > values.placeTopology.quarterBirth)
    throw new Error('Quarter retirement prominence cannot exceed quarter birth prominence.')

  // Age-specific fertility weights are normalized into a probability distribution
  // over fertile age bands; disabling births is done via desiredChildrenBase = 0
  // and ruralFamilyMotive = 0 rather than zeroing the age-shape vector.
  if (!values.model.fertilityAnnual.some((rate) => rate > 0))
    throw new Error(
      'At least one fertility band must be positive. Set desired children and rural family motive to zero to disable births.',
    )
}

/**
 * Validates a complete or partial configuration candidate, filling missing fields
 * from defaults, checking all field bounds and cross-field invariants, and
 * returning a deeply frozen `ConfigurationValues` object.
 */
export function validateConfigurationValues(input: unknown): ConfigurationValues {
  const values = mergeKnown(DEFAULT_CONFIGURATION_VALUES, withoutRetiredPaths(input)) as ConfigurationValues
  for (const readonlyField of READONLY_CONFIGURATION_FIELDS) {
    if (configurationValue(values, readonlyField) !== readonlyField.expected)
      throw new Error(readonlyField.error)
  }
  for (const field of CONFIGURATION_FIELDS) {
    validateField(field, configurationValue(values, field))
  }
  validateConfigurationInvariants(values)
  return freezeConfiguration(values)
}

export function validateWorldConfiguration(value: unknown): WorldConfiguration {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    Object.keys(value).some((key) => !['version', 'revision', 'values'].includes(key)) ||
    !isRecord(value.values)
  )
    throw new Error('Invalid or unsupported world configuration.')
  return { version: 1, revision: Number(value.revision), values: validateConfigurationValues(value.values) }
}

/**
 * Resolves the effective `ConfigurationValues` for a `World`.
 *
 * Legacy worlds (or worlds generated without an explicit `configuration` argument)
 * do not carry `world.configuration`, but may still have custom `world.simulation`
 * settings (`{ instability, abundance, extremity }`). When `world.simulation`
 * matches the default conditions, we return `DEFAULT_CONFIGURATION_VALUES`
 * directly to avoid allocating a wrapper object on hot paths like `localClimate`.
 */
export function configurationFor(world: Pick<World, 'configuration' | 'simulation'>): ConfigurationValues {
  if (world.configuration) return world.configuration.values
  const sim = world.simulation
  if (
    sim &&
    (sim.instability !== DEFAULT_CONFIGURATION_VALUES.conditions.instability ||
      sim.abundance !== DEFAULT_CONFIGURATION_VALUES.conditions.abundance ||
      sim.extremity !== DEFAULT_CONFIGURATION_VALUES.conditions.extremity)
  ) {
    return { ...DEFAULT_CONFIGURATION_VALUES, conditions: sim }
  }
  return DEFAULT_CONFIGURATION_VALUES
}

/** Returns a mutable deep copy suitable for staging edits in the UI or test fixtures. */
export const configurationDraft = (world?: Pick<World, 'configuration' | 'simulation'>) =>
  structuredClone(world ? configurationFor(world) : DEFAULT_CONFIGURATION_VALUES)

/** Binds a world's effective configuration into the synchronous dynamic scope for `run()`. */
export function withWorldConfiguration<T>(
  world: Pick<World, 'configuration' | 'simulation'>,
  run: () => T,
): T {
  return withConfigurationValues(configurationFor(world), run)
}

/**
 * Atomic command boundary for live parameter updates on an existing world:
 * 1. Optimistic concurrency check (`expectedRevision`) rejects stale editor drafts.
 * 2. Validates the full candidate and verifies no `creationOnly` field was altered
 *    before mutating any world state.
 * 3. Synchronizes `world.simulation` and banking policy parameters while preserving
 *    existing loan contracts and historical inflation observations.
 */
export function applyConfiguration(world: World, input: unknown, expectedRevision: number): string {
  const revision = world.configuration?.revision ?? 0
  if (revision !== expectedRevision)
    throw new Error('Configuration changed while you were editing. Reopen the controls and try again.')
  const values = validateConfigurationValues(input)
  const previous = configurationFor(world)
  for (const field of CONFIGURATION_FIELDS)
    if (field.creationOnly && isFieldChanged(field, values, previous))
      throw new Error(`${field.label} can only be changed when creating a world.`)
  world.configuration = { version: 1, revision: revision + 1, values }
  world.simulation = { ...values.conditions }
  // Existing loan contracts and observation history survive; only policy rule
  // coefficients and an explicitly edited current policy rate change here.
  const bank = world.economy?.banking
  if (bank) {
    if (values.model.policyRateMonthly !== previous.model.policyRateMonthly)
      bank.centralBank.rate = values.model.policyRateMonthly
    if (bank.policy) Object.assign(bank.policy, values.monetary)
  }
  return 'Simulation parameters applied together. Future steps use the new configuration.'
}
