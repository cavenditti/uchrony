import type { World } from './types'
import { CELL_METERS } from './grid'
import type { PhysicalSite } from './adaptive-types'
import { residentialSites, occupiedResidents, compactResidence } from './residential-sites'
import { residentialFootprint, footprintConnection, localWalkingConnection } from './residential-geometry'
import { SETTLEMENT, isVisibleSettlement } from './settlement-model'
import { riverCrossing, riverWidthNear } from '../map/rivers'

export interface SettlementComponent {
  cells: number[]
  sites: PhysicalSite[]
  population: number
  nucleus: PhysicalSite
}

/** Morphological continuity uses occupied physical plots, not shared geography IDs
 * or municipal membership. A narrow street/park gap or a river crossing can
 * connect urban fabric; a sea gap or an inaccessible route cannot.
 */
export function settlementComponents(w: World, nations?: ReadonlySet<number>): SettlementComponent[] {
  const eligible = residentialSites(w)
    .filter((s) => {
      if (!s.parcel) return false
      return (
        compactResidence(s) &&
        occupiedResidents(w, s) / (s.parcel.size ** 2 / 1e6) >= SETTLEMENT.minimumDensity
      )
    })
    .sort((a, b) => a.id.localeCompare(b.id))
  const maximum = eligible.reduce((max, s) => Math.max(max, s.parcel!.size), 0)
  const sites = nations ? eligible.filter((s) => nations.has(w.localEconomy!.units[s.pool].nation)) : eligible
  const byId = new Map(sites.map((s) => [s.id, s])),
    remaining = new Set(byId.keys())
  // Index the occupied plots themselves. An 8 m numerical mesh contains many
  // empty leaves around each building; city connectivity needs none of them.
  // These buckets only screen candidates: the original distance, footprint,
  // political-access tests and stable ID ordering still decide every edge.
  const span = Math.max(64, Math.min(1024, maximum + 150))
  const buckets = new Map<string, Set<string>>()
  const bucketBySite = new Map<string, Set<string>>()
  for (const site of sites) {
    const key = `${Math.floor(site.x / span)}:${Math.floor(site.y / span)}`,
      bucket = buckets.get(key) ?? new Set<string>()
    bucket.add(site.id)
    buckets.set(key, bucket)
    bucketBySite.set(site.id, bucket)
  }
  const take = (id: string) => {
    if (!remaining.delete(id)) return false
    bucketBySite.get(id)!.delete(id)
    return true
  }
  const components: SettlementComponent[] = []
  const footprints = new Map(sites.map((s) => [s.id, residentialFootprint(w, s)]))
  // Lot surveys keep houses off the rendered river, so its banks would part a
  // town. Water a link crosses does not count toward the walking gap.
  const scale = w.adaptive?.metersPerMapUnit ?? 1
  const river = (s: PhysicalSite) =>
    s.building ? riverWidthNear(w, { x: s.x / scale, y: s.y / scale }, 40 / scale) * scale : 0
  for (const start of sites) {
    if (!take(start.id)) continue
    const members = [start]
    for (let i = 0; i < members.length; i++) {
      const from = members[i],
        across = river(from),
        radius = (from.parcel!.size + maximum) / Math.SQRT2 + (from.building ? 24 + across : 150)
      const candidates: string[] = []
      for (let x = Math.floor((from.x - radius) / span); x <= Math.floor((from.x + radius) / span); x++)
        for (let y = Math.floor((from.y - radius) / span); y <= Math.floor((from.y + radius) / span); y++)
          for (const id of buckets.get(`${x}:${y}`) ?? []) candidates.push(id)
      candidates.sort((a, b) => a.localeCompare(b))
      for (const id of candidates) {
        const to = byId.get(id)!
        if (Math.hypot(to.x - from.x, to.y - from.y) > radius) continue
        const connection = footprintConnection(footprints.get(from.id)!, footprints.get(to.id)!)
        const nation = w.localEconomy!.units[from.pool].nation
        const gap =
          across && to.building && connection.distance > 24
            ? connection.distance -
              riverCrossing(
                w,
                { x: connection.from.x / scale, y: connection.from.y / scale },
                { x: connection.to.x / scale, y: connection.to.y / scale },
              ) *
                scale
            : connection.distance
        if (
          w.localEconomy!.units[to.pool].nation !== nation ||
          gap > (from.building && to.building ? 24 : 150) + 1e-7 ||
          !localWalkingConnection(w, connection.from, connection.to, nation, [from.cell, to.cell])
        )
          continue
        take(to.id)
        members.push(to)
      }
    }
    const people = members.reduce((sum, s) => sum + occupiedResidents(w, s), 0)
    if (!isVisibleSettlement(people)) continue
    members.sort((a, b) => a.id.localeCompare(b.id))
    const nucleus = [...members].sort(
      (a, b) => occupiedResidents(w, b) - occupiedResidents(w, a) || a.id.localeCompare(b.id),
    )[0]
    components.push({
      cells: [...new Set(members.map((s) => s.cell))].sort((a, b) => a - b),
      sites: members,
      population: people,
      nucleus,
    })
  }
  return components
}

export function settledResidentsByCell(w: World) {
  const result = new Map<number, number>()
  if (w.adaptive?.residentialVersion === 1 && !w.viewOnly) {
    for (const site of residentialSites(w)) {
      const people = occupiedResidents(w, site)
      if (
        site.parcel &&
        compactResidence(site) &&
        people / (site.parcel.size ** 2 / 1e6) >= SETTLEMENT.minimumDensity
      )
        result.set(site.cell, (result.get(site.cell) ?? 0) + people)
    }
    return result
  }

  if (!w.viewOnly && w.localEconomy && !w.adaptive) {
    for (const id of w.localEconomy.active) {
      const unit = w.localEconomy.units[id]
      for (const cell of unit.cells) {
        const people = unit.residents[cell] ?? 0
        if (
          (w.localEconomy.built[cell] ?? 0) >= SETTLEMENT.entryBuiltCover &&
          people / (CELL_METERS ** 2 / 1e6) >= SETTLEMENT.minimumDensity
        )
          result.set(cell, people)
      }
    }
    return result
  }
  const displayed = new Map((w.viewHomes ?? []).map((s) => [s.id, s]))
  const legacy = new Map<number, number>()
  if (!w.adaptive)
    for (const unit of Object.values(w.localEconomy?.units ?? {}))
      for (const [cell, count] of Object.entries(unit.residents)) legacy.set(+cell, count)
  for (const city of w.localEconomy?.cities ?? []) {
    if (city.absorbedBy !== undefined || !city.cells.length) continue
    if (city.sites && w.adaptive?.residentialVersion === 1 && !w.viewOnly) {
      for (const id of city.sites) {
        const site = w.adaptive.sites[id]
        if (site) result.set(site.cell, (result.get(site.cell) ?? 0) + occupiedResidents(w, site))
      }
    } else if (city.sites && w.viewHomes) {
      // The compact display keeps physical occupancy without publishing the census.
      for (const id of city.sites) {
        const site = displayed.get(id)
        if (site) result.set(site.cell, (result.get(site.cell) ?? 0) + (site.residents ?? 0))
      }
    } else {
      for (const cell of city.cells) {
        const home = w.adaptive?.sites[`home:${cell}`]
        const people = home ? occupiedResidents(w, home) : (legacy.get(cell) ?? 0)
        result.set(cell, people)
      }
    }
  }
  return result
}
