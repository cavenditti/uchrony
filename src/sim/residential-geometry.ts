import type { World } from './types'
import type { PhysicalSite, PointMeters } from './adaptive-types'
import { cellPolygon, clipPolygon, pointInPolygon } from './physical-space'
import { movementNeighbors } from './grid'
import { queryAdaptiveLeaves } from './adaptive-grid'

export function residentialFootprint(w: World, site: PhysicalSite) {
  return site.parcel ? clipPolygon(cellPolygon(w, site.cell), site.parcel) : []
}
const cross = (a: PointMeters, b: PointMeters) => a.x * b.y - a.y * b.x
const subtract = (a: PointMeters, b: PointMeters) => ({ x: a.x - b.x, y: a.y - b.y })
const at = (a: PointMeters, b: PointMeters, t: number) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
})

/** Closest actual land-footprint edges, not the centres of their terrain samples. */
export function footprintConnection(a: PointMeters[], b: PointMeters[]) {
  let result = { distance: Infinity, from: a[0], to: b[0] }
  const consider = (from: PointMeters, to: PointMeters) => {
    const distance = Math.hypot(to.x - from.x, to.y - from.y)
    if (distance < result.distance) result = { distance, from, to }
  }
  for (const p of a) if (pointInPolygon(p, b)) return { distance: 0, from: p, to: p }
  for (const p of b) if (pointInPolygon(p, a)) return { distance: 0, from: p, to: p }
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) {
      const p = a[i],
        q = a[(i + 1) % a.length],
        r = b[j],
        s = b[(j + 1) % b.length]
      const d = subtract(q, p),
        e = subtract(s, r),
        det = cross(d, e),
        offset = subtract(r, p)
      if (Math.abs(det) > 1e-12) {
        const t = cross(offset, e) / det,
          u = cross(offset, d) / det
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
          const point = at(p, q, t)
          return { distance: 0, from: point, to: point }
        }
      }
      const projection = (v: PointMeters, x: PointMeters, y: PointMeters) => {
        const d = subtract(y, x),
          t = ((v.x - x.x) * d.x + (v.y - x.y) * d.y) / (d.x * d.x + d.y * d.y || 1)
        return at(x, y, Math.max(0, Math.min(1, t)))
      }
      consider(p, projection(p, r, s))
      consider(q, projection(q, r, s))
      consider(projection(r, p, q), r)
      consider(projection(s, p, q), s)
    }
  return result
}

/** Exact clipping of a segment against a convex source polygon. */
function segmentInterval(from: PointMeters, to: PointMeters, polygon: PointMeters[]) {
  const signed = polygon.reduce((sum, a, i) => sum + cross(a, polygon[(i + 1) % polygon.length]), 0)
  const orientation = Math.sign(signed),
    direction = subtract(to, from)
  let lo = 0,
    hi = 1
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      edge = subtract(polygon[(i + 1) % polygon.length], a)
    const offset = orientation * cross(edge, subtract(from, a)),
      slope = orientation * cross(edge, direction)
    if (Math.abs(slope) < 1e-10) {
      if (offset < -1e-6) return null
      continue
    }
    const t = -offset / slope
    if (slope > 0) lo = Math.max(lo, t)
    else hi = Math.min(hi, t)
    if (lo > hi + 1e-10) return null
  }
  return hi >= lo && hi >= 0 && lo <= 1 ? ([Math.max(0, lo), Math.min(1, hi)] as const) : null
}

/** A short pedestrian connection must be covered by actual accessible land.
 * Numerical resolution, centre detours and congestion on a separate road do not
 * obstruct a path between adjoining neighborhoods. No sea shortcut is created.
 */
export function localWalkingConnection(
  w: World,
  from: PointMeters,
  to: PointMeters,
  nation: number,
  endpoints?: readonly [number, number],
) {
  const passage = (a: number, b: number) => {
    if (a === b) return true
    if (!movementNeighbors(w.cells, a, w.width, w.height).includes(b)) return false
    const qa = a % w.width,
      ra = Math.floor(a / w.width),
      qb = b % w.width,
      rb = Math.floor(b / w.width)
    return (
      qa === qb ||
      ra === rb ||
      [ra * w.width + qb, rb * w.width + qa].every((id) => {
        const region = w.regions[w.cells[id].region]
        return region?.nation === nation && region.devastation <= 0.9
      })
    )
  }
  if (
    endpoints &&
    Math.abs((endpoints[0] % w.width) - (endpoints[1] % w.width)) <= 1 &&
    Math.abs(Math.floor(endpoints[0] / w.width) - Math.floor(endpoints[1] / w.width)) <= 1 &&
    !passage(...endpoints)
  )
    return null
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  if (endpoints && endpoints[0] === endpoints[1]) {
    const id = endpoints[0],
      cell = w.cells[id],
      region = w.regions[cell.region],
      polygon = cellPolygon(w, id)
    if (
      cell.terrain === 'water' ||
      region?.nation !== nation ||
      region.devastation > 0.9 ||
      !pointInPolygon(from, polygon) ||
      !pointInPolygon(to, polygon)
    )
      return null
    const penalty = cell.terrain === 'mountains' ? 2.2 : cell.terrain === 'hills' ? 1.4 : 1
    return {
      minutes: (length / 1000 / 4) * 60 * penalty,
      cells: [id],
      points: [
        { x: from.x, y: from.y },
        { x: to.x, y: to.y },
      ],
      mode: 'walk' as const,
    }
  }
  const bounds = {
    x: Math.min(from.x, to.x) - 1e-5,
    y: Math.min(from.y, to.y) - 1e-5,
    size: Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), 1e-5) + 2e-5,
  }
  const cells = [...new Set(queryAdaptiveLeaves(w, bounds).flatMap((n) => n.fragments.map((f) => f.cell)))]
  const intervals = cells
    .flatMap((id) => {
      const c = w.cells[id],
        r = w.regions[c.region]
      if (c.terrain === 'water' || r?.nation !== nation || r.devastation > 0.9) return []
      const span = segmentInterval(from, to, cellPolygon(w, id))
      return span
        ? [
            {
              lo: span[0],
              hi: span[1],
              cell: id,
              penalty: c.terrain === 'mountains' ? 2.2 : c.terrain === 'hills' ? 1.4 : 1,
            },
          ]
        : []
    })
    .sort((a, b) => a.lo - b.lo || a.hi - b.hi || a.cell - b.cell)
  let end = 0,
    effort = 0
  const path: number[] = []
  for (const part of intervals) {
    if (part.lo > end + 1e-8) return null
    if (part.hi > end) {
      if (path.length && !passage(path.at(-1)!, part.cell)) return null
      effort += (part.hi - end) * part.penalty
      end = part.hi
      path.push(part.cell)
    }
  }
  if (end < 1 - 1e-8) return null
  return {
    minutes: (length / 1000 / 4) * 60 * effort,
    cells: path,
    points: [
      { x: from.x, y: from.y },
      { x: to.x, y: to.y },
    ],
    mode: 'walk' as const,
  }
}
