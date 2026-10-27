import { habitableLand } from './terrain-access'
import { clamp, type Cell, type Region } from './types'
import { hashSeed, noise } from './random'
import { neighbors } from './grid'

export interface Landscape {
  /** Geographic suitability, not an economic or ethnic productivity trait. */
  habitat: number
  attraction: number
  resources: Region['deposits']
}

/** Correlated settlement basins and ore fields. No per-province random endowments. */
export function seedLandscape(cells: Cell[], width: number, height: number, seed: string) {
  const salt = hashSeed(`${seed}:landscape:3`)
  for (const c of cells) {
    if (c.terrain === 'water') continue
    const x = c.q / width,
      y = c.r / height
    const coast = neighbors(c.id, width, height).some((id) => cells[id].terrain === 'water')
    const habitat = habitableLand(c)
      ? clamp(
          {
            plains: 0.9,
            forest: 0.64,
            hills: 0.38,
            mountains: 0.035,
            desert: 0.045,
            tundra: 0.025,
            water: 0,
          }[c.terrain] *
            (0.65 + c.moisture * 0.5) +
            (c.river ? 0.15 : 0),
        )
      : 0
    const basin = noise(x * 7, y * 7, salt)
    const attraction = habitableLand(c)
      ? clamp(habitat * (0.12 + 0.88 * basin ** 2) + (coast ? 0.12 : 0) + (c.river ? 0.1 : 0))
      : 0
    const ore = (offset: number, frequency: number, threshold: number) =>
      Math.max(0, noise(x * frequency, y * frequency, salt + offset) - threshold) ** 2
    c.landscape = {
      habitat,
      attraction,
      resources: {
        timber: c.terrain === 'forest' ? 0.7 + c.moisture : Math.max(0, c.moisture - 0.38) * 0.35,
        stone:
          (c.terrain === 'mountains' ? 1.5 : c.terrain === 'hills' ? 0.8 : 0.08) *
          (0.5 + noise(x * 12, y * 12, salt + 8)),
        iron: ore(41, 9, 0.58) * (0.4 + c.elevation * 2),
        coal: ore(93, 6, 0.57) * Math.max(0.1, 1 - c.elevation),
      },
    }
  }
  // Keep world-average extractive potential comparable across seeds without
  // giving every location ore: zero-valued cells stay zero after normalization.
  const land = cells.filter((c) => c.landscape)
  for (const [good, target] of [
    ['timber', 0.8],
    ['stone', 0.45],
    ['iron', 0.35],
    ['coal', 0.45],
  ] as const) {
    const mean = land.reduce((sum, c) => sum + c.landscape!.resources[good], 0) / land.length
    if (mean > 0) for (const c of land) c.landscape!.resources[good] *= target / mean
  }
}

/** Legacy geography gets a read-only suitability estimate; its stocks and people stay intact. */
export function landscapeAt(c: Cell): Landscape {
  if (!habitableLand(c))
    return { habitat: 0, attraction: 0, resources: { timber: 0, stone: 0, iron: 0, coal: 0 } }
  return (
    c.landscape ?? {
      habitat: c.terrain === 'mountains' || c.terrain === 'desert' || c.terrain === 'tundra' ? 0.05 : 0.65,
      attraction: clamp(c.moisture * 0.5 + (c.river ? 0.2 : 0) - c.elevation * 0.2),
      resources: { timber: 0, stone: 0, iron: 0, coal: 0 },
    }
  )
}

export const settlementWeight = (c: Cell) => {
  const s = landscapeAt(c)
  return s.habitat * (0.5 + 4 * s.attraction ** 2)
}
