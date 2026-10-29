import {
  freezeConfiguration,
  DEFAULT_CONFIGURATION_VALUES,
  type ConfigurationValues,
} from './configuration-defaults'
import { CONFIGURATION_FIELDS, configurationValue } from './configuration-schema'
import { withConfigurationValues } from './configuration-context'
import type { World } from './types'

export interface WorldConfiguration {
  version: 1
  revision: number
  values: ConfigurationValues
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Reject misspelled/unknown keys instead of silently accepting ineffective edits.
 * Missing keys inherit this schema version's defaults, including older saves. */
function mergeKnown(defaults: unknown, input: unknown, path = 'configuration'): unknown {
  if (input === undefined) return structuredClone(defaults)
  if (Array.isArray(defaults)) {
    if (!Array.isArray(input) || input.length !== defaults.length)
      throw new Error(`${path}: wrong number of values.`)
    return defaults.map((item, i) => mergeKnown(item, input[i], `${path}.${i}`))
  }
  if (record(defaults)) {
    if (!record(input)) throw new Error(`${path}: expected an object.`)
    for (const key of Object.keys(input))
      if (!Object.hasOwn(defaults, key)) throw new Error(`${path}.${key}: unknown parameter.`)
    return Object.fromEntries(
      Object.entries(defaults).map(([key, value]) => [key, mergeKnown(value, input[key], `${path}.${key}`)]),
    )
  }
  if (typeof input !== typeof defaults) throw new Error(`${path}: expected ${typeof defaults}.`)
  return input
}
export function validateConfigurationValues(input: unknown): ConfigurationValues {
  const values = mergeKnown(DEFAULT_CONFIGURATION_VALUES, input) as ConfigurationValues
  for (const field of CONFIGURATION_FIELDS) {
    const value = configurationValue(values, field.path)
    if (
      field.kind === 'number' &&
      (typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < field.min! ||
        value > field.max! ||
        (field.integer && !Number.isInteger(value)))
    )
      throw new Error(
        `${field.label} must be ${field.integer ? 'a whole number ' : ''}from ${field.min} to ${field.max}.`,
      )
    if (field.kind === 'select' && !field.options!.includes(value as string))
      throw new Error(`${field.label}: choose a supported value.`)
  }
  // These fields describe the schema/display contract, not tunable behavior.
  if (values.model.version !== DEFAULT_CONFIGURATION_VALUES.model.version)
    throw new Error('The model version is read-only.')
  for (const kind of Object.keys(
    values.transportProjects,
  ) as (keyof ConfigurationValues['transportProjects'])[])
    if (values.transportProjects[kind].label !== DEFAULT_CONFIGURATION_VALUES.transportProjects[kind].label)
      throw new Error('Transport project names are read-only.')
  if (
    Object.values(values.consumptionBudget).every((weight) => weight === 0) ||
    Object.values(values.materialCoverage).every((weight) => weight === 0)
  )
    throw new Error('Consumption and material coverage weights must each have a positive total.')
  const increasing = (numbers: number[], label: string) => {
    if (numbers.some((number, i) => i > 0 && number <= numbers[i - 1]))
      throw new Error(`${label} must be strictly increasing.`)
  }
  increasing(Object.values(values.climate.temperatureThresholds), 'Temperature bands')
  increasing(Object.values(values.climate.moistureThresholds), 'Moisture bands')
  increasing(
    [values.model.adultAgeMonths, values.model.retirementAgeMonths, values.model.maximumAgeMonths],
    'Age boundaries',
  )
  increasing(
    [
      values.settlements.villagePopulation,
      values.settlements.townPopulation,
      values.settlements.cityPopulation,
    ],
    'Settlement populations',
  )
  if (
    values.model.openingMaximumAgeMonths <= values.model.retirementAgeMonths ||
    values.model.openingMaximumAgeMonths > values.model.maximumAgeMonths
  )
    throw new Error('Opening maximum age must exceed retirement age and not exceed maximum age.')
  if (values.starting.childrenShare + values.starting.adultShare > 1)
    throw new Error('Starting children and adult shares cannot exceed 1 together.')
  if (values.geography.provinceCount > 0 && values.geography.provinceCount < 48)
    throw new Error('Province count must be 0 (automatic) or at least 48.')
  if (values.settlements.retainedBuiltCover > values.settlements.entryBuiltCover)
    throw new Error('Retained built cover cannot exceed entry built cover.')
  if (!values.model.fertilityAnnual.some((rate) => rate > 0))
    throw new Error(
      'At least one fertility band must be positive. Set desired children and rural family motive to zero to disable births.',
    )
  return freezeConfiguration(values)
}
export function validateWorldConfiguration(value: unknown): WorldConfiguration {
  if (
    !record(value) ||
    value.version !== 1 ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    Object.keys(value).some((key) => !['version', 'revision', 'values'].includes(key)) ||
    !record(value.values)
  )
    throw new Error('Invalid or unsupported world configuration.')
  return { version: 1, revision: Number(value.revision), values: validateConfigurationValues(value.values) }
}
export function configurationFor(world: Pick<World, 'configuration' | 'simulation'>): ConfigurationValues {
  if (world.configuration) return world.configuration.values
  if (world.simulation) return { ...DEFAULT_CONFIGURATION_VALUES, conditions: world.simulation }
  return DEFAULT_CONFIGURATION_VALUES
}
export const configurationDraft = (world?: Pick<World, 'configuration' | 'simulation'>) =>
  structuredClone(world ? configurationFor(world) : DEFAULT_CONFIGURATION_VALUES)

/** Every world selects its own coefficients, including legacy worlds. Separate
 * decision/expansion experiment scopes remain explicit in their own accessors. */
export function withWorldConfiguration<T>(world: Pick<World, 'configuration'>, run: () => T): T {
  return withConfigurationValues(world.configuration?.values ?? DEFAULT_CONFIGURATION_VALUES, run)
}

/** Atomic command boundary: validate the entire candidate and creation-only
 * fields before writing anything. Revision checks reject stale editor drafts. */
export function applyConfiguration(world: World, input: unknown, expectedRevision: number): string {
  const revision = world.configuration?.revision ?? 0
  if (revision !== expectedRevision)
    throw new Error('Configuration changed while you were editing. Reopen the controls and try again.')
  const values = validateConfigurationValues(input)
  const previous = configurationFor(world)
  for (const field of CONFIGURATION_FIELDS)
    if (
      field.creationOnly &&
      configurationValue(previous, field.path) !== configurationValue(values, field.path)
    )
      throw new Error(`${field.label} can only be changed when creating a world.`)
  world.configuration = { version: 1, revision: revision + 1, values }
  world.simulation = { ...values.conditions }
  // Existing loan contracts and observation history survive; only policy inputs
  // and an explicitly edited current rate change at this boundary.
  const bank = world.economy?.banking
  if (bank) {
    if (values.model.policyRateMonthly !== previous.model.policyRateMonthly)
      bank.centralBank.rate = values.model.policyRateMonthly
    if (bank.policy) Object.assign(bank.policy, values.monetary)
  }
  return 'Simulation parameters applied together. Future steps use the new configuration.'
}
