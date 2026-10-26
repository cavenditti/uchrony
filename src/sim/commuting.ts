import { recordCommute } from './commute-ledger'
import { STRATA, type EconomicStratum } from './economic-types'
import { economicRegions, localFirmRegion } from './local-units'
import { firmAccount, householdAccount, transfer } from './ledger'
import { recordWages } from './national-accounts'
import { collectedTaxRate } from './macroeconomy'
import { WAGE_SKILL } from './firms'
import { cellPosition } from './physical-space'
import { neighbors } from './hex'
import { MinHeap } from './heap'
import type { World } from './types'

/** Shortest traversable commuting route. Mode and terrain set travel time, not mesh depth. */
interface TravelTree {
  distances: Map<number, number>
  previous: Map<number, number>
  motorized: Set<number>
  mode: 'road' | 'rail' | 'walk'
}
const routeCaches = new WeakMap<
  World,
  {
    month: number
    corridors: Map<string, { familiarity: number; traffic: number }>
    trees: Map<string, TravelTree>
  }
>()
export function commuteRoute(w: World, from: number, to: number, limit = 90) {
  if (from === to) return { minutes: 10, cells: [from], mode: 'walk' as const }
  let cache = routeCaches.get(w)
  if (!cache || cache.month !== w.month) {
    cache = {
      month: w.month,
      corridors: new Map((w.corridors ?? []).map((e) => [`${e.a}:${e.b}`, e])),
      trees: new Map(),
    }
    routeCaches.set(w, cache)
  }
  const key = `${from}:${limit}`
  if (!cache.trees.has(key)) cache.trees.set(key, calculateRoutes(w, from, limit, cache.corridors))
  const tree = cache.trees.get(key)!
  if (!tree.distances.has(to)) return null
  const cells = [to]
  while (cells[0] !== from) cells.unshift(tree.previous.get(cells[0])!)
  return {
    minutes: tree.distances.get(to)!,
    cells,
    mode: cells.some((c) => tree.motorized.has(c)) ? tree.mode : ('walk' as const),
  }
}
function calculateRoutes(
  w: World,
  from: number,
  limit: number,
  corridors: Map<string, { familiarity: number; traffic: number }>,
): TravelTree {
  const nation = w.regions[w.cells[from].region].nation
  const technology = w.nations[nation].technologies.logistics
  const mode: 'road' | 'rail' | 'walk' = technology >= 5 ? 'road' : technology >= 3 ? 'rail' : 'walk'
  const heap = new MinHeap(),
    distances = new Map([[from, 0]]),
    previous = new Map<number, number>(),
    motorized = new Set<number>()
  heap.push(from, 0)
  while (heap.size) {
    const current = heap.pop()
    if (current.cost !== distances.get(current.id) || current.cost > limit) continue
    const p = cellPosition(w, current.id)
    for (const next of neighbors(current.id, w.width, w.height)) {
      const cell = w.cells[next],
        region = w.regions[cell.region]
      if (cell.terrain === 'water' || region?.nation !== nation || region.devastation > 0.9) continue
      const q = cellPosition(w, next),
        infrastructure = Math.min(region.infrastructure, w.regions[w.cells[current.id].region].infrastructure)
      const corridor = corridors.get(`${Math.min(current.id, next)}:${Math.max(current.id, next)}`)
      const connected = (corridor?.familiarity ?? 0) > 0.3 && infrastructure > 0.5
      const speed = connected && mode !== 'walk' ? (mode === 'rail' ? 25 : 30) : 4
      const terrain = cell.terrain === 'mountains' ? 2.2 : cell.terrain === 'hills' ? 1.4 : 1
      const congestion = 1 + (corridor?.traffic ?? 0) / (5000 * Math.max(0.1, infrastructure))
      const minutes =
        current.cost + (Math.hypot(p.x - q.x, p.y - q.y) / 1000 / speed) * 60 * terrain * congestion
      if (minutes <= limit && minutes < (distances.get(next) ?? Infinity)) {
        distances.set(next, minutes)
        previous.set(next, current.id)
        if (speed > 4) motorized.add(next)
        else motorized.delete(next)
        heap.push(next, minutes)
      }
    }
  }
  return { distances, previous, mode, motorized }
}
export function recordLocalJob(
  w: World,
  residence: number,
  firm: number,
  stratum: EconomicStratum,
  workers: number,
  paid: number,
) {
  if (!w.adaptive || workers <= 0) return
  const route = `local:${residence}`
  w.adaptive.commuteRoutes ??= {}
  w.adaptive.commuteRoutes[route] = {
    cells: [w.localEconomy!.units[residence].center],
    minutes: 10,
    mode: 'walk',
  }
  recordCommute(w, residence, firm, route, stratum, workers, paid)
}
/** One simultaneous search round after local retained contracts; every payment settles at residence. */
export function matchCommuters(w: World) {
  if (!w.adaptive || !w.economy?.firms) return
  routeCaches.delete(w)
  const regions = economicRegions(w),
    firms = w.economy.firms.filter((f) => f.active && (f.labor?.unfilled ?? 0) > 1e-8)
  type Offer = {
    pool: number
    supply: number[]
    total: number
    available: {
      firm: (typeof firms)[number]
      route: NonNullable<ReturnType<typeof commuteRoute>>
      weight: number
    }[]
  }
  const offers: Offer[] = []
  const buckets = new Map<string, typeof firms>()
  for (const firm of firms) {
    const workplace = w.localEconomy!.units[localFirmRegion(firm)]
    const p = cellPosition(w, firm.cell ?? workplace.center)
    const key = `${Math.floor(p.x / 6000)}:${Math.floor(p.y / 6000)}`
    const list = buckets.get(key) ?? []
    list.push(firm)
    buckets.set(key, list)
  }
  const incoming = new Map<number, number>()
  for (const r of regions) {
    const origin = cellPosition(w, r.center)
    const candidates: typeof firms = []
    const bx = Math.floor(origin.x / 6000),
      by = Math.floor(origin.y / 6000)
    for (let x = bx - 1; x <= bx + 1; x++)
      for (let y = by - 1; y <= by + 1; y++) candidates.push(...(buckets.get(`${x}:${y}`) ?? []))
    candidates.sort((a, b) => a.id - b.id)
    const available = candidates
      .filter((f) => {
        const workplace = w.localEconomy!.units[localFirmRegion(f)]
        const p = cellPosition(w, f.cell ?? workplace.center)
        return (
          workplace.id !== r.id &&
          workplace.nation === r.nation &&
          Math.hypot(origin.x - p.x, origin.y - p.y) <= 6000
        )
      })
      .map((firm) => ({
        firm,
        route: commuteRoute(w, r.center, firm.cell ?? w.localEconomy!.units[localFirmRegion(firm)].center),
      }))
      .filter((x) => x.route !== null)
    const weighted = available.map(({ firm, route }) => ({
      firm,
      route: route!,
      weight: (firm.labor?.unfilled ?? 0) * firm.wage * Math.exp(-route!.minutes / 30),
    }))
    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0)
    if (!total) continue
    const supply = STRATA.map((stratum) => {
      const h = w.economy!.households[r.id][stratum]
      return Math.max(0, h.laborForce - h.employed)
    })
    offers.push({ pool: r.id, supply, total, available: weighted })
    for (const count of supply)
      if (count)
        for (const { firm, weight } of weighted) {
          const workers = ((count * weight) / total) * 0.35
          incoming.set(firm.id, (incoming.get(firm.id) ?? 0) + workers)
        }
  }
  const funding = new Map<number, number>(),
    bills = new Map<number, number>()
  const allocationScale = new Map(
    firms.map((f) => [f.id, Math.min(1, (f.labor?.unfilled ?? 0) / (incoming.get(f.id) ?? Infinity))]),
  )
  // Re-evaluate the factorized offers in the same order; do not allocate millions of duplicate objects.
  function* proposals() {
    for (const offer of offers)
      for (let index = 0; index < STRATA.length; index++) {
        const count = offer.supply[index]
        if (!count) continue
        for (const { firm, route, weight } of offer.available)
          yield {
            pool: offer.pool,
            firm,
            route,
            stratum: STRATA[index],
            workers: ((count * weight) / offer.total) * 0.35 * allocationScale.get(firm.id)!,
          }
      }
  }
  for (const { firm, workers, stratum } of proposals())
    bills.set(firm.id, (bills.get(firm.id) ?? 0) + workers * firm.wage * WAGE_SKILL[stratum])
  for (const firm of firms)
    funding.set(firm.id, Math.min(1, firm.cash / Math.max(1e-12, bills.get(firm.id) ?? 0)))
  for (const { pool, firm, stratum, workers, route } of proposals()) {
    const r = w.localEconomy!.units[pool],
      workplace = w.localEconomy!.units[localFirmRegion(firm)]
    const paid = transfer(
      w,
      firmAccount(firm.id),
      householdAccount(pool, stratum),
      workers * funding.get(firm.id)! * firm.wage * WAGE_SKILL[stratum],
      'commuter wages',
    )
    const actual = firm.wage > 0 ? paid / (firm.wage * WAGE_SKILL[stratum]) : 0
    if (!actual) continue
    const h = w.economy.households[pool][stratum],
      tax = transfer(
        w,
        householdAccount(pool, stratum),
        `government:${r.nation}`,
        paid * collectedTaxRate(w, r),
        'income tax',
      )
    h.employed += actual
    h.income += paid
    h.taxes += tax
    w.nations[r.nation].income += tax
    firm.employment += actual
    firm.payroll += paid
    firm.labor!.hires += actual
    firm.labor!.unfilled = Math.max(0, firm.labor!.unfilled - actual)
    w.economy.producers[workplace.id].payroll += paid
    workplace.employed += actual
    recordWages(w, workplace.id, firmAccount(firm.id), paid)
    const routeId = `${r.center}:${firm.cell ?? workplace.center}`
    w.adaptive.commuteRoutes ??= {}
    w.adaptive.commuteRoutes[routeId] ??= route
    recordCommute(w, pool, firm.id, routeId, stratum, actual, paid)
  }
}
