import { renewFishStocks } from './resource-extraction'
/** Provincial production and trade clear physical goods against conserved money.
 * District routing has finer geography but shares the same political tariff rules. */
import { knownCommuteCandidates, matchCommuters } from './commuting'
import { parameterGroup } from './configuration-context'
import { tradeDistricts } from './district-transport'
import { ensureFirms, hireFirms, produceFirms } from './firms'
import { governance } from './governance'
import { plannedInputDemand } from './production-chains'
import { MinHeap } from './heap'
import { balance, ensureEconomy, producerAccount, publicGoods } from './ledger'
import { economicRegions } from './local-units'
import { consumeHouseholds, finishProduction, recordTrade } from './macroeconomy'
import { MODEL_PARAMETERS as P } from './model-parameters'
import { marketStore } from './national-accounts'
import { refreshRetailQuote } from './retail-pricing'
import { seaPassageView } from './naval-control'
import { periodFlow } from './simulation-period'
import { tradePolicy } from './trade-policy'
import { tradeRaidView } from './trade-raids'
import {
  GOODS,
  inventory,
  population,
  relation,
  type Good,
  type Inventory,
  type Region,
  type Route,
  type RouteLeg,
  type World,
} from './types'

import { agreementTerms, diplomaticAccessView } from './agreements'
import {
  corridorCost,
  corridorProfile,
  corridorUsage,
  learnCorridors,
  type CorridorProfile,
} from './corridors'
import { retainRoadBackbone } from './road-backbone'
import {
  establishedPath,
  laneKey,
  pathCost,
  rememberedTrade,
  rememberShipments,
  TRADE_INERTIA,
} from './trade-memory'
import { refreshTransport, reverseLegs, transportNetwork } from './transport'

export const BASE_PRICE: Inventory = parameterGroup('basePrices')
export const MONTHLY_NEED: Inventory = parameterGroup('householdNeeds')

/** Food-equivalent consumers distinguish children's energy needs from adult rations. */
export function foodEquivalentPeople(population: Region['population']) {
  return (
    population.children * P.childFoodEquivalent +
    population.adults +
    population.elders * P.elderFoodEquivalent
  )
}
export function householdNeed(r: Region, good: Good) {
  const livingStandard =
      good === 'food'
        ? 0.95 + r.urban * 0.15
        : 0.65 + r.urban * 1.3 + r.infrastructure * 0.3 + r.industry * 0.3,
    allocation = good === 'arms' ? 0.15 : good === 'iron' || good === 'coal' ? 0.25 : 1
  return (
    (good === 'food' ? foodEquivalentPeople(r.population) : population(r)) *
    MONTHLY_NEED[good] *
    livingStandard *
    periodFlow(allocation)
  )
}
/** Prospective retail orders are not compulsory household rations. They let a
 * new edible substitute or luxury reach a market before its first actual sale. */
export function marketNeed(r: Region, good: Good) {
  const staple = householdNeed(r, 'food')
  if (good === 'bread') return staple * 0.18
  if (good === 'fish') return staple * 0.18
  if (good === 'preservedFood') return staple * 0.06
  if (good === 'jewelry')
    return population(r) * 0.000002 * Math.max(0, (r.materialCoverage ?? 1) - 0.5) * periodFlow(1)
  if (good === 'bricks') return householdNeed(r, 'stone') * 0.5
  if (good === 'rope') return householdNeed(r, 'tools') * 0.2
  return householdNeed(r, good)
}
export function reserveTarget(r: Region, good: Good) {
  const inputs = plannedInputDemand(r.plannedProduction ?? r.production, good, r)
  return marketNeed(r, good) * (good === 'food' ? 2.4 : 3) + inputs * 2
}

export function produce(world: World, coarse = false) {
  renewFishStocks(world)
  ensureFirms(world)
  if (world.adaptive) {
    const known = coarse ? knownCommuteCandidates(world) : undefined
    world.adaptive.commuting = []
    world.adaptive.commutingRows = []
    world.adaptive.commuteRoutes = {}
    for (const r of economicRegions(world)) hireFirms(world, r)
    matchCommuters(world, known)
  }
  for (const r of economicRegions(world)) {
    for (const g of GOODS) if (!r.prices[g]) r.prices[g] = BASE_PRICE[g]
    r.migration = 0
    produceFirms(world, r, !!world.adaptive)
    finishProduction(world, r)
  }
}

export interface Edge {
  to: number
  cost: number
  capacity: number
  sea: boolean
  legs: RouteLeg[]
}
export type Graph = Edge[][]

// Physical link work is shared by civilian freight and each army's directional access view.
// The profile is an explicit phase snapshot, so later damage, ownership or sea control is not cached here.
const linkMetrics = new WeakMap<CorridorProfile, Map<object, { capacity: number; cost: number }>>()
export function transportGraph(
  world: World,
  militaryNation?: number,
  profile = corridorProfile(world),
  civilianNation?: number,
): Graph {
  const graph: Graph = world.regions.map(() => []),
    access = diplomaticAccessView(world),
    policy = tradePolicy(world)
  let metrics = linkMetrics.get(profile)
  if (!metrics) {
    metrics = new Map()
    linkMetrics.set(profile, metrics)
  }
  const passage = seaPassageView(world)
  const allowed = (a: Region, b: Region, legs: RouteLeg[]) => {
    if (militaryNation === undefined)
      return (
        policy.routeAllowed(a.nation, b.nation, legs) &&
        (civilianNation === undefined || policy.routeAllowed(civilianNation, civilianNation, legs))
      )
    // Exit from a revoked host remains possible. Every later land/harbor cell
    // must admit the formation; a long surveyed road cannot bypass neutral land.
    for (const leg of legs)
      for (const cell of leg.cells) {
        const r = world.regions[world.cells[cell]?.region]
        if (!r || world.cells[cell].terrain === 'water' || r.id === a.id) continue
        if (
          r.nation !== militaryNation &&
          relation(world, militaryNation, r.nation)?.treaty !== 'war' &&
          !access(militaryNation, r.nation, 'transit', r.id)
        )
          return false
      }
    return (
      b.nation === militaryNation ||
      relation(world, militaryNation, b.nation)?.treaty === 'war' ||
      access(militaryNation, b.nation, 'transit', b.id)
    )
  }
  for (const link of transportNetwork(world).links) {
    const a = world.regions[link.from],
      b = world.regions[link.to]
    let physical = metrics.get(link)
    if (!physical) {
      let capacity = Infinity
      for (const [index, count] of corridorUsage(profile, link.legs))
        capacity = Math.min(capacity, profile.capacity[index] / count)
      physical = { capacity, cost: corridorCost(profile, link.legs) }
      metrics.set(link, physical)
    }
    const capacity =
        physical.capacity *
        (link.seaCost > 0
          ? militaryNation !== undefined
            ? passage(militaryNation, link.legs)
            : Math.min(
                passage(civilianNation ?? a.nation, link.legs),
                passage(civilianNation ?? b.nation, link.legs),
              )
          : 1),
      cost = physical.cost,
      sea = link.seaCost > 0
    if (capacity > 0.001 && allowed(a, b, link.legs))
      graph[a.id].push({ to: b.id, cost, capacity, sea, legs: link.legs })
    if (capacity > 0.001 && allowed(b, a, link.legs))
      graph[b.id].push({ to: a.id, cost, capacity, sea, legs: reverseLegs(link.legs) })
  }
  if (militaryNation === undefined) retainRoadBackbone(world, graph.entries())
  return graph
}
export function shortestPaths(graph: Graph, from: number) {
  const distance = new Float64Array(graph.length).fill(Infinity),
    previous = new Int32Array(graph.length).fill(-1),
    queue = new MinHeap()
  distance[from] = 0
  queue.push(from, 0)
  while (queue.size) {
    const at = queue.pop()!
    if (at.cost !== distance[at.id]) continue
    for (const edge of graph[at.id])
      if (distance[edge.to] > at.cost + edge.cost) {
        distance[edge.to] = at.cost + edge.cost
        previous[edge.to] = at.id
        queue.push(edge.to, distance[edge.to])
      }
  }
  return { distance, previous }
}

export function pathTo(previous: Int32Array, from: number, to: number): number[] {
  if (from === to) return [from]
  const path = [to]
  while (path[0] !== from && path.length <= previous.length) {
    const p = previous[path[0]]
    if (p < 0) return []
    path.unshift(p)
  }
  return path[0] === from ? path : []
}

export function trade(world: World) {
  if (world.localEconomy) return tradeDistricts(world)
  ensureEconomy(world)
  // Demand targets do not change while goods change hands this month.
  const targets = Object.fromEntries(
    GOODS.map((good) => [good, world.regions.map((r) => reserveTarget(r, good))]),
  ) as Record<Good, number[]>
  const target = (region: Region, good: Good) => targets[good][region.id]
  const policy = tradePolicy(world),
    raid = tradeRaidView(world),
    passage = seaPassageView(world)
  const profile = corridorProfile(world)
  refreshTransport(world, profile)
  const graph = transportGraph(world, undefined, profile),
    physicalCapacity = profile.capacity.map(periodFlow),
    capacity = new Map<string, number>(),
    routes = new Map<string, Route>(),
    memory = rememberedTrade(world)
  const key = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`
  for (let a = 0; a < graph.length; a++)
    for (const e of graph[a]) capacity.set(key(a, e.to), periodFlow(e.capacity))
  const nationalGraphs = new Map<number, Graph>()
  const graphFor = (nation: number) => {
    let view = nationalGraphs.get(nation)
    if (!view) {
      view = graph.map((edges) => edges.filter((edge) => policy.routeAllowed(nation, nation, edge.legs)))
      nationalGraphs.set(nation, view)
    }
    return view
  }
  // Only opening surpluses may be exported: bought cargo cannot be resold in
  // the same clearing phase to evade origin restrictions through a neutral market.
  const exportable = new Map(
    world.regions.map((r) => [
      r.id,
      Object.fromEntries(GOODS.map((g) => [g, Math.max(0, r.stocks[g] - target(r, g))])) as Inventory,
    ]),
  )
  const quotas = new Map<string, number>()
  const routeCapacity = (
    id: string,
    a: number,
    b: number,
    legs: RouteLeg[],
    usage: ReadonlyMap<number, number>,
    available: number,
  ) => {
    if (!quotas.has(id)) {
      // The quota belongs to the physical route, not the first order's size.
      // Apply naval attenuation once here; shared edge limits still apply below.
      let capacity = Infinity
      for (const [index, count] of usage)
        capacity = Math.min(capacity, periodFlow(profile.capacity[index]) / count)
      quotas.set(
        id,
        capacity *
          (policy.routeRestricted(a, b, legs) ? 0.2 : 1) *
          Math.min(passage(a, legs), passage(b, legs)),
      )
    }
    return Math.min(available, quotas.get(id)!)
  }
  const pathCache = new Map<number, ReturnType<typeof shortestPaths>>(),
    plans = new Map<
      string,
      {
        path: number[]
        cost: number
        blocked?: boolean
        physical?: { legs: RouteLeg[]; usage: ReadonlyMap<number, number> }
      }
    >()
  const markets = new Map<number, { seller: Region; id: string; score: number; flow?: Inventory }[]>()
  world.routes = []
  for (const { offer, term } of agreementTerms(world, 'goods')) {
    const buyers = world.regions
      .filter((region) => region.nation === term.to)
      .sort(
        (a, b) =>
          a.stocks[term.good as Good] / Math.max(1, population(a)) -
          b.stocks[term.good as Good] / Math.max(1, population(b)),
      )
    const good = term.good as Good
    let owed = term.amount
    for (const buyer of buyers) {
      if (owed < 0.1) break
      const paths = shortestPaths(graphFor(buyer.nation), buyer.id)
      const sellers = world.regions
        .filter(
          (region) =>
            region.nation === term.from &&
            policy.allowed(buyer.nation, region.nation, good) &&
            region.stocks[good] > target(region, good) &&
            Number.isFinite(paths.distance[region.id]),
        )
        .sort((a, b) => paths.distance[a.id] - paths.distance[b.id])
      for (const seller of sellers) {
        if (owed < 0.1) break
        const path = pathTo(paths.previous, buyer.id, seller.id).reverse(),
          legs = path.slice(1).flatMap((to, i) => graph[path[i]].find((edge) => edge.to === to)!.legs),
          usage = corridorUsage(profile, legs),
          edgeKeys = path.slice(1).map((to, i) => key(path[i], to))
        if (!policy.routeAllowed(seller.nation, buyer.nation, legs, good)) continue
        let amount = Math.min(
          owed,
          exportable.get(seller.id)![good],
          world.nations[term.from].treasury / Math.max(1e-9, seller.prices[good] / 1000),
          seller.stocks[good] - target(seller, good),
          Math.max(0, target(buyer, good) * 4 - buyer.stocks[good]),
          ...edgeKeys.map((edge) => capacity.get(edge) ?? 0),
        )
        for (const [index, count] of usage) amount = Math.min(amount, physicalCapacity[index] / count)
        const quotaId = laneKey(seller.id, buyer.id)
        amount = routeCapacity(quotaId, seller.nation, buyer.nation, legs, usage, amount)
        if (amount < 0.1) continue
        publicGoods(world, term.from, seller.id, good, amount, marketStore(buyer.id))
        seller.stocks[good] -= amount
        buyer.stocks[good] += amount
        const delivered = raid(seller.id, buyer.id, good, amount, legs)
        exportable.get(seller.id)![good] -= amount
        quotas.set(quotaId, quotas.get(quotaId)! - amount)
        refreshRetailQuote(world, buyer, good)
        owed -= delivered
        offer.delivered += delivered
        for (const edge of edgeKeys) capacity.set(edge, capacity.get(edge)! - amount)
        for (const [index, count] of usage) physicalCapacity[index] -= amount * count
        const id = `${seller.id}-${buyer.id}`,
          existing = routes.get(id)
        if (existing) {
          existing.goods[good] += amount
          existing.volume += amount
        } else
          routes.set(id, {
            id,
            from: seller.id,
            to: buyer.id,
            path,
            legs,
            sea: legs.some((leg) => leg.mode === 'sea'),
            goods: { ...inventory(), [good]: amount },
            volume: amount,
            value: 0,
            capacity: amount,
            international: seller.nation !== buyer.nation,
          })
      }
    }
    if (owed > 0.1) offer.breaches++
  }
  for (const g of GOODS) {
    const establishedBuyers = new Set(
      [...memory.values()].filter((lane) => lane.flow[g] >= 0.1).map((lane) => lane.to),
    )
    // Established buyers replenish small shortfalls instead of cycling between
    // a large order and a silent month at the 90% reorder threshold.
    const buyers = world.regions
      .filter((r) => r.stocks[g] < target(r, g) * (establishedBuyers.has(r.id) ? 1 : 0.9))
      .sort(
        (a, b) =>
          a.stocks[g] / Math.max(1, reserveTarget(a, g)) - b.stocks[g] / Math.max(1, reserveTarget(b, g)) ||
          a.id - b.id,
      )
    for (const buyer of buyers) {
      let needed = target(buyer, g) - buyer.stocks[g]
      if (!pathCache.has(buyer.id)) pathCache.set(buyer.id, shortestPaths(graphFor(buyer.nation), buyer.id))
      const paths = pathCache.get(buyer.id)!
      if (!markets.has(buyer.id)) {
        const suppliers = world.regions
          .filter(
            (s) =>
              s.id !== buyer.id &&
              Number.isFinite(paths.distance[s.id]) &&
              policy.allowed(s.nation, buyer.nation),
          )
          .map((seller) => {
            const id = laneKey(seller.id, buyer.id),
              prior = memory.get(id)
            if (prior && !plans.has(id)) {
              const best = pathTo(paths.previous, buyer.id, seller.id).reverse(),
                path = routes.get(id)?.path ?? establishedPath(graphFor(buyer.nation), prior.path, best)
              plans.set(id, { path, cost: pathCost(graph, path) })
            }
            return {
              seller,
              id,
              score:
                (plans.get(id)?.cost ?? paths.distance[seller.id]) *
                (seller.nation === buyer.nation ? 0.6 : 1),
              flow: prior?.flow,
            }
          })
          .sort((a, b) => a.score - b.score || a.seller.id - b.seller.id)
        markets.set(buyer.id, suppliers)
      }
      // Provincial merchants have finite search capacity. At continental/world
      // scale they canvass nearby competitive suppliers each month, alongside
      // every established partner, rather than querying the entire planet for
      // each order. Logistics and commercial infrastructure broaden that reach.
      const contacts =
        world.regions.length <= 300
          ? Infinity
          : Math.round(
              16 + buyer.infrastructure * 16 + governance(world, buyer.nation).technologies.logistics * 8,
            )
      let newcomers = 0
      const candidates = markets
        .get(buyer.id)!
        .map((candidate) => ({
          ...candidate,
          score: candidate.score * (candidate.seller.prices[g] / BASE_PRICE[g]),
        }))
        .sort((a, b) => a.score - b.score || a.seller.id - b.seller.id)
        .filter((candidate) => {
          const prior = candidate.flow?.[g] ?? 0
          if (
            plans.get(candidate.id)?.blocked ||
            candidate.seller.stocks[g] <= target(candidate.seller, g) * (prior >= 0.1 ? 1 : 1.1)
          )
            return false
          if (prior >= 0.1) return true
          return newcomers++ < contacts
        })
      if (!candidates.length) continue
      const transfer = (candidate: (typeof candidates)[number], requested: number) => {
        const { seller } = candidate
        if (needed < 0.1 || requested < 0.1) return
        const planId = laneKey(seller.id, buyer.id)
        if (!plans.has(planId)) {
          const path = pathTo(paths.previous, buyer.id, seller.id).reverse()
          plans.set(planId, { path, cost: paths.distance[seller.id] })
        }
        const plan = plans.get(planId)!,
          path = plan.path
        if (path.length < 2 || !Number.isFinite(plan.cost)) return
        const edgeKeys = path.slice(1).map((id, i) => key(path[i], id))
        let available = Math.min(...edgeKeys.map((k) => capacity.get(k) ?? 0))
        if (available < 0.1) {
          plan.blocked = true
          return
        }
        if (!plan.physical) {
          const legs = path.slice(1).flatMap((to, i) => graph[path[i]].find((edge) => edge.to === to)!.legs)
          plan.physical = { legs, usage: corridorUsage(profile, legs) }
        }
        const { legs, usage } = plan.physical
        if (!policy.routeAllowed(seller.nation, buyer.nation, legs, g)) return
        for (const [index, count] of usage) available = Math.min(available, physicalCapacity[index] / count)
        if (available < 0.1) {
          plan.blocked = true
          return
        }
        available = routeCapacity(planId, seller.nation, buyer.nation, legs, usage, available)
        const international = seller.nation !== buyer.nation
        const unitPrice = seller.prices[g] / 1000
        const freightRate = Math.min(0.5, plan.cost * 0.001) * unitPrice
        const tariff = policy.tariff(buyer.nation, seller.nation)
        const affordable =
          balance(world, producerAccount(buyer.id)) / Math.max(1e-12, unitPrice * (1 + tariff) + freightRate)
        const amount = Math.max(
          0,
          Math.min(
            requested,
            needed,
            seller.stocks[g] - target(seller, g),
            exportable.get(seller.id)![g],
            available,
            affordable,
          ),
        )
        if (amount < 0.1) return
        seller.stocks[g] -= amount
        buyer.stocks[g] += amount
        edgeKeys.forEach((k) => capacity.set(k, capacity.get(k)! - amount))
        for (const [index, count] of usage) physicalCapacity[index] -= amount * count
        const value = amount * unitPrice
        recordTrade(world, seller.id, buyer.id, g, amount, unitPrice, amount * freightRate, tariff)
        const delivered = raid(seller.id, buyer.id, g, amount, legs)
        needed -= delivered
        exportable.get(seller.id)![g] -= amount
        quotas.set(planId, quotas.get(planId)! - amount)
        refreshRetailQuote(world, buyer, g, unitPrice * (1 + tariff) + freightRate)
        const id = `${seller.id}-${buyer.id}`,
          existing = routes.get(id)
        if (existing) {
          existing.goods[g] += amount
          existing.volume += amount
          existing.value += value
        } else {
          const goods = inventory()
          goods[g] = amount
          const sea = path.slice(1).some((id, i) => graph[path[i]].find((e) => e.to === id)?.sea)
          routes.set(id, {
            id,
            from: seller.id,
            to: buyer.id,
            path,
            legs,
            sea,
            goods,
            volume: amount,
            value,
            capacity: available,
            international,
          })
        }
      }
      const established = candidates.filter((candidate) => (candidate.flow?.[g] ?? 0) >= 0.1),
        previousTotal = established.reduce((sum, candidate) => sum + (candidate.flow?.[g] ?? 0), 0),
        initialNeed = needed,
        urgentFood = g === 'food' && buyer.stocks.food < population(buyer) * MONTHLY_NEED.food
      if (!urgentFood && previousTotal > 0) {
        for (const candidate of established) {
          // Preserve normal supplier shares. When a meaningfully better option
          // appears, release a small monthly share instead of replacing the relationship.
          const competitive = candidate.score * (1 - TRADE_INERTIA.improvement) <= candidates[0].score,
            retention = competitive ? 1 : 1 - TRADE_INERTIA.adjustment
          transfer(candidate, ((initialNeed * (candidate.flow?.[g] ?? 0)) / previousTotal) * retention)
        }
      }
      // Unavailable goods, closed borders, exhausted capacity and urgent food
      // needs bypass reservations. Only real, affordable freight is recorded.
      for (const candidate of candidates) {
        if (needed < 0.1) break
        transfer(candidate, needed)
      }
    }
  }
  world.routes = [...routes.values()]
  rememberShipments(world, memory)
  learnCorridors(world, profile)
}

export function consume(world: World) {
  consumeHouseholds(world)
}
