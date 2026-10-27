import type { World } from './types'
import type { PhysicalSite } from './adaptive-types'
import { population } from './types'
import { habitableLand } from './terrain-access'
import { residentialPools, syncResidentialPopulation } from './residential-sites'
import { cellPosition } from './physical-space'
import { STRATA } from './economic-types'
import { householdAccount, transfer } from './ledger'
import { relocateHouseholdClaims } from './district-finance'
import { addCommunity, rollupPopulation } from './population'
import { aggregateDistricts, refreshEndowment } from './districts'
import { invalidateTransport, traversableLegs } from './transport'
import { movementNeighbors } from './grid'

/** One-time correction of the former soft mountain penalty. Reassign invalid
 * opening locations, not deaths, demolition, production or newly issued assets.
 * Most corrections stay inside their existing economic pool. A wholly alpine
 * pool transfers its dated households and claims to the nearest usable pool.
 */
export function reconcileMountainTerrain(w: World) {
  const a = w.adaptive,
    local = w.localEconomy
  if (!a || !local || a.terrainVersion === 1) return false
  if (w.viewOnly) throw new Error('Display snapshots cannot reconcile terrain')
  const pools = residentialPools(w)
  const usable = new Map(
    [...pools].map(([id, sites]) => [id, sites.filter((s) => habitableLand(w.cells[s.cell]))]),
  )
  const distance = (x: PhysicalSite, y: PhysicalSite) => Math.hypot(x.x - y.x, x.y - y.y)
  let changed = false
  for (const [id, sites] of pools) {
    const source = local.units[id]
    const invalid = sites.filter(
      (s) =>
        !habitableLand(w.cells[s.cell]) &&
        (s.building ||
          s.capacity > 0 ||
          (s.residents ?? 0) > 0 ||
          a.construction?.some((p) => p.site === s.id)),
    )
    if (!invalid.length) continue
    let target = source
    if (!usable.get(id)?.length) {
      const candidates = local.active.map((i) => local.units[i]).filter((u) => usable.get(u.id)?.length)
      candidates.sort(
        (x, y) =>
          Number(y.province === source.province) - Number(x.province === source.province) ||
          Number(y.nation === source.nation) - Number(x.nation === source.nation) ||
          distance(sites[0], usable.get(x.id)![0]) - distance(sites[0], usable.get(y.id)![0]) ||
          x.id - y.id,
      )
      target = candidates[0]
      if (!target) throw new Error('No habitable land for saved mountain residents')
      if (population(source)) {
        const claims = STRATA.map((s) => ({
          from: householdAccount(id, s),
          to: householdAccount(target.id, s),
          fraction: 1,
        }))
        relocateHouseholdClaims(w, claims)
        for (const [i, move] of claims.entries())
          transfer(
            w,
            move.from,
            move.to,
            w.economy!.households[id][STRATA[i]].cash,
            'terrain census correction',
          )
        for (const group of source.communities!) {
          group.locality = target.id
          group.host = target.nation
          addCommunity(target.communities!, group)
        }
        source.communities = []
        rollupPopulation(source)
        rollupPopulation(target)
      }
    }
    const homes = usable.get(target.id)!
    for (const site of invalid) {
      const home = homes.reduce((best, next) => (distance(site, next) < distance(site, best) ? next : best))
      for (const field of [
        'capacity',
        'openingCapacity',
        'investedValue',
        'capitalReference',
        'openingBuilt',
        'residents',
      ] as const) {
        home[field] = (home[field] ?? 0) + (site[field] ?? 0)
        site[field] = 0
      }
      // Keep the required home:<cell> ownership record, but no physical building
      // or construction remains on the excluded land.
      delete site.building
      for (const project of a.construction ?? []) if (project.site === site.id) project.site = home.id
      local.built[site.cell] = 0
      local.built[home.cell] = Math.min(1, Math.max(local.built[home.cell] ?? 0, home.openingBuilt ?? 0))
      changed = true
    }
  }
  // Administrative centres and firm locations are also physical access anchors.
  for (const region of w.regions) {
    if (habitableLand(w.cells[region.center])) continue
    const safe = (local.units[region.id]?.cells ?? region.cells).find((id) => habitableLand(w.cells[id]))
    if (safe !== undefined) {
      region.center = safe
      region.terrain = w.cells[safe].terrain
      changed = true
    }
  }
  for (const id of local.active) {
    const unit = local.units[id]
    const safe = usable.get(id)?.[0]?.cell
    if (safe !== undefined && !habitableLand(w.cells[unit.center])) {
      unit.center = safe
      unit.terrain = w.cells[safe].terrain
      const market = a.sites[`market:${id}`]
      if (market) Object.assign(market, cellPosition(w, safe), { cell: safe })
      for (const firm of w.economy?.firms ?? [])
        if ((firm.locality ?? firm.region) === id && !habitableLand(w.cells[firm.cell ?? safe]))
          firm.cell = safe
      changed = true
    }
    refreshEndowment(w, unit)
  }
  const routes = w.routes.filter((r) => !r.legs || traversableLegs(w, r.legs))
  const traces = (w.corridors ?? []).filter((e) =>
    movementNeighbors(w.cells, e.a, w.width, w.height).includes(e.b),
  )
  const invalidPlan = w.corridorPlan?.links.some((link) => !traversableLegs(w, link.legs))
  if (
    changed ||
    invalidPlan ||
    routes.length !== w.routes.length ||
    traces.length !== (w.corridors?.length ?? 0)
  ) {
    w.routes = routes
    w.corridors = traces
    invalidateTransport(w)
    a.revision++
    changed = true
  }
  a.lanes = a.lanes?.filter((l) =>
    l.points.every((p) => {
      const id = Math.floor(p.y / 1024) * w.width + Math.floor(p.x / 1024)
      return w.cells[id] && habitableLand(w.cells[id])
    }),
  )
  a.terrainVersion = 1
  if (changed) {
    syncResidentialPopulation(w)
    aggregateDistricts(w)
    a.migration.assumptions.push(
      'High-mountain housing census and capital were reassigned to habitable land without changing total people, dated cohorts or household claims; invalid mountain routes were withdrawn.',
    )
  }
  return changed
}
