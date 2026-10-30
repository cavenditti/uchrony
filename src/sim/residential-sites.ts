import { residentialParcelOnLand } from './residential-geometry'
import { habitableLand } from './terrain-access'
import { buildingFootprint, LOT_SPAN } from './building-lots'
import { apportion } from './allocation'
import { population, type World } from './types'
import type { PhysicalSite, SpatialBounds, PointMeters } from './adaptive-types'
import { cellPolygon, cellPosition, pointInPolygon } from './physical-space'
import { CELL_METERS } from './grid'
import { queryAdaptiveLeaves } from './adaptive-grid'
import { SETTLEMENT } from './settlement-model'
import { MODEL_PARAMETERS } from './model-parameters'
import { findOrganicParcel } from './urban-growth'

export function occupiedResidents(w: World, site: PhysicalSite) {
  if (site.kind !== 'residential' || site.retired !== undefined) return 0
  return site.residents ?? w.localEconomy?.units[site.pool]?.residents[site.cell] ?? 0
}

/** Fraction of its terrain sample a coarse housing record has built up: the
 * opening cover plus capacity added by paid construction. Surveyed buildings
 * and funded parcels describe their fabric directly instead. */
export function builtCover(site: PhysicalSite) {
  return (
    (site.openingBuilt ?? 0) +
    ((site.investedValue ?? 0) > 0
      ? Math.max(0, site.capacity - site.openingCapacity) / MODEL_PARAMETERS.fullBuiltPopulationPerCell
      : 0)
  )
}

/** Explicit physical fabric: a surveyed building or a funded compact parcel. */
const recordedFabric = (site: PhysicalSite) =>
  !!site.building || (site.id.startsWith('residence:') && (site.investedValue ?? 0) > 0)

/** An opening rural record represents dispersed housing, not a compact block.
 * This predicate only selects the physical representation (draw and survey a
 * compact footprint or not). How urban its occupants live is continuous and
 * belongs to the settlement field, never to this threshold.
 */
export function compactResidence(site: PhysicalSite, retained = false) {
  if (site.building) return site.capacity > 0
  return (
    builtCover(site) >= (retained ? SETTLEMENT.retainedBuiltCover : SETTLEMENT.entryBuiltCover) ||
    recordedFabric(site)
  )
}

/** Residents housed in developed fabric. Built cover converts to housed people
 * at the same `fullBuiltPopulationPerCell` rate that created it, so a partly
 * built coarse record splits continuously into compact and dispersed occupants
 * instead of being classified wholesale as town or countryside. */
export function developedResidents(w: World, site: PhysicalSite) {
  const people = occupiedResidents(w, site)
  return recordedFabric(site)
    ? people
    : Math.min(people, builtCover(site) * MODEL_PARAMETERS.fullBuiltPopulationPerCell)
}

/** Opening capacity of a coarse record: 115% of residents, or what its built
 * cover already houses at the legacy 12,000 spaces per fully built sample. */
export const openingHousingCapacity = (people: number, built: number) =>
  Math.max(Math.ceil(people * 1.15), built * 12000)

/** Side of the square physical support localized for coarse opening housing. */
export const openingSupportSize = (capacity: number) => Math.min(850, Math.max(64, Math.sqrt(capacity * 40)))

/** Square support of a coarse opening record, centred as near its fabric
 * position as its own sample allows: it never spills into a neighbouring
 * sample, and the record's point is its centre, so the drawn parcel and the
 * settlement field's deposit coincide. */
export function openingSupport(w: World, cell: number, point: PointMeters, capacity: number) {
  const size = openingSupportSize(capacity),
    middle = cellPosition(w, cell),
    fit = (v: number, mid: number) =>
      Math.max(mid - CELL_METERS / 2 + size / 2, Math.min(mid + CELL_METERS / 2 - size / 2, v))
  const x = fit(point.x, middle.x),
    y = fit(point.y, middle.y)
  return { x, y, parcel: { x: x - size / 2, y: y - size / 2, size } }
}

export function residentialSites(w: World) {
  return Object.values(w.adaptive?.sites ?? {}).filter(
    (s) => s.kind === 'residential' && s.retired === undefined,
  )
}

export function residentialPools(w: World) {
  const pools = new Map<number, PhysicalSite[]>()
  for (const site of residentialSites(w)) {
    const list = pools.get(site.pool) ?? []
    list.push(site)
    pools.set(site.pool, list)
  }
  for (const sites of pools.values()) sites.sort((a, b) => a.id.localeCompare(b.id))
  return pools
}

/** Authoritative opening initialization, never called from rendering or a spatial query. It
 * localizes the existing census; no building, stock, account or person is added.
 */
export function ensureResidentialSites(w: World) {
  const a = w.adaptive
  if (!a || !w.localEconomy || a.residentialVersion === 1) return
  if (w.viewOnly) throw new Error('Display snapshots cannot initialize residential locations')
  for (const site of residentialSites(w)) {
    site.residents = w.localEconomy.units[site.pool].residents[site.cell] ?? 0
    // Opening housing is a coarse physical support, not known individual lots.
    // New funded parcels have smaller, explicitly recorded physical extents.
    const support = openingSupport(w, site.cell, site, site.capacity)
    site.x = support.x
    site.y = support.y
    site.parcel = support.parcel
  }
  a.residentialVersion = 1
  a.nextResidence = 0
}

/** Dated cohorts are retained in their pool. Between census updates we know the
 * exact spatial counts, but not which plot contains a particular cohort member.
 * Allocate the net census change proportionally, then project legacy cell totals.
 */
export function syncResidentialPopulation(w: World) {
  if (w.adaptive?.residentialVersion !== 1 || !w.localEconomy) return
  for (const [id, sites] of residentialPools(w)) {
    const r = w.localEconomy.units[id],
      total = population(r)
    const prior = sites.reduce((sum, s) => sum + (s.residents ?? 0), 0)
    if (prior !== total) {
      const shares = apportion(
        total,
        sites.map((s) => (prior ? (s.residents ?? 0) : Math.max(0, s.capacity))),
        sites.map((s) => (habitableLand(w.cells[s.cell]) ? Infinity : 0)),
      )
      sites.forEach((s, i) => {
        s.residents = shares[i]
      })
    }
    for (const c of r.cells) r.residents[c] = 0
    for (const site of sites) r.residents[site.cell] = (r.residents[site.cell] ?? 0) + site.residents!
  }
  for (const city of w.localEconomy.cities)
    if (city.absorbedBy === undefined && city.sites)
      city.population = city.sites.reduce((sum, id) => sum + (w.adaptive!.sites[id]?.residents ?? 0), 0)
}

/** Settle physical departures before arrivals, matching the demographic transfer.
 * Vacant funded parcels receive arrivals first; forced displacement can still
 * cause overcrowding rather than silently discarding a refugee household.
 */
export function relocateResidentialResidents(
  w: World,
  moves: { from: number; to: number; people: number }[],
) {
  if (w.adaptive?.residentialVersion !== 1) return
  const pools = residentialPools(w),
    departures = new Map<number, number>(),
    arrivals = new Map<number, number>()
  for (const move of moves) {
    departures.set(move.from, (departures.get(move.from) ?? 0) + move.people)
    arrivals.set(move.to, (arrivals.get(move.to) ?? 0) + move.people)
  }
  for (const [pool, count] of departures) {
    const sites = pools.get(pool)!,
      present = sites.map((s) => s.residents!)
    const parts = apportion(count, present, present)
    if (parts.reduce((sum, n) => sum + n, 0) !== count)
      throw new Error('Residential migration exceeds departing census')
    sites.forEach((s, i) => {
      s.residents! -= parts[i]
    })
  }
  for (const [pool, count] of arrivals) {
    const sites = pools.get(pool)!,
      vacant = sites.map((s) =>
        habitableLand(w.cells[s.cell]) ? Math.max(0, Math.floor(s.capacity - s.residents!)) : 0,
      )
    const parts = apportion(count, vacant, vacant)
    const remainder = count - parts.reduce((sum, n) => sum + n, 0)
    const crowded = apportion(
      remainder,
      sites.map((s) => s.capacity),
      sites.map((s) => (habitableLand(w.cells[s.cell]) ? Infinity : 0)),
    )
    sites.forEach((s, i) => {
      s.residents! += parts[i] + crowded[i]
    })
  }
  syncResidentialPopulation(w)
}

/** Reserve an empty physical plot. Building it still needs the ordinary paid
 * construction transaction, and no resident appears before a real move.
 */
export function createResidentialParcel(
  w: World,
  pool: number,
  cell: number,
  point: PointMeters,
  parcel: SpatialBounds,
) {
  const a = w.adaptive!,
    unit = w.localEconomy!.units[pool]
  if (
    a.residentialVersion !== 1 ||
    !unit?.cells.includes(cell) ||
    !habitableLand(w.cells[cell]) ||
    !pointInPolygon(point, cellPolygon(w, cell))
  )
    throw new Error('Residential parcel must lie on its owner’s land')
  if (![point.x, point.y, parcel.x, parcel.y, parcel.size].every(Number.isFinite) || parcel.size <= 0)
    throw new Error('Invalid residential parcel geometry')
  if (
    point.x < parcel.x ||
    point.x > parcel.x + parcel.size ||
    point.y < parcel.y ||
    point.y > parcel.y + parcel.size ||
    !residentialParcelOnLand(w, cell, unit.nation, parcel)
  )
    throw new Error('Residential plot crosses its source land')
  const id = `residence:${a.nextResidence!++}`
  const site: PhysicalSite = {
    id,
    pool,
    cell,
    ...point,
    parcel: { ...parcel },
    kind: 'residential',
    entity: `residents:${pool}`,
    founded: w.month,
    capacity: 0,
    openingCapacity: 0,
    openingBuilt: 0,
    capitalReference: 0,
    residents: 0,
  }
  if (a.buildingVersion === 1 && parcel.size <= 32) site.building = buildingFootprint(w.seed, point)
  a.sites[id] = site
  return site
}

/** Survey fixed physical plots through the adaptive spatial index. Plot size and
 * location do not depend on numerical leaf centers, so refining the solver cannot
 * move a building or change the set of physically available development sites.
 */
export function findResidentialParcel(
  w: World,
  near: PhysicalSite,
  existing = residentialPools(w).get(near.pool) ?? [],
) {
  if (w.adaptive?.buildingVersion === 1) return findOrganicParcel(w, near, existing)
  const size = w.adaptive?.buildingVersion === 1 ? LOT_SPAN : 128,
    radius = w.adaptive?.buildingVersion === 1 ? 160 : 1000,
    origin = 0
  const bounds = { x: near.x - radius, y: near.y - radius, size: radius * 2 }
  const unit = w.localEconomy!.units[near.pool],
    owned = new Set(unit.cells)
  const cells = [...new Set(queryAdaptiveLeaves(w, bounds).flatMap((n) => n.fragments.map((f) => f.cell)))]
    .filter((c) => owned.has(c) && habitableLand(w.cells[c]))
    .sort((a, b) => a - b)
  const polygons = cells.map((cell) => ({ cell, polygon: cellPolygon(w, cell) }))
  const occupied = existing.filter(
    (s) => s.capacity > 0 || s.building || w.adaptive?.construction?.some((p) => p.site === s.id),
  )
  const candidates: {
    cell: number
    point: PointMeters
    parcel: SpatialBounds
    distance: number
    building?: PointMeters[]
    lanes?: import('./adaptive-types').SettlementLane[]
  }[] = []
  for (
    let ix = Math.floor((bounds.x - origin) / size);
    ix <= Math.ceil((bounds.x + bounds.size - origin) / size);
    ix++
  )
    for (
      let iy = Math.floor((bounds.y - origin) / size);
      iy <= Math.ceil((bounds.y + bounds.size - origin) / size);
      iy++
    ) {
      const parcel = { x: origin + ix * size, y: origin + iy * size, size }
      const point = { x: parcel.x + size / 2, y: parcel.y + size / 2 }
      const distance = Math.hypot(point.x - near.x, point.y - near.y)
      if (distance > radius) continue
      if (
        occupied.some(
          (s) =>
            s.parcel &&
            parcel.x < s.parcel.x + s.parcel.size &&
            parcel.x + size > s.parcel.x &&
            parcel.y < s.parcel.y + s.parcel.size &&
            parcel.y + size > s.parcel.y,
        )
      )
        continue
      const corners = [
        parcel,
        { x: parcel.x + size, y: parcel.y },
        { x: parcel.x, y: parcel.y + size },
        { x: parcel.x + size, y: parcel.y + size },
      ]
      const land = polygons.find(({ polygon }) => corners.every((p) => pointInPolygon(p, polygon)))
      if (!land) continue
      if (!residentialParcelOnLand(w, land.cell, unit.nation, parcel)) continue
      candidates.push({ cell: land.cell, point, parcel, distance })
    }
  return candidates.sort(
    (a, b) => a.distance - b.distance || a.cell - b.cell || a.point.x - b.point.x || a.point.y - b.point.y,
  )[0]
}
