import { landscapeField, sampleLandscape } from './landscape-field'
import { fractal, hashSeed } from '../sim/random'
import { reliefRandom } from './relief-field'
import type { World } from '../sim/types'

/** World-space clustered scattering, built once per scene, with a fixed instance cap. */
export function forestSites(world: Pick<World, 'cells' | 'width' | 'height' | 'seed'>) {
  const forestCount = world.cells.reduce((n, c) => n + Number(c.terrain === 'forest' && !c.river), 0)
  const budget = Math.min(18000, Math.ceil(forestCount * 1.2))
  const field = landscapeField(world),
    values = new Float64Array(8)
  const salt = hashSeed(`${world.seed}:forest-scatter:1`)
  const sites: { x: number; z: number; variation: number }[] = []
  // A finite rejection pass keeps even very fragmented forests bounded. Positions
  // have no relationship to cell rows, traversal stride, districts, or camera scale.
  for (let i = 0; i < budget * 24 && sites.length < budget; i++) {
    const x = reliefRandom(salt + i * 5) * field.spanX,
      z = reliefRandom(salt + i * 5 + 1) * field.spanY
    sampleLandscape(field, x, z, values)
    if (values[2] < 0.7 || values[7] < 0.015) continue
    const cluster = fractal(x / 65, z / 65, salt)
    if (reliefRandom(salt + i * 5 + 2) > cluster * cluster * 1.6) continue
    sites.push({ x, z, variation: reliefRandom(salt + i * 5 + 3) })
  }
  return sites
}
