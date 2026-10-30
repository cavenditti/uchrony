/** Agricultural illustrations grow around varied yards, not the terrain lattice.
 * Sampling is geographical and deterministic; it never moves physical sites. */
import { CELL_SIZE } from '../sim/grid'
import { hashSeed } from '../sim/random'
import type { World } from '../sim/types'
import { footprint, renderedLand } from './land-surface'
import { reliefRandom } from './relief-field'
import type { DetailRoad } from './activity-layout'

export interface FarmsteadLayout {
  x: number
  z: number
  angle: number
  barnAngle: number
  barnX: number
  barnZ: number
}

/** Segment projections also handle repeated road vertices without division by zero. */
function roadFrontage(roads: DetailRoad[], x: number, z: number) {
  let distance = Infinity,
    angle = 0
  for (const road of roads)
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1],
        b = road.points[i],
        dx = b.x - a.x,
        dz = b.y - a.y,
        t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.y) * dz) / (dx * dx + dz * dz || 1))),
        separation = Math.hypot(x - a.x - t * dx, z - a.y - t * dz)
      if (separation < distance) {
        distance = separation
        angle = Math.atan2(-dz, dx)
      }
    }
  return { distance, angle }
}

/** Bounded rejection sampling keeps the house and barn on dry land and clear
 * of roads. Nearby frontages set the yard's direction; isolated farms vary it. */
export function farmsteadLayout(w: World, id: number, roads: DetailRoad[]): FarmsteadLayout | undefined {
  const cell = w.cells[id],
    seed = hashSeed(`${w.seed}:farmstead:${id}`)
  const random = (n: number) => reliefRandom(seed + n * 1013)
  for (let attempt = 0; attempt < 12; attempt++) {
    const x = cell.x + (random(attempt * 7 + 1) - 0.5) * CELL_SIZE * 0.65,
      z = cell.y + (random(attempt * 7 + 2) - 0.5) * CELL_SIZE * 0.65
    const frontage = roadFrontage(roads, x, z),
      angle = Number.isFinite(frontage.distance) ? frontage.angle : random(attempt * 7 + 3) * Math.PI
    if (frontage.distance < 2.8) continue
    const turn = angle + (random(attempt * 7 + 4) - 0.5) * 0.35,
      side = random(attempt * 7 + 5) < 0.5 ? -1 : 1,
      spacing = 1.4 + random(attempt * 7 + 6) * 0.5,
      barnX = x + Math.cos(turn) * side * spacing,
      barnZ = z - Math.sin(turn) * side * spacing,
      barnAngle = turn + (random(attempt * 7 + 7) - 0.5) * 0.8
    // Test the outbuilding separately: its offset can put it closer to a bend
    // than the house. The circumscribed radius leaves a clear road shoulder.
    if (roadFrontage(roads, barnX, barnZ).distance < 1.6) continue
    const dry = [...footprint(x, z, 1.1, 1.1, turn), ...footprint(barnX, barnZ, 1, 1.6, barnAngle)].every(
      (p) =>
        renderedLand(w, p.x, p.z) &&
        Math.abs(p.x - cell.x) <= CELL_SIZE / 2 &&
        Math.abs(p.z - cell.y) <= CELL_SIZE / 2,
    )
    // The river's exact banks are not part of this symbolic scene. Keep its
    // conservative central strip empty, as the existing field props already do.
    if (dry && (!cell.river || Math.min(Math.abs(x - cell.x), Math.abs(barnX - cell.x)) > 1.8))
      return { x, z, angle: turn, barnX, barnZ, barnAngle }
  }
  return undefined
}
