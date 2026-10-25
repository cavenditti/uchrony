import { noise } from '../sim/random'
import { type World } from '../sim/types'
import { landscapeField, landscapeElevation } from './landscape-field'

/** Shared by the terrain mesh, its scenery, and projected map annotations. */
export function terrainHeight(world: Pick<World, 'cells' | 'width' | 'height'>, x: number, y: number) {
  const elevation = landscapeElevation(landscapeField(world), x, y)
  // Fine ridges break up broad slopes, while relief never changes simulation data.
  const detail = noise(x / 15, y / 15, 817) * 0.65 + noise(x / 6, y / 6, 133) * 0.35
  return Math.pow(elevation, 1.3) * 220 * (0.88 + detail * 0.24)
}

export const reliefRandom = (n: number) => {
  let h = Math.imul(n ^ 0x45d9f3b, 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}
