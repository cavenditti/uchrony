import type { Cell } from './types'

export const BIOMES = ['polar', 'boreal', 'temperate', 'mediterranean', 'arid', 'tropical'] as const
export const CROPS = ['rice', 'orchard', 'pasture', 'grain'] as const
export const TEMPERATURE_BANDS = ['freezing', 'cold', 'mild', 'warm', 'hot'] as const
export const MOISTURE_BANDS = ['dry', 'seasonal', 'moderate', 'wet'] as const
export type Biome = (typeof BIOMES)[number]
export type Crop = (typeof CROPS)[number]
export type TemperatureBand = (typeof TEMPERATURE_BANDS)[number]
export type MoistureBand = (typeof MOISTURE_BANDS)[number]
export interface ClimateConfiguration {
  equatorTemperature: number
  latitudeTemperatureDrop: number
  elevationThreshold: number
  elevationLapseRate: number
  seasonPhaseMonth: number
  growthMinimum: number
  growthRange: number
  temperatureThresholds: { freezing: number; cold: number; mild: number; warm: number }
  moistureThresholds: { dry: number; seasonal: number; moderate: number }
  matrix: Record<TemperatureBand, Record<MoistureBand, Biome>>
  terrainOverrides: Record<'tundra' | 'desert', Record<TemperatureBand, Biome>>
  amplitudes: Record<Biome, number>
  crops: Record<Biome, Crop>
}
export type ClimateCell = Pick<Cell, 'r' | 'elevation' | 'terrain' | 'moisture'>
export interface LocalClimate {
  readonly biome: Biome
  readonly temperature: number
  readonly latitude: number
  readonly season: number
  readonly growth: number
  readonly crop: Crop
}
