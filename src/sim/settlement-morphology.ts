import type { World } from './types'
import { CELL_METERS } from './grid'
import type { PhysicalSite } from './adaptive-types'
import { residentialSites, occupiedResidents, compactResidence } from './residential-sites'
import { adaptiveGrid, queryAdaptiveLeaves } from './adaptive-grid'
import { residentialFootprint, footprintConnection, localWalkingConnection } from './residential-geometry'
import { SETTLEMENT, isVisibleSettlement } from './settlement-model'

export interface SettlementComponent {
  cells: number[]
  sites: PhysicalSite[]
  population: number
  nucleus: PhysicalSite
}

/** Morphological continuity uses occupied physical plots, not shared geography IDs
 * or municipal membership. A narrow street/park gap can connect urban fabric;
 * a sea gap or an inaccessible route cannot.
 */
export function settlementComponents(w: World): SettlementComponent[] {
  const sites = residentialSites(w)
    .filter((s) => {
      if (!s.parcel) return false
      return (
        compactResidence(s) &&
        occupiedResidents(w, s) / (s.parcel.size ** 2 / 1e6) >= SETTLEMENT.minimumDensity
      )
    })
    .sort((a, b) => a.id.localeCompare(b.id))
  const byId = new Map(sites.map((s) => [s.id, s])),
    remaining = new Set(byId.keys())
  // Keep only unvisited candidates in each active leaf. Once a dense connected
  // block is consumed, later frontier sites never scan its members again.
  const pendingByLeaf = new Map<string, Set<string>>()
  const leafBySite = new Map<string, string>()
  for (const leaf of adaptiveGrid(w).leaves) {
    const pending = new Set(leaf.sites.filter((id) => remaining.has(id)))
    if (!pending.size) continue
    pendingByLeaf.set(leaf.id, pending)
    for (const id of pending) leafBySite.set(id, leaf.id)
  }
  const take = (id: string) => {
    if (!remaining.delete(id)) return false
    pendingByLeaf.get(leafBySite.get(id)!)?.delete(id)
    return true
  }
  const maximum = sites.reduce((max, s) => Math.max(max, s.parcel!.size), 0)
  const components: SettlementComponent[] = []
  const footprints = new Map(sites.map((s) => [s.id, residentialFootprint(w, s)]))
  for (const start of sites) {
    if (!take(start.id)) continue
    const members = [start]
    for (let i = 0; i < members.length; i++) {
      const from = members[i],
        radius = (from.parcel!.size + maximum) / Math.SQRT2 + 150
      const candidates = queryAdaptiveLeaves(w, { x: from.x - radius, y: from.y - radius, size: radius * 2 })
        .flatMap((leaf) => [...(pendingByLeaf.get(leaf.id) ?? [])])
        .sort((a, b) => a.localeCompare(b))
      for (const id of candidates) {
        const to = byId.get(id)!
        if (Math.hypot(to.x - from.x, to.y - from.y) > radius) continue
        const connection = footprintConnection(footprints.get(from.id)!, footprints.get(to.id)!)
        const nation = w.localEconomy!.units[from.pool].nation
        if (
          w.localEconomy!.units[to.pool].nation !== nation ||
          connection.distance > 150 + 1e-7 ||
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
