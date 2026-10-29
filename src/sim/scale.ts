/** A terrain sample keeps its physical size: larger worlds add distance, land and settlements. */
export const WORLD_SCALES = {
  regional: { label: 'Regional', width: 112, height: 72, provinces: 180, states: 8 },
  continental: { label: 'Continental', width: 224, height: 144, provinces: 560, states: 16 },
  world: { label: 'World', width: 448, height: 288, provinces: 1400, states: 32 },
} as const
export type WorldScale = keyof typeof WORLD_SCALES
export const DEFAULT_WORLD_SCALE: WorldScale = 'world'
// Includes disconnected islands added after the main province flood fill.
export { MAX_PROVINCES } from './simulation-invariants'
export { MAX_MAP_CELLS } from './simulation-invariants'

export function worldScale(value: unknown): WorldScale {
  if (typeof value !== 'string' || !Object.hasOwn(WORLD_SCALES, value)) throw new Error('Unknown world scale')
  return value as WorldScale
}
