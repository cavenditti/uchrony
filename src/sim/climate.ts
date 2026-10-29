import { clamp, type World } from './types'
import { configurationFor } from './configuration'
import { configurationValues } from './configuration-context'
import type {
  Biome,
  ClimateCell,
  ClimateConfiguration,
  LocalClimate,
  MoistureBand,
  TemperatureBand,
} from './climate-types'
export type { Biome, Crop, LocalClimate } from './climate-types'

/** Boundary inclusivity preserves the original synthetic model: temperatures
 * exactly at the warm/tropical thresholds remain in the lower band; moisture
 * exactly at the tropical threshold is still moderate. There is no rule order. */
export function temperatureBand(
  temperature: number,
  thresholds: ClimateConfiguration['temperatureThresholds'],
): TemperatureBand {
  if (temperature < thresholds.freezing) return 'freezing'
  if (temperature < thresholds.cold) return 'cold'
  if (temperature <= thresholds.mild) return 'mild'
  if (temperature <= thresholds.warm) return 'warm'
  return 'hot'
}
export function moistureBand(
  moisture: number,
  thresholds: ClimateConfiguration['moistureThresholds'],
): MoistureBand {
  if (moisture < thresholds.dry) return 'dry'
  if (moisture < thresholds.seasonal) return 'seasonal'
  if (moisture <= thresholds.moderate) return 'moderate'
  return 'wet'
}
export function classifyBiome(
  temperature: number,
  terrain: ClimateCell['terrain'],
  moisture: number,
  climate: ClimateConfiguration = configurationValues().climate,
): Biome {
  const thermal = temperatureBand(temperature, climate.temperatureThresholds)
  const wetness = moistureBand(moisture, climate.moistureThresholds)
  // Both exceptional terrains have an exhaustive temperature-band row. A cold
  // desert's polar outcome is data, not an implicit ordering of competing rules.
  if (terrain === 'tundra' || terrain === 'desert') return climate.terrainOverrides[terrain][thermal]
  return climate.matrix[thermal][wetness]
}

/** Geographic climate, not weather or a second random stream. Both hemispheres
 * share annual means; growing seasons differ by half a calendar year. */
export function localClimate(
  world: Pick<World, 'height' | 'month' | 'configuration' | 'simulation'>,
  cell: ClimateCell,
): LocalClimate {
  const climate = configurationFor(world).climate
  const latitude = 1 - (2 * (cell.r + 0.5)) / world.height
  const elevationDelta = Math.max(0, cell.elevation - climate.elevationThreshold)
  const temperature =
    climate.equatorTemperature -
    Math.abs(latitude) * climate.latitudeTemperatureDrop -
    elevationDelta * climate.elevationLapseRate
  const biome = classifyBiome(temperature, cell.terrain, cell.moisture, climate)
  const month = ((world.month % 12) + 12) % 12
  const phase = ((month - climate.seasonPhaseMonth + (latitude < 0 ? 6 : 0)) / 12) * Math.PI * 2
  const season = 1 + Math.sin(phase) * climate.amplitudes[biome]
  return {
    biome,
    temperature,
    latitude,
    season,
    growth: clamp((season - climate.growthMinimum) / climate.growthRange),
    crop: climate.crops[biome],
  }
}
