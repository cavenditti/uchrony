import type { World } from './types'
import { population } from './types'
import type { PhysicalSite } from './adaptive-types'
import { queryAdaptiveSites } from './adaptive-grid'
import { commuteSiteRoute } from './commuting'
import { landscapeAt } from './landscape'
import { SETTLEMENT } from './settlement-model'
import { apportion } from './allocation'
import { occupiedResidents, residentialPools, syncResidentialPopulation } from './residential-sites'

const SEARCH_METERS = 6000
const MONTHLY_MOVING_HAZARD = 1 - Math.exp(-SETTLEMENT.annualMovingHazard / 12)

/** A monthly spatial-choice snapshot. Recursive mesh queries prune distant sites;
 * the economic alternatives remain exact owners, never an averaged bank account.
 * Travel uses physical distance for screening and network time for final moves.
 */
export function settlementAccess(w: World) {
  const local = w.localEconomy!,
    a = w.adaptive!
  const firms = new Map((w.economy?.firms ?? []).filter((f) => f.active).map((f) => [`firm:${f.id}`, f]))
  const scores = new Map<string, number>(),
    pools = residentialPools(w)
  const homes = (pool: number) => pools.get(pool) ?? []
  const occupied = (home: PhysicalSite) => occupiedResidents(w, home)
  const vacancy = (home: PhysicalSite) => Math.max(0, Math.floor(home.capacity - occupied(home)))
  const workNear = (home: PhysicalSite) =>
    queryAdaptiveSites(
      w,
      home,
      SEARCH_METERS,
      (s) =>
        s.kind === 'establishment' &&
        firms.has(s.entity) &&
        local.units[s.pool]?.nation === local.units[home.pool].nation,
    )
  const baseUtility = (home: PhysicalSite) => {
    if (scores.has(home.id)) return scores.get(home.id)!
    let work = 0
    for (const site of workNear(home)) {
      const firm = firms.get(site.entity)!
      // Agricultural jobs need access to land as well as the enterprise office;
      // only the nonfarm share draws households toward a concentrated workplace.
      const nonfarm = Math.max(
        0,
        1 - (firm.laborMix?.food ?? (firm.specialization === 'agricultural' ? 1 : 0.5)),
      )
      if (nonfarm <= 0) continue
      // The return journey provides actual network access and reuses workplace-
      // rooted shortest-path trees across nearby homes. No administrative-center shortcut.
      const route = commuteSiteRoute(w, site, home, SETTLEMENT.accessMinutes)
      if (!route) continue
      const minutes = route.minutes
      work += (firm.employment + (firm.labor?.unfilled ?? 0)) * nonfarm * Math.exp(-minutes / 30)
    }
    const market = a.sites[`market:${home.pool}`]
    const serviceMinutes = market ? (Math.hypot(home.x - market.x, home.y - market.y) / 1000 / 4) * 60 : 0
    const habitat = landscapeAt(w.cells[home.cell]).habitat
    // Diminishing access gains, amenity and the cost of reaching the shared market.
    // No exogenous reward for the label "city" or a desired number of centers.
    const value = 0.18 * Math.log1p(work / 100) + 0.12 * habitat - serviceMinutes / 600
    scores.set(home.id, value)
    return value
  }
  const utility = (home: PhysicalSite, people = occupied(home)) =>
    baseUtility(home) - 0.25 * (people / Math.max(1, home.capacity)) ** 2
  return { homes, occupied, vacancy, baseUtility, utility }
}

/** Nearby housing pools found through the dynamic mesh, then tested against the
 * real domestic travel network. Existing long-distance/sea migration stays separate.
 */
export function settlementMigrationOptions(w: World) {
  const local = w.localEconomy,
    a = w.adaptive
  const candidates = new Map<number, number[]>(),
    vacancies = new Map<number, number>()
  if (!local || !a) return { candidates, vacancies }
  syncResidentialPopulation(w)
  const pools = residentialPools(w)
  for (const [id, homes] of pools) {
    vacancies.set(
      id,
      homes.reduce(
        (sum, home) => sum + Math.max(0, Math.floor(home.capacity - occupiedResidents(w, home))),
        0,
      ),
    )
  }
  for (const id of local.active) {
    const r = local.units[id],
      found = new Set<number>()
    for (const home of pools.get(id) ?? []) {
      if (!occupiedResidents(w, home)) continue
      for (const target of queryAdaptiveSites(
        w,
        home,
        SEARCH_METERS,
        (s) =>
          s.kind === 'residential' &&
          s.pool !== id &&
          !found.has(s.pool) &&
          s.capacity - occupiedResidents(w, s) >= 1 &&
          local.units[s.pool]?.nation === r.nation,
      ))
        if (commuteSiteRoute(w, home, target, SETTLEMENT.accessMinutes)) found.add(target.pool)
    }
    candidates.set(
      id,
      [...found].sort((x, y) => x - y),
    )
  }
  return { candidates, vacancies }
}

/** Unmet location demand goes to the housing investor, not directly to capacity.
 * Existing residents can request a better location even before it has vacancies.
 */
export function residentialDemand(w: World, access = settlementAccess(w)) {
  const demand = new Map<string, number>()
  for (const id of w.localEconomy!.active) {
    const homes = access.homes(id)
    const shortage = Math.max(
      0,
      population(w.localEconomy!.units[id]) * 1.15 - homes.reduce((sum, s) => sum + s.capacity, 0),
    )
    for (const home of homes)
      demand.set(home.id, Math.min(shortage, Math.max(0, access.occupied(home) * 1.15 - home.capacity)))
    if (homes.length < 2) continue
    const target = [...homes].sort(
      (x, y) => access.baseUtility(y) - access.baseUtility(x) || x.id.localeCompare(y.id),
    )[0]
    let wanted = 0
    for (const home of homes) {
      const gain = access.baseUtility(target) - access.baseUtility(home) - SETTLEMENT.movingFriction
      if (home === target || gain <= 0) continue
      if (!commuteSiteRoute(w, home, target, SETTLEMENT.accessMinutes)) continue
      wanted += access.occupied(home) * MONTHLY_MOVING_HAZARD * (1 - Math.exp(-gain / 0.15))
    }
    // A one-year demand horizon covers the three-month build lag and expected
    // moves; empty space already built is deducted before funding another home.
    const nearbyVacancy = homes
      .filter(
        (home) =>
          Math.hypot(home.x - target.x, home.y - target.y) <= 1000 &&
          access.baseUtility(home) >= access.baseUtility(target) - SETTLEMENT.movingFriction,
      )
      .reduce((sum, home) => sum + access.vacancy(home), 0)
    demand.set(target.id, Math.max(demand.get(target.id)!, wanted * 12 * 1.15 - nearbyVacancy))
  }
  return demand
}

/** Vacancy-constrained, conservative household-location search. A moving cohort
 * retains its original pool/claims; inter-pool moves use migrateCommunities.
 * Largest remainders avoid freezing all small rural cells through per-cell floors.
 */
export function optimizeResidentialLocations(w: World) {
  if (!w.adaptive || !w.localEconomy) return
  syncResidentialPopulation(w)
  const access = settlementAccess(w)
  for (const id of w.localEconomy.active) {
    const r = w.localEconomy.units[id],
      homes = access.homes(id)
    if (homes.length < 2) continue
    const budgets = apportion(Math.floor(population(r) * MONTHLY_MOVING_HAZARD), homes.map(access.occupied))
    const plans: { from: PhysicalSite; to: PhysicalSite; wanted: number; gain: number }[] = []
    for (const [i, from] of homes.entries()) {
      if (!budgets[i]) continue
      const destinations = queryAdaptiveSites(
        w,
        from,
        SEARCH_METERS,
        (s) => s.kind === 'residential' && s.pool === id && s.id !== from.id && access.vacancy(s) > 0,
      )
        .map((to) => ({ to, gain: access.utility(to) - access.utility(from) }))
        .filter((p) => p.gain > SETTLEMENT.movingFriction)
        .sort((x, y) => y.gain - x.gain || x.to.id.localeCompare(y.to.id))
      for (const { to, gain } of destinations) {
        const route = commuteSiteRoute(w, from, to, SETTLEMENT.accessMinutes)
        if (!route) continue
        const net = gain - SETTLEMENT.movingFriction - route.minutes / 600
        if (net <= 0) continue
        plans.push({ from, to, wanted: budgets[i], gain: net })
        break
      }
    }
    // Resolve competition for a scarce vacant home once. Arrivals cannot move again.
    plans.sort((x, y) => y.gain - x.gain || x.from.id.localeCompare(y.from.id))
    for (const plan of plans) {
      let lo = 0,
        hi = Math.min(plan.wanted, access.vacancy(plan.to), access.occupied(plan.from))
      // A convex crowding term gives a monotone bound on a beneficial batch.
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        const gain =
          access.utility(plan.to, access.occupied(plan.to) + mid) -
          access.utility(plan.from, access.occupied(plan.from) - mid)
        if (
          gain >
          SETTLEMENT.movingFriction +
            (commuteSiteRoute(w, plan.from, plan.to, SETTLEMENT.accessMinutes)?.minutes ?? 0) / 600
        )
          lo = mid
        else hi = mid - 1
      }
      plan.from.residents = access.occupied(plan.from) - lo
      plan.to.residents = access.occupied(plan.to) + lo
    }
  }
  syncResidentialPopulation(w)
}
