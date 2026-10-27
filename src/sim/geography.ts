import { MOUNTAIN_ELEVATION } from './terrain-access'
import { fractal, hashSeed, random, noise } from './random'
import { clamp, type Cell, type Terrain } from './types'
import { CELL_SIZE, neighbors } from './grid'
import { erodeDrainage } from './hydrology'

export const SEA_LEVEL = 0.095
const layouts: Record<number, number[][]> = {
  1: [[0.5, 0.5, 0.38, 0.4]],
  2: [
    [0.25, 0.43, 0.22, 0.36],
    [0.75, 0.57, 0.21, 0.36],
  ],
  3: [
    [0.24, 0.34, 0.22, 0.29],
    [0.76, 0.37, 0.21, 0.3],
    [0.48, 0.77, 0.25, 0.18],
  ],
  4: [
    [0.25, 0.27, 0.21, 0.22],
    [0.75, 0.27, 0.21, 0.22],
    [0.25, 0.73, 0.21, 0.22],
    [0.75, 0.73, 0.21, 0.22],
  ],
  5: [
    [0.18, 0.28, 0.15, 0.22],
    [0.5, 0.23, 0.15, 0.18],
    [0.82, 0.32, 0.14, 0.24],
    [0.3, 0.73, 0.21, 0.21],
    [0.74, 0.78, 0.19, 0.18],
  ],
}

/** Climate and relief are synthetic geographic models, not a plate-tectonic solver. */
export function generateGeography(seed: string, continents: number, width: number, height: number): Cell[] {
  const rng = { rng: hashSeed(`${seed}:geography:2`) },
    noiseSeed = rng.rng
  const rand = () => random(rng)
  const masses = layouts[continents].map(([x, y, rx, ry]) => ({
    x: x + (rand() - 0.5) * 0.055,
    y: y + (rand() - 0.5) * 0.055,
    rx: rx * (0.92 + rand() * 0.13),
    ry: ry * (0.92 + rand() * 0.13),
    angle: (rand() - 0.5) * 0.6,
    phase: rand() * Math.PI * 2,
  }))
  // Small offshore groups are distinct from the major continental nuclei.
  const islands = Array.from({ length: 10 + continents * 3 }, () => ({
    x: 0.08 + rand() * 0.84,
    y: 0.08 + rand() * 0.84,
    rx: 0.012 + rand() * 0.025,
    ry: 0.018 + rand() * 0.035,
  }))
  const cells: Cell[] = []
  for (let r = 0; r < height; r++)
    for (let q = 0; q < width; q++) {
      const x = q / (width - 1),
        y = r / (height - 1)
      const wx = x + (fractal(x * 6, y * 6, noiseSeed + 9) - 0.5) * 0.07
      const wy = y + (fractal(x * 6, y * 6, noiseSeed + 66) - 0.5) * 0.085
      const distances = masses
        .map((m) => {
          const dx = wx - m.x,
            dy = wy - m.y,
            cs = Math.cos(m.angle),
            sn = Math.sin(m.angle)
          const u = (dx * cs - dy * sn) / m.rx,
            v = (dx * sn + dy * cs) / m.ry
          const theta = Math.atan2(v, u)
          const radius = 1 + 0.2 * Math.sin(theta * 3 + m.phase) + 0.1 * Math.cos(theta * 5 - m.phase)
          return { d: Math.hypot(u, v) / radius, u, v, m }
        })
        .sort((a, b) => a.d - b.d)
      const nearest = distances[0]
      const divide = distances.length > 1 ? (distances[1].d - nearest.d - 0.28) * 1.5 : 2
      let landShape = Math.min(1 - nearest.d, divide)
      for (const island of islands) {
        const d = Math.hypot((wx - island.x) / island.rx, (wy - island.y) / island.ry)
        // Keep island chains offshore, rather than closing straits between continents.
        if (nearest.d > 1.13) landShape = Math.max(landShape, (1 - d) * 0.3)
      }
      const coastNoise = (fractal(x * 25, y * 25, noiseSeed + 4) - 0.5) * 0.1
      const coastHeight = Math.min(landShape * 0.28 + coastNoise, divide * 0.28)
      const ridgeDistance = Math.abs(nearest.u + 0.18 * Math.sin(nearest.v * 5 + nearest.m.phase) - 0.16)
      const ridge =
        Math.exp((-ridgeDistance * ridgeDistance) / 0.025) * Math.max(0, 1 - Math.abs(nearest.v) * 0.7)
      const ruggedness = fractal(x * 18, y * 18, noiseSeed + 20)
      let elevation = SEA_LEVEL + coastHeight
      if (coastHeight > 0) {
        // Broken ranges, upland blocks and low passes rather than one uniform spine.
        const rangeStrength = 0.35 + noise(x * 8, y * 8, noiseSeed + 211) * 1.3
        const pass = Math.exp(-(((nearest.v - Math.sin(nearest.m.phase) * 0.45) / 0.13) ** 2))
        const plateau = Math.max(0, noise(x * 9, y * 9, noiseSeed + 307) - 0.62) * 0.7
        elevation +=
          (ridge * 0.42 * rangeStrength * (1 - pass * 0.8) + plateau) * clamp(coastHeight / 0.07) +
          ruggedness * 0.06
      }
      // Ocean frame: even a warped peninsula cannot be clipped by the world rectangle.
      const edge = Math.min(x, y, 1 - x, 1 - y)
      elevation -= 0.55 * Math.exp(-edge / 0.045)
      if (edge < 0.018) elevation = Math.min(elevation, SEA_LEVEL - 0.02)
      const latitude = Math.abs(y - 0.5) * 2
      const subtropicalDryness = Math.exp(-(((latitude - 0.42) / 0.18) ** 2))
      const moisture = clamp(
        0.6 +
          (fractal(x * 7, y * 7, noiseSeed + 98) - 0.5) * 0.7 -
          subtropicalDryness * 0.24 -
          Math.max(0, nearest.u - 0.2) * ridge * 0.2,
      )
      const temperature = 1 - latitude * 0.85 - Math.max(0, elevation - SEA_LEVEL) * 0.8
      const terrain: Terrain =
        elevation < SEA_LEVEL
          ? 'water'
          : elevation > MOUNTAIN_ELEVATION
            ? 'mountains'
            : temperature < 0.24
              ? 'tundra'
              : elevation > 0.3
                ? 'hills'
                : moisture < 0.34
                  ? 'desert'
                  : moisture > 0.55
                    ? 'forest'
                    : 'plains'
      cells.push({
        id: r * width + q,
        q,
        r,
        x: CELL_SIZE * (q + 0.5),
        y: CELL_SIZE * (r + 0.5),
        elevation,
        moisture,
        terrain,
        region: -1,
        river: false,
      })
    }
  // Remove only single-cell rocks; use an immutable pass so traversal order cannot erode a chain.
  const rocks = cells.filter(
    (c) =>
      c.terrain !== 'water' && neighbors(c.id, width, height).every((id) => cells[id].terrain === 'water'),
  )
  for (const c of rocks) {
    c.terrain = 'water'
    c.elevation = SEA_LEVEL - 0.01
  }
  erodeDrainage(cells, width, height, seed, SEA_LEVEL)
  // Erosion changes the actual relief used by both simulation and rendering.
  for (const c of cells) {
    if (c.terrain === 'water') continue
    const latitude = Math.abs(c.r / (height - 1) - 0.5) * 2
    const temperature = 1 - latitude * 0.85 - Math.max(0, c.elevation - SEA_LEVEL) * 0.8
    c.terrain =
      c.elevation > MOUNTAIN_ELEVATION
        ? 'mountains'
        : temperature < 0.24
          ? 'tundra'
          : c.elevation > 0.3
            ? 'hills'
            : c.moisture < 0.34
              ? 'desert'
              : c.moisture > 0.55
                ? 'forest'
                : 'plains'
    // Riparian fertility is local; it should not reclassify the surrounding biome.
    if (c.river) c.moisture = clamp(c.moisture + 0.08)
  }
  return cells
}
