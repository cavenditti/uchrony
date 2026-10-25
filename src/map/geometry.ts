import { HEX, edgeNeighbors } from '../sim/hex'
import type { Cell } from '../sim/types'

export type Point = { x: number; y: number }
export type Ring = Point[]
export type Edge = { a: Point; b: Point; left: number; right: number }
const corners = [
  [0, -2],
  [1, -1],
  [1, 1],
  [0, 2],
  [-1, 1],
  [-1, -1],
]
const key = (x: number, y: number) => `${x}:${y}`

export interface MapGeometry {
  coast: Ring[]
  provinces: Ring[][]
  edges: Edge[]
  shores: Edge[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number }[]
}

/** Trace shared topology once. Jitter is shared by every incident cell, never per polygon. */
export function buildGeometry(
  cells: Cell[],
  width: number,
  height: number,
  regionCount: number,
): MapGeometry {
  const vertices = new Map<string, Point>()
  const vertex = (x: number, y: number) => {
    const id = key(x, y)
    if (!vertices.has(id)) {
      let h = Math.imul(x + 11, 374761393) ^ Math.imul(y + 31, 668265263)
      h = Math.imul(h ^ (h >>> 13), 1274126177)
      vertices.set(id, {
        x: (x * Math.sqrt(3) * HEX) / 2 + ((h & 255) / 255 - 0.5) * HEX * 0.32,
        y: (y * HEX) / 2 + (((h >>> 8) & 255) / 255 - 0.5) * HEX * 0.32,
      })
    }
    return { key: id, point: vertices.get(id)! }
  }
  type Segment = { from: string; to: string; a: Point; b: Point }
  const regionSegments: Segment[][] = Array.from({ length: regionCount }, () => [])
  const coastSegments: Segment[] = [],
    edges: Edge[] = [],
    shores: Edge[] = []
  for (const c of cells)
    if (c.region >= 0 && c.terrain !== 'water') {
      const adjacent = edgeNeighbors(c.id, width, height)
      for (let edge = 0; edge < 6; edge++) {
        const n = adjacent[edge] < 0 ? undefined : cells[adjacent[edge]]
        if (n?.region === c.region) continue
        const [ax, ay] = corners[edge],
          [bx, by] = corners[(edge + 1) % 6]
        const a = vertex(2 * c.q + (c.r % 2) + ax, 3 * c.r + ay)
        const b = vertex(2 * c.q + (c.r % 2) + bx, 3 * c.r + by)
        const segment = { from: a.key, to: b.key, a: a.point, b: b.point }
        regionSegments[c.region].push(segment)
        if (!n || n.terrain === 'water') {
          coastSegments.push(segment)
          shores.push({ a: a.point, b: b.point, left: c.region, right: -1 })
        } else if (c.region < n.region)
          edges.push({ a: a.point, b: b.point, left: c.region, right: n.region })
      }
    }
  const trace = (segments: Segment[]): Ring[] => {
    const outgoing = new Map(segments.map((s) => [s.from, s]))
    const rings: Ring[] = []
    while (outgoing.size) {
      const start = outgoing.values().next().value!,
        ring: Ring = []
      let next: Segment | undefined = start
      while (next) {
        ring.push(next.a)
        outgoing.delete(next.from)
        if (next.to === start.from) break
        next = outgoing.get(next.to)
      }
      if (ring.length >= 3) rings.push(ring)
    }
    return rings
  }
  const provinces = regionSegments.map(trace)
  return {
    coast: trace(coastSegments),
    provinces,
    edges,
    shores,
    bounds: provinces.map((rings) => {
      const points = rings.flat()
      return {
        minX: Math.min(...points.map((p) => p.x)),
        maxX: Math.max(...points.map((p) => p.x)),
        minY: Math.min(...points.map((p) => p.y)),
        maxY: Math.max(...points.map((p) => p.y)),
      }
    }),
  }
}

export function contains(rings: Ring[], x: number, y: number): boolean {
  let inside = false
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i],
        b = ring[j]
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside
    }
  return inside
}

/** Static geographic fields survive worker snapshots; ownership and metrics deliberately do not enter this key. */
export function geographyKey(cells: Cell[]): string {
  let h = 2166136261,
    g = 5381
  for (const c of cells) {
    for (const v of [
      c.id,
      c.x,
      c.y,
      c.elevation,
      c.moisture,
      c.region,
      c.downstream ?? -1,
      c.riverFlow ?? 0,
      c.river ? 1 : 0,
    ]) {
      const n = Math.round(v * 1e6)
      h = Math.imul(h ^ n, 16777619)
      g = Math.imul(g, 33) ^ n
    }
    for (const v of c.terrain) h = Math.imul(h ^ v.charCodeAt(0), 16777619)
  }
  return `${h}:${g}:${cells.length}`
}

export function zoomAt(
  view: { zoom: number; x: number; y: number },
  factor: number,
  point: Point,
  size: { w: number; h: number },
  maxZoom = 32,
) {
  const zoom = Math.max(0.65, Math.min(maxZoom, view.zoom * factor)),
    ratio = zoom / view.zoom
  return {
    zoom,
    x: point.x - size.w / 2 - (point.x - size.w / 2 - view.x) * ratio,
    y: point.y - size.h / 2 - (point.y - size.h / 2 - view.y) * ratio,
  }
}
