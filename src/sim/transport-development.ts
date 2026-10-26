import type { Region, World } from './types'

export type RoadSurface = 'path' | 'gravel' | 'paved' | 'rail'
export interface PublicWorks {
  road?: Exclude<RoadSurface, 'path'>
  harbor?: number
}
export const roadRank = { path: 0, gravel: 1, paved: 2, rail: 3 } as const
export function provinceWorks(w: World, r: Region) {
  return w.regions[r.province ?? r.id]?.publicWorks
}
export function roadSurface(w: World, a: number, b: number): RoadSurface {
  const surface = (id: number): RoadSurface => {
    const r = w.regions[w.cells[id]?.region]
    if (!r) return 'path'
    return (
      r.publicWorks?.road ??
      (r.infrastructure >= 0.85 ? 'paved' : r.infrastructure >= 0.4 ? 'gravel' : 'path')
    )
  }
  const x = surface(a),
    y = surface(b)
  return roadRank[x] < roadRank[y] ? x : y
}
/** Improvements apply to existing routes. They neither create sea bridges nor
 * upgrade the far side of a sovereign/provincial boundary for free. */
export function roadInvestment(w: World, r: Region) {
  const type = provinceWorks(w, r)?.road
  return type === 'rail'
    ? { cost: 0.65, capacity: 1.5 }
    : type === 'paved'
      ? { cost: 0.85, capacity: 1.2 }
      : { cost: 1, capacity: 1 }
}
