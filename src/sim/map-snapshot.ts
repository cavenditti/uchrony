import { adaptiveMesh } from './adaptive-world'
import { compactResidence, occupiedResidents, residentialSites } from './residential-sites'
import type { World } from './types'

/** Map-only projection of the authoritative leaves. Geometry is recoverable
 * from the addresses; no polygons, accounts or site registries cross the worker. */
export interface MapMesh {
  addresses: string[]
  population: Float64Array
  jobs: Float64Array
  landArea: Float64Array
}

export function mapMeshSnapshot(world: World): MapMesh | undefined {
  if (world.viewOnly) return world.viewMesh
  if (!world.adaptive) return undefined
  const { leaves } = adaptiveMesh(world)
  return {
    addresses: leaves.map((leaf) => leaf.id),
    population: Float64Array.from(leaves, (leaf) => leaf.population),
    jobs: Float64Array.from(leaves, (leaf) => leaf.jobs),
    landArea: Float64Array.from(leaves, (leaf) => leaf.landArea),
  }
}

export function mapHomesSnapshot(world: World): NonNullable<World['viewHomes']> {
  if (world.viewOnly) return world.viewHomes ?? []
  const construction = new Map<string, number>()
  for (const project of world.adaptive?.construction ?? [])
    construction.set(project.site, (construction.get(project.site) ?? 0) + project.capacity)
  return residentialSites(world)
    .filter(
      (site) =>
        world.adaptive?.buildingVersion !== 1 ||
        site.capacity > 0 ||
        (site.residents ?? 0) > 0 ||
        construction.has(site.id),
    )
    .map((site) => ({
      id: site.id,
      cell: site.cell,
      pool: site.pool,
      capacity: site.capacity,
      residents: occupiedResidents(world, site),
      x: site.x,
      y: site.y,
      parcel: site.parcel && { ...site.parcel },
      ...(site.building ? { building: site.building.map((p) => ({ ...p })) } : {}),
      developed: compactResidence(site),
      construction: construction.get(site.id) ?? 0,
    }))
}
