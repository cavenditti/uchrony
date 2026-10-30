import { DEFAULT_CONFIGURATION_VALUES, type ConfigurationValues } from './configuration-defaults'
import { configurationFor } from './configuration'
import type { World } from './types'

export type SimulationSettings = ConfigurationValues['conditions']
export const DEFAULT_SETTINGS: Readonly<SimulationSettings> = DEFAULT_CONFIGURATION_VALUES.conditions
/** Conditions share the same authoritative registry as every other world parameter. */
export const simulationSettings = (world: World): SimulationSettings => configurationFor(world).conditions
