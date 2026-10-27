import type { World } from './types'
import { population } from './types'
import type { PhysicalSite } from './adaptive-types'
import type { settlementAccess } from './settlement-access'
import { commuteSiteMinutes } from './commuting'
import { SETTLEMENT } from './settlement-model'
import { urbanBlockId } from './urban-blocks'
import { SpatialBuckets } from './spatial-buckets'
import { habitableLand } from './terrain-access'

type Access = ReturnType<typeof settlementAccess>
const MOVING_HAZARD = 1 - Math.exp(-SETTLEMENT.annualMovingHazard / 12)

/** Aggregate infill demand between detailed location reviews. Pending funded
 * capacity offsets the shortage once; this never creates an unpaid building. */
export function coarseHousingDemand(w: World, access: Access) {
  const demand = new Map<string, number>()
  const pending = new Map<number, number>()
  for (const project of w.adaptive?.construction ?? []) {
    const pool = w.adaptive!.sites[project.site].pool
    pending.set(pool, (pending.get(pool) ?? 0) + project.capacity)
  }
  for (const id of w.localEconomy!.active) {
    const homes = access.homes(id)
    const shortage = Math.max(
      0,
      population(w.localEconomy!.units[id]) * 1.15 -
        homes.reduce((sum, home) => sum + home.capacity, 0) -
        (pending.get(id) ?? 0),
    )
    if (!shortage) continue
    const weights = homes.map((home) => Math.max(0, access.occupied(home) * 1.15 - home.capacity))
    const total = weights.reduce((sum, count) => sum + count, 0)
    if (total) homes.forEach((home, i) => demand.set(home.id, (shortage * weights[i]) / total))
  }
  return demand
}

/** One useful location per block, then suppress nearby equivalent locations.
 * Physical accessibility selects centres independently of city names/mergers. */
export function housingCentres(
  w: World,
  homes: PhysicalSite[],
  access: Access,
  pending: ReadonlySet<string> = new Set(w.adaptive?.construction?.map((p) => p.site)),
) {
  const blocks = new Map<string, PhysicalSite>()
  for (const home of homes) {
    if (
      !habitableLand(w.cells[home.cell]) ||
      !(home.capacity > 0 || access.occupied(home) > 0 || pending.has(home.id))
    )
      continue
    const key = urbanBlockId(home),
      old = blocks.get(key)
    if (
      !old ||
      access.baseUtility(home) > access.baseUtility(old) ||
      (access.baseUtility(home) === access.baseUtility(old) && home.id.localeCompare(old.id) < 0)
    )
      blocks.set(key, home)
  }
  const centres: PhysicalSite[] = [],
    nearby = new SpatialBuckets<PhysicalSite>(256)
  for (const home of [...blocks.values()].sort(
    (a, b) => access.baseUtility(b) - access.baseUtility(a) || a.id.localeCompare(b.id),
  )) {
    const equivalent = [...nearby.query(home.x - 256, home.y - 256, home.x + 256, home.y + 256)].some(
      (c) => Math.hypot(c.x - home.x, c.y - home.y) < 256 && commuteSiteMinutes(w, home, c, 10) !== null,
    )
    if (equivalent) continue
    centres.push(home)
    nearby.insert(home, home.x, home.y, home.x, home.y)
  }
  return centres
}

/** Each origin has one moving budget shared across all reachable destinations.
 * Vacancies and funded projects offset at most one centre's demand. */
export function multiCentreHousingDemand(w: World, access: Access) {
  const demand = new Map<string, number>()
  const pending = new Map<string, number>()
  for (const project of w.adaptive?.construction ?? [])
    pending.set(project.site, (pending.get(project.site) ?? 0) + project.capacity)
  // This phase does not mutate construction. Build the global membership index
  // once, rather than rebuilding it for every local housing pool.
  const pendingSites = new Set(pending.keys())
  for (const id of w.localEconomy!.active) {
    const homes = access.homes(id)
    if (!homes.length) continue
    const centres = housingCentres(w, homes, access, pendingSites)
    if (!centres.length) continue
    const index = new SpatialBuckets<PhysicalSite>(1000)
    centres.forEach((c) => index.insert(c, c.x, c.y, c.x, c.y))
    const growth = new Map<string, number>(),
      moves = new Map<string, number>(),
      spare = new Map<string, number>(),
      funded = new Map<string, number>()
    const shortfall = Math.max(
      0,
      population(w.localEconomy!.units[id]) * 1.15 - homes.reduce((sum, s) => sum + s.capacity, 0),
    )
    const deficits = homes.map((s) => Math.max(0, access.occupied(s) * 1.15 - s.capacity))
    const totalDeficit = deficits.reduce((sum, n) => sum + n, 0)
    for (const [i, home] of homes.entries()) {
      // Only a close, comparably useful, reachable centre can claim this supply.
      const nearby = [...index.query(home.x - 1000, home.y - 1000, home.x + 1000, home.y + 1000)]
        .filter((c) => Math.hypot(c.x - home.x, c.y - home.y) <= 1000)
        .sort(
          (a, b) =>
            Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y) ||
            a.id.localeCompare(b.id),
        )
      const local =
        nearby.find((c) => commuteSiteMinutes(w, home, c, SETTLEMENT.accessMinutes) !== null) ?? home
      const need = totalDeficit ? (deficits[i] * shortfall) / totalDeficit : 0
      growth.set(local.id, (growth.get(local.id) ?? 0) + need)
      const vacancy =
        access.baseUtility(home) >= access.baseUtility(local) - SETTLEMENT.movingFriction
          ? access.vacancy(home)
          : 0
      spare.set(local.id, (spare.get(local.id) ?? 0) + vacancy + (pending.get(home.id) ?? 0))
      funded.set(local.id, (funded.get(local.id) ?? 0) + (pending.get(home.id) ?? 0))
      const options: { site: PhysicalSite; weight: number }[] = []
      for (const target of index.query(home.x - 6000, home.y - 6000, home.x + 6000, home.y + 6000)) {
        if (home === target || Math.hypot(target.x - home.x, target.y - home.y) > 6000) continue
        const gain = access.baseUtility(target) - access.baseUtility(home) - SETTLEMENT.movingFriction
        if (gain <= 0) continue
        const minutes = commuteSiteMinutes(w, home, target, SETTLEMENT.accessMinutes)
        if (minutes === null || gain <= minutes / 600) continue
        options.push({ site: target, weight: 1 - Math.exp(-(gain - minutes / 600) / 0.15) })
      }
      const weight = options.reduce((sum, o) => sum + o.weight, 0)
      const budget =
        access.occupied(home) *
        MOVING_HAZARD *
        12 *
        1.15 *
        options.reduce((max, o) => Math.max(max, o.weight), 0)
      for (const option of options)
        moves.set(option.site.id, (moves.get(option.site.id) ?? 0) + (budget * option.weight) / weight)
    }
    for (const key of new Set([...growth.keys(), ...moves.keys()])) {
      // Existing capacity is already included in the global shortage. Only
      // pending works offset growth; vacancies offset relocation demand.
      demand.set(
        key,
        Math.max(
          0,
          (growth.get(key) ?? 0) - (funded.get(key) ?? 0),
          (moves.get(key) ?? 0) - (spare.get(key) ?? 0),
        ),
      )
    }
  }
  return demand
}
