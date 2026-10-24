import type { World } from './types'

export interface SimulationSettings {
  instability: number
  abundance: number
  extremity: number
}
export const DEFAULT_SETTINGS: SimulationSettings = { instability: 1, abundance: 0.85, extremity: 1.2 }
export const simulationSettings = (world: World): SimulationSettings => world.simulation ?? DEFAULT_SETTINGS
export function validateSettings(value: unknown): SimulationSettings {
  const settings = value as SimulationSettings
  if (
    !settings ||
    typeof settings !== 'object' ||
    !Number.isFinite(settings.instability) ||
    settings.instability < 0 ||
    settings.instability > 3 ||
    !Number.isFinite(settings.abundance) ||
    settings.abundance < 0.35 ||
    settings.abundance > 1.6 ||
    !Number.isFinite(settings.extremity) ||
    settings.extremity < 0 ||
    settings.extremity > 2
  )
    throw new Error('Invalid simulation conditions.')
  return { instability: settings.instability, abundance: settings.abundance, extremity: settings.extremity }
}
