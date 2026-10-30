import type { World } from './types'
import { population } from './types'
import type { PhysicalSite } from './adaptive-types'
import { snapshotSiteSearch } from './adaptive-grid'
import { commuteSiteMinutes, withCommuteCostSnapshot, snapshotSiteAccessibility } from './commuting'
import { settlementInfluence } from './settlement-influence'
import { AGGLOMERATION, buildSettlementField, fieldReach, fieldSources } from './settlement-field'
import { SETTLEMENT } from './settlement-model'
import { multiCentreHousingDemand } from './housing-demand'
import { apportion } from './allocation'
import { occupiedResidents, residentialPools, syncResidentialPopulation } from './residential-sites'

const monthlyMovingHazard = () => 1 - Math.exp(-SETTLEMENT.annualMovingHazard / 12)

/** A monthly spatial-choice snapshot. Recursive mesh queries prune distant sites;
 * the economic alternatives remain exact owners, never an averaged bank account.
 * Travel uses physical distance for screening and network time for final moves.
 */
export function settlementAccess(w: World, coarse = false) {
  const pools = residentialPools(w)
  const homes = (pool: number) => pools.get(pool) ?? []
  const occupied = (home: PhysicalSite) => occupiedResidents(w, home)
  const vacancy = (home: PhysicalSite) => Math.max(0, Math.floor(home.capacity - occupied(home)))
  // Coarse housing decisions use local crowding; regional location preferences
  // return to full spatial surveys when monthly playback resumes.
  const baseUtility = coarse ? (_home: PhysicalSite) => 0 : locationUtility(w, pools)
  const utility = (home: PhysicalSite, people = occupied(home)) =>
    baseUtility(home) - 0.25 * (people / Math.max(1, home.capacity)) ** 2
  return { homes, occupied, vacancy, baseUtility, utility }
}

/** Work and service access plus agglomeration pull. Households value homes
 * within market reach of developed neighbours (markets, trades, company), so
 * moves and new households gravitate toward established centres rather than
 * spreading evenly. The pull is logarithmic in developed residents within
 * reach: concave, so crowding and rising rebuilding costs bound any one centre. */
function locationUtility(w: World, pools: ReturnType<typeof residentialPools>) {
  const access = settlementInfluence(w, pools)
  const weight = SETTLEMENT.agglomerationWeight
  if (!weight) return access
  const field = buildSettlementField(w, fieldSources(w), AGGLOMERATION),
    reference = SETTLEMENT.agglomerationReach
  const pull = new Map<string, number>()
  return (home: PhysicalSite) => {
    let value = pull.get(home.id)
    if (value === undefined)
      pull.set(home.id, (value = weight * Math.log1p(fieldReach(field, home.x, home.y) / reference)))
    return access(home) + value
  }
}

/** Nearby housing pools found through the dynamic mesh, then tested against the
 * real domestic travel network. Existing long-distance/sea migration stays separate.
 */
export function settlementMigrationOptions(w: World, coarse = false) {
  if (coarse) {
    // Aggregate migration uses adjacent land pools and established sea routes.
    // Destination housing is still a hard capacity constraint; no spatial route survey.
    syncResidentialPopulation(w)
    return {
      candidates: new Map<number, number[]>(),
      vacancies: new Map(
        [...residentialPools(w)].map(([id, homes]) => [
          id,
          homes.reduce(
            (sum, home) => sum + Math.max(0, Math.floor(home.capacity - occupiedResidents(w, home))),
            0,
          ),
        ]),
      ),
    }
  }
  return withCommuteCostSnapshot(w, () => migrationOptions(w))
}
function migrationOptions(w: World) {
  const local = w.localEconomy,
    a = w.adaptive
  const candidates = new Map<number, number[]>(),
    vacancies = new Map<number, number>()
  if (!local || !a) return { candidates, vacancies }
  syncResidentialPopulation(w)
  const pools = residentialPools(w)
  const accessibleFrom = snapshotSiteAccessibility(w, SETTLEMENT.accessMinutes)
  const search = snapshotSiteSearch(
    w,
    (s) => s.kind === 'residential' && s.capacity - occupiedResidents(w, s) >= 1,
  )
  const vacantPoolsByNation = new Map<number, Set<number>>()
  for (const [id, homes] of pools) {
    vacancies.set(
      id,
      homes.reduce(
        (sum, home) => sum + Math.max(0, Math.floor(home.capacity - occupiedResidents(w, home))),
        0,
      ),
    )
    if (vacancies.get(id)! > 0) {
      const nation = local.units[id].nation,
        available = vacantPoolsByNation.get(nation) ?? new Set<number>()
      available.add(id)
      vacantPoolsByNation.set(nation, available)
    }
  }
  for (const id of local.active) {
    const r = local.units[id],
      found = new Set<number>()
    const available = vacantPoolsByNation.get(r.nation)
    // Frontier towns often own every habitable vacancy in their state. Searching
    // every building in that town cannot discover a different housing pool.
    if (!available || (available.size === 1 && available.has(id))) {
      candidates.set(id, [])
      continue
    }
    for (const home of pools.get(id) ?? []) {
      if (!occupiedResidents(w, home)) continue
      const accessible = accessibleFrom(home)
      for (const target of search(
        home,
        SETTLEMENT.searchMeters,
        (s) =>
          s.kind === 'residential' &&
          s.pool !== id &&
          !found.has(s.pool) &&
          s.capacity - occupiedResidents(w, s) >= 1 &&
          local.units[s.pool]?.nation === r.nation,
      ))
        if (!found.has(target.pool) && accessible(target)) found.add(target.pool)
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
  return multiCentreHousingDemand(w, access)
}

/** Vacancy-constrained, conservative household-location search. A moving cohort
 * retains its original pool/claims; inter-pool moves use migrateCommunities.
 * Largest remainders avoid freezing all small rural cells through per-cell floors.
 */
export function optimizeResidentialLocations(
  w: World,
  prepared?: ReturnType<typeof settlementAccess>,
  months = 1,
) {
  if (!w.adaptive || !w.localEconomy) return
  syncResidentialPopulation(w)
  const access = prepared ?? settlementAccess(w)
  for (const id of w.localEconomy.active) {
    const r = w.localEconomy.units[id],
      homes = access.homes(id)
    if (homes.length < 2) continue
    const hazard = months === 1 ? monthlyMovingHazard() : 1 - (1 - monthlyMovingHazard()) ** months
    const budgets = apportion(Math.floor(population(r) * hazard), homes.map(access.occupied))
    const plans: { from: PhysicalSite; to: PhysicalSite; wanted: number; gain: number; minutes: number }[] =
      []
    // All origins have the same destination ranking at this snapshot. Sort once,
    // then prune by utility before testing distance and real network access.
    const ranked = homes
      .filter((s) => access.vacancy(s) > 0)
      .map((to) => ({ to, score: access.utility(to) }))
      .sort((a, b) => b.score - a.score || a.to.id.localeCompare(b.to.id))
    for (const [i, from] of homes.entries()) {
      if (!budgets[i]) continue
      const originUtility = access.utility(from)
      for (const { to, score } of ranked) {
        const gain = score - originUtility
        if (gain <= SETTLEMENT.movingFriction) break
        if (to === from || Math.hypot(to.x - from.x, to.y - from.y) > SETTLEMENT.searchMeters) continue
        const minutes = commuteSiteMinutes(w, from, to, SETTLEMENT.accessMinutes)
        if (minutes === null) continue
        const net = gain - SETTLEMENT.movingFriction - minutes / 600
        if (net <= 0) continue
        plans.push({ from, to, wanted: budgets[i], gain: net, minutes })
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
        if (gain > SETTLEMENT.movingFriction + plan.minutes / 600) lo = mid
        else hi = mid - 1
      }
      plan.from.residents = access.occupied(plan.from) - lo
      plan.to.residents = access.occupied(plan.to) + lo
    }
  }
  syncResidentialPopulation(w)
}
