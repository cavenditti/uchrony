import type { World } from './types'
import type { PhysicalSite } from './adaptive-types'
import { residentialSites, occupiedResidents } from './residential-sites'
import { queryAdaptiveSites } from './adaptive-grid'
import { commuteSiteRoute } from './commuting'
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
  const former = new Set(
    w
      .localEconomy!.cities.filter((c) => c.absorbedBy === undefined)
      .flatMap((c) => c.sites ?? c.cells.map((cell) => `home:${cell}`)),
  )
  const sites = residentialSites(w)
    .filter((s) => {
      if (!s.parcel) return false
      const built = w.localEconomy!.built[s.cell] ?? 0
      const developed =
        (s.investedValue ?? 0) > 0 ||
        built >= (former.has(s.id) ? SETTLEMENT.retainedBuiltCover : SETTLEMENT.entryBuiltCover)
      return developed && occupiedResidents(w, s) / (s.parcel.size ** 2 / 1e6) >= SETTLEMENT.minimumDensity
    })
    .sort((a, b) => a.id.localeCompare(b.id))
  const byId = new Map(sites.map((s) => [s.id, s])),
    remaining = new Set(byId.keys())
  const maximum = sites.reduce((max, s) => Math.max(max, s.parcel!.size), 0)
  const components: SettlementComponent[] = []
  const gap = (a: PhysicalSite, b: PhysicalSite) => {
    const x = a.parcel!,
      y = b.parcel!
    return Math.hypot(
      Math.max(x.x - y.x - y.size, y.x - x.x - x.size, 0),
      Math.max(x.y - y.y - y.size, y.y - x.y - x.size, 0),
    )
  }
  for (const start of sites) {
    if (!remaining.delete(start.id)) continue
    const members = [start]
    for (let i = 0; i < members.length; i++) {
      const from = members[i],
        radius = (from.parcel!.size + maximum) / Math.SQRT2 + 150
      for (const to of queryAdaptiveSites(w, from, radius, (s) => remaining.has(s.id))) {
        if (gap(from, to) > 150 || !commuteSiteRoute(w, from, to, 20)) continue
        remaining.delete(to.id)
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
