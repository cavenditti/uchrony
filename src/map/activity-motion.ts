import type { DetailMotion } from './activity-layout'
import type { World } from '../sim/types'
import { renderedLand } from './land-surface'

/** Arc-length travel over the very samples used by road paint and freight.
 * Reversing travel also reverses the heading; a bend never becomes a chord. */
export function activityPose(
  m: DetailMotion,
  time: number,
  world: Pick<World, 'cells' | 'width' | 'height'>,
) {
  const phase = time * (m.kind === 'cart' ? 0.25 : 0.4) + m.phase
  let x = m.x,
    z = m.z,
    angle = m.angle
  if (m.kind === 'cart' && m.path && m.path.length > 1) {
    const points = m.path
    let length = 0
    for (let i = 1; i < points.length; i++)
      length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    let remaining = (0.5 + Math.sin(phase) * 0.48) * length
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        dx = b.x - a.x,
        dz = b.y - a.y,
        span = Math.hypot(dx, dz)
      if (!span) continue
      if (remaining <= span || i === points.length - 1) {
        const t = Math.min(1, remaining / span)
        x = a.x + dx * t
        z = a.y + dz * t
        angle = Math.atan2(dx, dz) + (Math.cos(phase) < 0 ? Math.PI : 0)
        break
      }
      remaining -= span
    }
  } else if (m.kind === 'worker') {
    const travel = Math.sin(phase) * 0.7,
      nx = x + Math.sin(angle) * travel,
      nz = z + Math.cos(angle) * travel
    if (renderedLand(world, nx, nz)) {
      x = nx
      z = nz
    }
  }
  return { x, z, angle, phase }
}
