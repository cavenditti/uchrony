import type { World } from './types'
import type { PhysicalSite, SpatialBounds } from './adaptive-types'
import { URBAN_USES, type FloorUses } from './urban-types'
import { floorUses } from './urban-fabric'
import { activeUrbanProject } from './urban-projects'

export interface UrbanCharacter {
  name: string
  uses: FloorUses
  buildings: number
  olderBuildings: number
  condition: number
  projects: {
    id: number
    kind: string
    stage: string
    reason: string
    remaining: number
    displaced: number
  }[]
  completed: number
  coarse: boolean
}
export function urbanCharacterName(uses: FloorUses) {
  const total = URBAN_USES.reduce((n, u) => n + uses[u], 0)
  if (!total) return 'Unsurveyed neighbourhood'
  const ranked = [...URBAN_USES].sort((a, b) => uses[b] - uses[a])
  const names = {
    housing: 'Residential neighbourhood',
    production: 'Workshop quarter',
    market: 'Market quarter',
    logistics: 'Warehouse quarter',
    civic: 'Civic quarter',
  }
  if (uses[ranked[0]] / total < 0.6) return 'Mixed neighbourhood'
  if (ranked[0] === 'housing' && uses[ranked[1]] / total >= 0.15)
    return `Homes and ${ranked[1] === 'production' ? 'workshops' : ranked[1] === 'market' ? 'shops' : ranked[1] === 'logistics' ? 'warehouses' : 'public services'}`
  return names[ranked[0]]
}
/** Description follows recorded fabric. No district polygon or title feeds
 * investment, access, taxation, or physical development. */
export function urbanCharacter(w: World, sites: PhysicalSite[], bounds?: SpatialBounds): UrbanCharacter {
  const live = sites.filter((s) => s.retired === undefined && !s.premises)
  const buildings = live.filter((s) => s.building && s.fabric)
  const uses = floorUses()
  for (const s of buildings) for (const u of URBAN_USES) uses[u] += s.fabric!.uses[u]
  const ids = new Set(live.map((s) => s.id))
  const projects = (w.adaptive?.urban?.projects ?? []).filter(
    (p) =>
      p.sites.some((id) => ids.has(id)) ||
      (bounds &&
        p.lane?.points.some(
          (v) =>
            v.x >= bounds.x &&
            v.y >= bounds.y &&
            v.x <= bounds.x + bounds.size &&
            v.y <= bounds.y + bounds.size,
        )),
  )
  return {
    name: urbanCharacterName(uses),
    uses,
    buildings: buildings.length,
    olderBuildings: buildings.filter((s) => w.month - s.fabric!.built >= 120).length,
    condition: buildings.reduce((n, s) => n + s.fabric!.condition, 0) / Math.max(1, buildings.length),
    coarse: live.some((s) => s.kind === 'residential' && !s.building),
    completed: projects.filter((p) => p.status === 'occupied').length,
    projects: projects
      .filter(activeUrbanProject)
      .slice(-4)
      .map((p) => ({
        id: p.id,
        kind: p.kind,
        stage: p.status,
        reason: p.reason,
        remaining: Math.max(0, (p.started ?? w.month) + p.duration - w.month),
        displaced: p.displaced.reduce((n, d) => n + d.people, 0),
      })),
  }
}
