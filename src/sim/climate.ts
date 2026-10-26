import { clamp, type Cell, type World } from './types'

export type Biome = 'polar' | 'boreal' | 'temperate' | 'mediterranean' | 'arid' | 'tropical'
/** Geographic climate, not weather or a second random stream. Both hemispheres
 * use the same annual mean; their growing seasons are six months apart. */
export function localClimate(world: Pick<World, 'height' | 'month'>, cell: Cell) {
  const latitude = 1 - (2 * (cell.r + 0.5)) / world.height
  const temperature = 29 - Math.abs(latitude) * 47 - Math.max(0, cell.elevation - 0.2) * 25
  const biome: Biome =
    temperature < -5 || cell.terrain === 'tundra'
      ? 'polar'
      : cell.terrain === 'desert' || cell.moisture < 0.2
        ? 'arid'
        : temperature < 7
          ? 'boreal'
          : temperature > 22 && cell.moisture > 0.55
            ? 'tropical'
            : temperature > 14 && cell.moisture < 0.48
              ? 'mediterranean'
              : 'temperate'
  const phase = (((world.month % 12) - 4 + (latitude < 0 ? 6 : 0)) / 12) * Math.PI * 2
  const season = 1 + Math.sin(phase) * (biome === 'tropical' ? 0.08 : biome === 'arid' ? 0.12 : 0.23)
  const growth = clamp((season - 0.77) / 0.46)
  return {
    biome,
    temperature,
    latitude,
    season,
    growth,
    crop:
      biome === 'tropical'
        ? 'rice'
        : biome === 'mediterranean'
          ? 'orchard'
          : biome === 'polar' || biome === 'arid'
            ? 'pasture'
            : 'grain',
  }
}
