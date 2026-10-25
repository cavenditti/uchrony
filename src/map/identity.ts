import { censusOf, censusDistribution } from '../sim/view-snapshot'
import type { Layer, Region } from '../sim/types'
import type { IdentityAxis } from '../sim/population-types'

export const identityColor = (id: number) => `hsl(${(id * 137.508 + 28) % 360} 30% 63%)`
export const identityAxis = (layer: Layer): IdentityAxis | null =>
  layer === 'culture' || layer === 'language' || layer === 'belief' ? layer : null
export const dominantIdentity = (region: Region, axis: IdentityAxis) =>
  censusDistribution(censusOf(region, 0), axis)[0]?.id ?? -1
