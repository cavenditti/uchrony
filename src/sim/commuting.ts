import { urbanStreetRoute } from './urban-streets'
import { habitableLand } from './terrain-access'
import { governance } from './governance'
import { localWalkingConnection } from './residential-geometry'
import { recordCommute, type CommuteRow } from './commute-ledger'
import { STRATA, type EconomicStratum } from './economic-types'
import { economicRegions, localFirmRegion } from './local-units'
import { firmAccount, householdAccount, preparePayments } from './ledger'
import { recordWages } from './national-accounts'
import { collectedTaxRate } from './macroeconomy'
import { WAGE_SKILL } from './firms'
import { cellPosition } from './physical-space'
import { snapshotSiteSearch } from './adaptive-grid'
import { syncSites, refreshAdaptiveTotals } from './adaptive-world'
import { movementNeighbors } from './grid'
import { MinHeap } from './heap'
import type { World } from './types'
import type { PhysicalSite } from './adaptive-types'

/** Shortest traversable commuting route. Mode and terrain set travel time, not mesh depth. */
interface TravelTree {
  left: number
  top: number
  width: number
  height: number
  distances: Float64Array
  /** Clockwise parent direction in the low three bits, motorized arrival in bit 3. */
  steps: Uint8Array
  mode: 'road' | 'rail' | 'walk'
}
function treeIndex(w: World, tree: TravelTree, cell: number) {
  const x = (cell % w.width) - tree.left,
    y = Math.floor(cell / w.width) - tree.top
  return x < 0 || x >= tree.width || y < 0 || y >= tree.height ? -1 : y * tree.width + x
}
function treeDistance(w: World, tree: TravelTree, cell: number) {
  const index = treeIndex(w, tree, cell)
  const distance = index < 0 ? Infinity : tree.distances[index]
  return distance === Infinity ? undefined : distance
}
interface TravelEdge {
  to: number
  meters: number
  corridor?: { familiarity: number; traffic: number }
  sides?: [number, number]
}
interface RouteCache {
  month: number
  corridors: Map<string, { familiarity: number; traffic: number }>
  trees: Map<number, Map<number, TravelTree>>
  edges: Map<number, TravelEdge[]>
  scratch: {
    generation: number
    seen: Uint32Array
    distance: Float64Array
    previous: Int32Array
    motorized: Uint8Array
  }
}
const routeCaches = new WeakMap<World, RouteCache>()
const costSnapshots = new WeakMap<World, Map<number, { to: number; minutes: number; motorized: boolean }[]>>()
/** Only for synchronous choice phases that cannot change terrain, ownership,
 * infrastructure, corridors or technology. Costs never survive that phase. */
export function withCommuteCostSnapshot<T>(w: World, run: () => T): T {
  if (costSnapshots.has(w)) return run()
  costSnapshots.set(w, new Map())
  try {
    return run()
  } finally {
    costSnapshots.delete(w)
  }
}
function travelTree(w: World, from: number, limit: number) {
  let cache = routeCaches.get(w)
  if (!cache || cache.month !== w.month) {
    cache = {
      month: w.month,
      corridors: new Map((w.corridors ?? []).map((e) => [`${e.a}:${e.b}`, e])),
      trees: new Map(),
      edges: new Map(),
      scratch: {
        generation: 0,
        seen: new Uint32Array(w.cells.length),
        distance: new Float64Array(w.cells.length),
        previous: new Int32Array(w.cells.length),
        motorized: new Uint8Array(w.cells.length),
      },
    }
    routeCaches.set(w, cache)
  }
  let trees = cache.trees.get(limit)
  if (!trees) cache.trees.set(limit, (trees = new Map()))
  let tree = trees.get(from)
  if (!tree) trees.set(from, (tree = calculateRoutes(w, from, limit, cache)))
  return tree
}
export function commuteRoute(w: World, from: number, to: number, limit = 90) {
  if (!habitableLand(w.cells[from]) || !habitableLand(w.cells[to])) return null
  if (from === to) return { minutes: 10, cells: [from], mode: 'walk' as const }
  const tree = travelTree(w, from, limit)
  const minutes = treeDistance(w, tree, to)
  if (minutes === undefined) return null
  const cells = [to]
  const offsets = [-w.width, -w.width + 1, 1, w.width + 1, w.width, w.width - 1, -1, -w.width - 1]
  while (cells[0] !== from) cells.unshift(cells[0] + offsets[tree.steps[treeIndex(w, tree, cells[0])] & 7])
  return {
    minutes,
    cells,
    mode: cells.some((c) => tree.steps[treeIndex(w, tree, c)] & 8) ? tree.mode : ('walk' as const),
  }
}

const walkMinutes = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  (Math.hypot(a.x - b.x, a.y - b.y) / 1000 / 4) * 60

// Most rejected housing alternatives are several cells away. Reject those
// before constructing the eight-neighbor list for the direct-walk fallback.
const adjacentSamples = (w: World, a: number, b: number) =>
  Math.abs((a % w.width) - (b % w.width)) <= 1 &&
  Math.abs(Math.floor(a / w.width) - Math.floor(b / w.width)) <= 1

/** Choice searches need accessibility or time, not an allocated path for every
 * rejected alternative. The same travel tree and exact local walk decide both. */
function siteMinutes(
  w: World,
  from: Pick<PhysicalSite, 'cell' | 'x' | 'y'>,
  to: Pick<PhysicalSite, 'cell' | 'x' | 'y'>,
  limit: number,
  accessibilityOnly: boolean,
) {
  const street = urbanStreetRoute(w, from, to, limit)
  if (street !== undefined) return street && street.minutes <= limit ? street.minutes : null
  if (from.cell === to.cell) {
    const route = localWalkingConnection(w, from, to, w.regions[w.cells[from.cell].region]?.nation, [
      from.cell,
      to.cell,
    ])
    return route && route.minutes <= limit ? route.minutes : null
  }
  const distance =
    habitableLand(w.cells[from.cell]) && habitableLand(w.cells[to.cell])
      ? treeDistance(w, travelTree(w, from.cell, limit), to.cell)
      : undefined
  const total =
    distance === undefined
      ? Infinity
      : distance + (walkMinutes(from, cellPosition(w, from.cell)) + walkMinutes(to, cellPosition(w, to.cell)))
  let minutes = distance !== undefined && total <= limit ? total : null
  if (accessibilityOnly && minutes !== null) return minutes
  if (
    adjacentSamples(w, from.cell, to.cell) &&
    movementNeighbors(w.cells, from.cell, w.width, w.height).includes(to.cell)
  ) {
    const direct = localWalkingConnection(w, from, to, w.regions[w.cells[from.cell].region].nation, [
      from.cell,
      to.cell,
    ])
    if (direct && direct.minutes <= limit && (minutes === null || direct.minutes < minutes))
      minutes = direct.minutes
  }
  return minutes
}
export function commuteSiteMinutes(
  w: World,
  from: Pick<PhysicalSite, 'cell' | 'x' | 'y'>,
  to: Pick<PhysicalSite, 'cell' | 'x' | 'y'>,
  limit = 90,
) {
  return siteMinutes(w, from, to, limit, false)
}
export function canCommuteSites(
  w: World,
  from: Pick<PhysicalSite, 'cell' | 'x' | 'y'>,
  to: Pick<PhysicalSite, 'cell' | 'x' | 'y'>,
  limit = 90,
) {
  return siteMinutes(w, from, to, limit, true) !== null
}

/** Fixed-position housing choices share access walks and one lazy tree lookup
 * per origin. Tree creation remains lazy: a same-cell-only search must not seed
 * the monthly route cache before a later phase changes roads or ownership. */
export function snapshotSiteAccessibility(w: World, limit: number) {
  const walks = new Map<PhysicalSite, number>()
  const accessWalk = (site: PhysicalSite) => {
    let minutes = walks.get(site)
    if (minutes === undefined) walks.set(site, (minutes = walkMinutes(site, cellPosition(w, site.cell))))
    return minutes
  }
  return (from: PhysicalSite) => {
    let tree: TravelTree | undefined
    let neighbors: number[] | undefined
    return (to: PhysicalSite) => {
      if (from.cell === to.cell) return canCommuteSites(w, from, to, limit)
      if (habitableLand(w.cells[from.cell]) && habitableLand(w.cells[to.cell])) {
        tree ??= travelTree(w, from.cell, limit)
        const distance = treeDistance(w, tree, to.cell)
        if (distance !== undefined && distance + (accessWalk(from) + accessWalk(to)) <= limit) return true
      }
      if (!adjacentSamples(w, from.cell, to.cell)) return false
      neighbors ??= movementNeighbors(w.cells, from.cell, w.width, w.height)
      if (!neighbors.includes(to.cell)) return false
      const direct = localWalkingConnection(w, from, to, w.regions[w.cells[from.cell].region].nation, [
        from.cell,
        to.cell,
      ])
      return direct !== null && direct.minutes <= limit
    }
  }
}

/** Door-to-door access uses persistent meter positions, including travel inside one terrain sample.
 * Inter-cell roads remain surveyed physical links; remeshing never adds a free road. */
export function commuteSiteRoute(
  w: World,
  from: Pick<PhysicalSite, 'cell' | 'x' | 'y'>,
  to: Pick<PhysicalSite, 'cell' | 'x' | 'y'>,
  limit = 90,
) {
  const street = urbanStreetRoute(w, from, to, limit)
  if (street !== undefined) return street
  if (from.cell === to.cell) {
    const route = localWalkingConnection(w, from, to, w.regions[w.cells[from.cell].region]?.nation, [
      from.cell,
      to.cell,
    ])
    return route && route.minutes <= limit ? route : null
  }
  const access = walkMinutes(from, cellPosition(w, from.cell)) + walkMinutes(to, cellPosition(w, to.cell))
  const route = commuteRoute(w, from.cell, to.cell, limit)
  const network =
    route && route.minutes + access <= limit
      ? {
          ...route,
          minutes: route.minutes + access,
          points: [
            { x: from.x, y: from.y },
            ...route.cells.map((id) => cellPosition(w, id)),
            { x: to.x, y: to.y },
          ],
        }
      : null
  // Adjacent source cells are a survey reference, not compulsory waypoints for
  // pedestrians living next to their shared edge.
  if (
    adjacentSamples(w, from.cell, to.cell) &&
    movementNeighbors(w.cells, from.cell, w.width, w.height).includes(to.cell)
  ) {
    const direct = localWalkingConnection(w, from, to, w.regions[w.cells[from.cell].region].nation, [
      from.cell,
      to.cell,
    ])
    if (direct && direct.minutes <= limit && (!network || direct.minutes < network.minutes)) return direct
  }
  return network
}
function calculateRoutes(w: World, from: number, limit: number, cache: RouteCache): TravelTree {
  const nation = w.regions[w.cells[from].region].nation
  const technology = governance(w, nation).technologies.logistics
  const mode: 'road' | 'rail' | 'walk' = technology >= 5 ? 'road' : technology >= 3 ? 'rail' : 'walk'
  const heap = new MinHeap(),
    scratch = cache.scratch,
    reached = [from],
    snapshot = costSnapshots.get(w)
  if (++scratch.generation === 2 ** 32) {
    scratch.seen.fill(0)
    scratch.generation = 1
  }
  const generation = scratch.generation
  scratch.seen[from] = generation
  scratch.distance[from] = 0
  scratch.motorized[from] = 0
  heap.push(from, 0)
  const current = { id: 0, cost: 0 }
  while (heap.size) {
    heap.popInto(current)
    if (current.cost !== scratch.distance[current.id] || current.cost > limit) continue
    // Every origin reuses physical edge geometry within the existing route-cache
    // lifetime. Costs still read live ownership, damage, roads and congestion.
    let edges = cache.edges.get(current.id)
    if (!edges) {
      const p = cellPosition(w, current.id),
        x = current.id % w.width,
        y = Math.floor(current.id / w.width)
      edges = movementNeighbors(w.cells, current.id, w.width, w.height).map((next) => {
        const q = cellPosition(w, next),
          nx = next % w.width,
          ny = Math.floor(next / w.width)
        return {
          to: next,
          meters: Math.hypot(p.x - q.x, p.y - q.y),
          corridor: cache.corridors.get(`${Math.min(current.id, next)}:${Math.max(current.id, next)}`),
          ...(x !== nx && y !== ny
            ? { sides: [y * w.width + nx, ny * w.width + x] as [number, number] }
            : {}),
        }
      })
      cache.edges.set(current.id, edges)
    }
    let costs = snapshot?.get(current.id)
    if (!costs) {
      costs = []
      for (const edge of edges) {
        const next = edge.to
        const cell = w.cells[next],
          region = w.regions[cell.region]
        if (cell.terrain === 'water' || region?.nation !== nation || region.devastation > 0.9) continue
        if (
          edge.sides?.some((id) => {
            const side = w.regions[w.cells[id].region]
            return side?.nation !== nation || side.devastation > 0.9
          })
        )
          continue
        const infrastructure = Math.min(
          region.infrastructure,
          w.regions[w.cells[current.id].region].infrastructure,
        )
        const corridor = edge.corridor
        const connected = (corridor?.familiarity ?? 0) > 0.3 && infrastructure > 0.5
        const speed = connected && mode !== 'walk' ? (mode === 'rail' ? 25 : 30) : 4
        const terrain = cell.terrain === 'mountains' ? 2.2 : cell.terrain === 'hills' ? 1.4 : 1
        const congestion = 1 + (corridor?.traffic ?? 0) / (5000 * Math.max(0.1, infrastructure))
        costs.push({
          to: next,
          minutes: (edge.meters / 1000 / speed) * 60 * terrain * congestion,
          motorized: speed > 4,
        })
      }
      snapshot?.set(current.id, costs)
    }
    for (const edge of costs) {
      const next = edge.to,
        minutes = current.cost + edge.minutes
      if (minutes <= limit && (scratch.seen[next] !== generation || minutes < scratch.distance[next])) {
        if (scratch.seen[next] !== generation) reached.push(next)
        scratch.seen[next] = generation
        scratch.distance[next] = minutes
        scratch.previous[next] = current.id
        scratch.motorized[next] = Number(edge.motorized)
        heap.push(next, minutes)
      }
    }
  }
  // Most trees span only a few terrain samples. A compact bounding rectangle
  // avoids millions of Map entries and parent objects retained for the month.
  let left = w.width,
    right = 0,
    top = w.height,
    bottom = 0
  for (const id of reached) {
    const x = id % w.width,
      y = Math.floor(id / w.width)
    left = Math.min(left, x)
    right = Math.max(right, x)
    top = Math.min(top, y)
    bottom = Math.max(bottom, y)
  }
  const width = right - left + 1,
    height = bottom - top + 1
  const distances = new Float64Array(width * height).fill(Infinity),
    steps = new Uint8Array(width * height)
  for (const id of reached) {
    const index = (Math.floor(id / w.width) - top) * width + (id % w.width) - left
    distances[index] = scratch.distance[id]
    if (id === from) continue
    const parent = scratch.previous[id]
    const dx = (parent % w.width) - (id % w.width),
      dy = Math.floor(parent / w.width) - Math.floor(id / w.width)
    const direction =
      dy < 0 ? (dx < 0 ? 7 : dx > 0 ? 1 : 0) : dy > 0 ? (dx < 0 ? 5 : dx > 0 ? 3 : 4) : dx < 0 ? 6 : 2
    steps[index] = direction | (scratch.motorized[id] ? 8 : 0)
  }
  return { left, top, width, height, distances, steps, mode }
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
export type CommuteCandidates = Map<
  number,
  Map<number, { route: NonNullable<ReturnType<typeof commuteRoute>>; id: string }>
>

/** Prior journeys preserve route identifiers only; vacancies and access must be searched afresh. */
export function knownCommuteCandidates(w: World): CommuteCandidates | undefined {
  if (!w.adaptive?.commutingRows) return undefined
  const candidates: CommuteCandidates = new Map()
  for (const [residence, firm, id] of w.adaptive.commutingRows) {
    if (id.startsWith('local:')) continue
    const route = w.adaptive.commuteRoutes?.[id]
    if (!route) continue
    let pool = candidates.get(residence)
    if (!pool) candidates.set(residence, (pool = new Map()))
    pool.set(firm, { route, id })
  }
  return candidates
}
/** One simultaneous search round after local retained contracts; every payment settles at residence. */
export function matchCommuters(w: World, known?: CommuteCandidates) {
  return withCommuteCostSnapshot(w, () => matchCommuterOffers(w, known))
}
function matchCommuterOffers(w: World, known?: CommuteCandidates) {
  if (!w.adaptive || !w.economy?.firms) return
  // Newly opened/closed workplaces must enter the active grid before candidate search.
  syncSites(w)
  refreshAdaptiveTotals(w)
  routeCaches.delete(w)
  const regions = economicRegions(w),
    firms = w.economy.firms.filter((f) => f.active && (f.labor?.unfilled ?? 0) > 1e-8)
  const payments = preparePayments(w)
  type Offer = {
    pool: number
    supply: number[]
    total: number
    available: typeof firms
    weights: number[]
    routes: { route: NonNullable<ReturnType<typeof commuteRoute>>; id: string }[]
  }
  const offers: Offer[] = []
  const bySite = new Map(firms.map((firm) => [`firm:${firm.id}`, firm]))
  const search = snapshotSiteSearch(w, (site) => bySite.has(site.id))
  const size = w.economy.firms.length
  const incoming = new Float64Array(size),
    proposed = new Uint8Array(size)
  const accounts = firms.reduce(
    (result, f) => {
      result[f.id] = payments.account(firmAccount(f.id))
      return result
    },
    [] as ReturnType<typeof payments.account>[],
  )
  for (const r of regions) {
    const supply = STRATA.map((stratum) => {
      const h = w.economy!.households[r.id][stratum]
      return Math.max(0, h.laborForce - h.employed)
    })
    if (!supply.some((count) => count > 0)) continue
    const origin = cellPosition(w, r.center)
    const routes = new Map<number, Offer['routes'][number] | null>()
    const retained = known?.get(r.id)
    const candidates = search(origin, 6000)
      .map((site) => bySite.get(site.id)!)
      .sort((a, b) => a.id - b.id)
    const available: typeof firms = [],
      weights: number[] = [],
      journeys: Offer['routes'] = []
    let total = 0
    for (const firm of candidates) {
      const workplace = w.localEconomy!.units[localFirmRegion(firm)]
      const cell = firm.cell ?? workplace.center,
        p = cellPosition(w, cell)
      if (
        workplace.id === r.id ||
        workplace.nation !== r.nation ||
        Math.hypot(origin.x - p.x, origin.y - p.y) > 6000
      )
        continue
      if (!routes.has(cell)) {
        const previous = retained?.get(firm.id)
        const route = commuteRoute(w, r.center, cell)
        const sameEndpoints = previous?.route.cells[0] === r.center && previous.route.cells.at(-1) === cell
        routes.set(cell, route ? { route, id: sameEndpoints ? previous.id : `${r.center}:${cell}` } : null)
      }
      const journey = routes.get(cell)!
      if (!journey) continue
      const weight = (firm.labor?.unfilled ?? 0) * firm.wage * Math.exp(-journey.route.minutes / 30)
      available.push(firm)
      weights.push(weight)
      journeys.push(journey)
      total += weight
    }
    if (!total) continue
    offers.push({ pool: r.id, supply, total, available, weights, routes: journeys })
    for (const count of supply)
      if (count)
        for (let i = 0; i < available.length; i++) {
          const firm = available[i],
            weight = weights[i]
          const workers = ((count * weight) / total) * 0.35
          incoming[firm.id] += workers
          proposed[firm.id] = 1
        }
  }
  const funding = new Float64Array(size),
    bills = new Float64Array(size),
    allocationScale = new Float64Array(size)
  for (const f of firms)
    allocationScale[f.id] = Math.min(
      1,
      (f.labor?.unfilled ?? 0) / (proposed[f.id] ? incoming[f.id] : Infinity),
    )
  // Preserve origin/stratum/firm order and every floating-point operation,
  // without allocating a proposal object for each pass over the wage bill.
  for (const offer of offers)
    for (let index = 0; index < STRATA.length; index++) {
      const count = offer.supply[index],
        stratum = STRATA[index]
      if (!count) continue
      for (let i = 0; i < offer.available.length; i++) {
        const firm = offer.available[i],
          weight = offer.weights[i]
        const workers = ((count * weight) / offer.total) * 0.35 * allocationScale[firm.id]
        bills[firm.id] += workers * firm.wage * WAGE_SKILL[stratum]
      }
    }
  for (const firm of firms) funding[firm.id] = Math.min(1, firm.cash / Math.max(1e-12, bills[firm.id]))
  for (const offer of offers) {
    const commutes: (CommuteRow | undefined)[] = []
    const pool = offer.pool,
      r = w.localEconomy!.units[pool],
      taxRate = collectedTaxRate(w, r),
      government = payments.account(`government:${r.nation}`)
    for (let index = 0; index < STRATA.length; index++) {
      const count = offer.supply[index],
        stratum = STRATA[index],
        account = payments.account(householdAccount(pool, stratum)),
        h = w.economy.households[pool][stratum]
      if (!count) continue
      for (let i = 0; i < offer.available.length; i++) {
        const firm = offer.available[i],
          weight = offer.weights[i],
          payer = accounts[firm.id],
          workplace = w.localEconomy!.units[localFirmRegion(firm)]
        const workers = ((count * weight) / offer.total) * 0.35 * allocationScale[firm.id]
        const paid = payments.transfer(
          payer,
          account,
          workers * funding[firm.id] * firm.wage * WAGE_SKILL[stratum],
          'commuter wages',
        )
        const actual = firm.wage > 0 ? paid / (firm.wage * WAGE_SKILL[stratum]) : 0
        if (!actual) continue
        const tax = payments.transfer(account, government, paid * taxRate, 'income tax')
        h.employed += actual
        h.income += paid
        h.taxes += tax
        if (r.nation >= 0) w.nations[r.nation].income += tax
        firm.employment += actual
        firm.payroll += paid
        firm.labor!.hires += actual
        firm.labor!.unfilled = Math.max(0, firm.labor!.unfilled - actual)
        w.economy.producers[workplace.id].payroll += paid
        workplace.employed += actual
        recordWages(w, workplace.id, payer.name, paid)
        const row = commutes[i]
        if (row) {
          row[3 + index] = (row[3 + index] as number) + actual
          row[8 + index] = (row[8 + index] as number) + paid
        } else {
          const { route, id } = offer.routes[i]
          w.adaptive.commuteRoutes ??= {}
          w.adaptive.commuteRoutes[id] ??= route
          commutes[i] = recordCommute(w, pool, firm.id, id, stratum, actual, paid)
        }
      }
    }
  }
}
