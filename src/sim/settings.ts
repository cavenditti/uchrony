import { DEFAULT_CONFIGURATION_VALUES } from './configuration-defaults'
import { configurationFor, validateConfigurationValues } from './configuration'
import type { World } from './types'

export interface SimulationSettings {
  instability: number
  abundance: number
  extremity: number
}
export const DEFAULT_SETTINGS: SimulationSettings = DEFAULT_CONFIGURATION_VALUES.conditions
/** Compatibility API for old scenarios; all bounds now come from the registry. */
export const simulationSettings = (world: World): SimulationSettings => configurationFor(world).conditions
export function validateSettings(value: unknown): SimulationSettings {
  if (!value || typeof value !== 'object') throw new Error('Invalid simulation conditions.')
  return { ...validateConfigurationValues({ conditions: value }).conditions }
}
