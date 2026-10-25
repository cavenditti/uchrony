import { noise } from '../sim/random'
import { HEX } from '../sim/hex'
import { clamp, type World } from '../sim/types'

/** Shared by the terrain mesh, its scenery, and projected map annotations. */
export function terrainHeight(world: Pick<World, 'cells' | 'width' | 'height'>, x: number, y: number) {
  x = clamp(x, 0, (world.width - 1) * Math.sqrt(3) * HEX)
  y = clamp(y, 0, (world.height - 1) * HEX * 1.5)
  const row = Math.round(y / (HEX * 1.5))
  let weighted = 0,
    weights = 0
  // A compact radial kernel avoids visible bands from staggered hex rows.
  for (let r = Math.max(0, row - 2); r <= Math.min(world.height - 1, row + 2); r++) {
    const col = Math.round(x / (Math.sqrt(3) * HEX) - (r % 2) / 2)
    for (let q = Math.max(0, col - 2); q <= Math.min(world.width - 1, col + 2); q++) {
      const c = world.cells[r * world.width + q]
      const distance = ((x - c.x) ** 2 + (y - c.y) ** 2) / (HEX * 2.5) ** 2
      const weight = Math.max(0, 1 - distance) ** 3
      weighted += Math.max(0, c.terrain === 'water' ? 0 : c.elevation - 0.095) * weight
      weights += weight
    }
  }
  const elevation = weights ? weighted / weights : 0
  // Fine ridges break up broad slopes, while relief never changes simulation data.
  const detail = noise(x / 15, y / 15, 817) * 0.65 + noise(x / 6, y / 6, 133) * 0.35
  return Math.pow(elevation, 1.3) * 220 * (0.88 + detail * 0.24)
}

export const reliefRandom = (n: number) => {
  let h = Math.imul(n ^ 0x45d9f3b, 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}
