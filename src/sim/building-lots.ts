import type { PhysicalSite, PointMeters } from './adaptive-types'
import type { World } from './types'
import { hashSeed } from './random'
import { surveyBuildingPlots } from './urban-growth'
import { apportion } from './allocation'
import { divideStock } from './districts'
import { compactResidence, createResidentialParcel, residentialSites } from './residential-sites'
import { polygonArea } from './physical-space'

export { LOT_SPAN } from './simulation-invariants'
import { BUILDING_CAPACITY } from './simulation-invariants'
export { BUILDING_CAPACITY } from './simulation-invariants'

/** A persistent building inside its surveyed lot, independent of camera and mesh.
 * Small variations describe the physical footprint; capacity still comes only
 * from opening balances or completed, paid construction. */
export function buildingFootprint(seed: string, point: PointMeters): PointMeters[] {
  const h = hashSeed(`${seed}:building:${point.x}:${point.y}`)
  const width = 8 + (h % 4),
    depth = 9 + ((h >>> 4) % 4)
  const angle = (((h >>> 8) % 21) - 10) / 100
  return [
    [-width / 2, -depth / 2],
    [width / 2, -depth / 2],
    [width / 2, depth / 2],
    [-width / 2, depth / 2],
  ].map(([x, y]) => ({
    x: point.x + x * Math.cos(angle) - y * Math.sin(angle),
    y: point.y + x * Math.sin(angle) + y * Math.cos(angle),
  }))
}

/** Replace a coarse housing support with real building records, conserving its
 * occupied people, opening capital, paid investment and pending construction.
 * All buildings retain the same economic pool: no new markets or accounts. */
export function subdivideHousing(
  w: World,
  source: PhysicalSite,
  neighbors = residentialSites(w).filter((s) => s.pool === source.pool),
) {
  if (source.building || source.kind !== 'residential') return
  const a = w.adaptive!,
    projects = (a.construction ?? []).filter((p) => p.site === source.id)
  const future = projects.reduce((n, p) => n + p.capacity, 0)
  if (!(source.capacity + future > 0)) return
  const count = Math.max(1, Math.ceil((source.capacity + future) / BUILDING_CAPACITY))
  const { plots, lanes } = surveyBuildingPlots(
    w,
    source,
    count,
    compactResidence(source) || future > 0,
    neighbors,
  )
  if (!plots.length) return
  if (
    a.buildingVersion !== 1 &&
    source.capacity * 28 > plots.reduce((n, p) => n + polygonArea(p.building) * 4, 0)
  )
    return
  const fabric = source.fabric && structuredClone(source.fabric)
  const weights = plots.map((p) => p.weight)
  const capacity = divideStock(source.capacity, weights),
    opening = divideStock(source.openingCapacity, weights)
  const capital = divideStock(source.investedValue ?? 0, weights),
    built = divideStock(source.openingBuilt ?? 0, weights)
  const people = apportion(source.residents ?? 0, capacity)
  const children = plots.map((plot, i) => {
    const site =
      i === 0 ? source : createResidentialParcel(w, source.pool, plot.cell, plot.point, plot.parcel)
    Object.assign(site, { ...plot.point, cell: plot.cell, parcel: { ...plot.parcel } })
    site.capacity = capacity[i]
    site.openingCapacity = opening[i]
    site.openingBuilt = built[i]
    site.investedValue = capital[i]
    if (source.capitalOwner !== undefined) site.capitalOwner = source.capitalOwner
    else delete site.capitalOwner
    site.residents = people[i]
    site.founded = source.founded
    site.building = plot.building
    if (fabric) {
      const share = weights[i] / weights.reduce((n, weight) => n + weight, 0)
      site.fabric = {
        ...structuredClone(fabric),
        floorArea: fabric.floorArea * share,
        uses: Object.fromEntries(
          Object.entries(fabric.uses).map(([use, area]) => [use, area * share]),
        ) as typeof fabric.uses,
        survey: 'recorded',
        predecessors: i ? [...fabric.predecessors, source.id] : fabric.predecessors,
      }
    }
    return site
  })
  a.construction = (a.construction ?? []).filter((p) => p.site !== source.id)
  for (const project of projects) {
    const spaces = divideStock(project.capacity, weights),
      costs = divideStock(project.cost, weights)
    children.forEach((site, i) =>
      a.construction!.push({
        site: site.id,
        capacity: spaces[i],
        cost: costs[i],
        remaining: project.remaining,
      }),
    )
  }
  a.lanes ??= []
  a.lanes.push(...lanes)
  neighbors.push(...children.slice(1))
  a.revision++
}

export function ensureBuildingLots(w: World) {
  const a = w.adaptive
  if (!a || a.buildingVersion === 1 || w.settlementStart !== 'frontier') return false
  a.buildingVersion = 1
  a.minimumSpan = 8
  const homes = residentialSites(w),
    pools = new Map<number, PhysicalSite[]>()
  for (const site of homes) {
    const group = pools.get(site.pool) ?? []
    group.push(site)
    pools.set(site.pool, group)
  }
  for (const site of homes) subdivideHousing(w, site, pools.get(site.pool)!)
  a.riverLaneVersion = 1
  a.migration.assumptions.push(
    'Housing is represented by varied, persistent building footprints fronting terrain-aware local lanes. Dated households, production, accounts and market clearing retain their larger economic pools; the quadtree can refine occupied lots to 8 m.',
  )
  return true
}
