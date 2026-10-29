import { parameterGroup } from './configuration-context'
import { periodFlow } from './simulation-period'
import { governance } from './governance'
import { matchCommuters, knownCommuteCandidates } from './commuting'
import { MODEL_PARAMETERS as P } from './model-parameters'
import { economicRegions } from './local-units'
import { tradeDistricts } from './district-transport'
import { marketStore } from './national-accounts'
import { ensureEconomy, balance, producerAccount, publicGoods } from './ledger'
import { finishProduction, consumeHouseholds, recordTrade } from './macroeconomy'
import { ensureFirms, hireFirms, produceFirms } from './firms'
import { MinHeap } from './heap'
import { seaPassageView } from './naval-control'
import {
  GOODS,
  inventory,
  population,
  relation,
  type World,
  type Region,
  type Good,
  type Inventory,
  type Route,
  type RouteLeg,
} from './types'

import { agreementTerms } from './agreements'
import { transportNetwork, reverseLegs, refreshTransport } from './transport'
import { retainRoadBackbone } from './road-backbone'
import {
  corridorCost,
  corridorProfile,
  corridorUsage,
  learnCorridors,
  type CorridorProfile,
} from './corridors'
import {
  rememberedTrade,
  rememberShipments,
  establishedPath,
  pathCost,
  laneKey,
  TRADE_INERTIA,
} from './trade-memory'

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
export function reserveTarget(r: Region, good: Good) {
  const p = r.plannedProduction ?? r.production,
    inputs =
      good === 'iron'
        ? p.tools * 0.65 + p.arms * 0.9
        : good === 'coal'
          ? p.tools * 0.3 + p.arms * 0.5
          : good === 'timber'
            ? p.tools * 0.25 + p.textiles * 0.3
            : good === 'tools'
              ? p.arms * 0.3
              : good === 'food'
                ? p.textiles * 0.12
                : 0
  return householdNeed(r, good) * (good === 'food' ? 2.4 : 3) + inputs * 2
}

export function produce(world: World, coarse = false) {
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
): Graph {
  const graph: Graph = world.regions.map(() => []),
    terms = agreementTerms(world),
    hosts = new Set(
      terms
        .filter(
          ({ term }) =>
            (term.kind === 'access' && term.to === militaryNation) ||
            (term.kind === 'alliance' && (term.from === militaryNation || term.to === militaryNation)),
        )
        .flatMap(({ term }) => (term.kind === 'access' ? [term.from] : [term.from, term.to])),
    )
  if (militaryNation !== undefined)
    for (const body of world.institutions?.organizations ?? [])
      if (
        body.status === 'active' &&
        body.members.includes(militaryNation) &&
        body.charter.powers.includes('defense')
      )
        for (const member of body.members) hosts.add(member)
  let metrics = linkMetrics.get(profile)
  if (!metrics) {
    metrics = new Map()
    linkMetrics.set(profile, metrics)
  }
  const passage = seaPassageView(world),
    wars = world.nations.map(() => new Set<number>())
  for (const rel of world.relations)
    if (rel.treaty === 'war') {
      wars[rel.a].add(rel.b)
      wars[rel.b].add(rel.a)
    }
  const militaryAccess =
    militaryNation === undefined
      ? null
      : world.nations.map((n) => {
          const rel = relation(world, militaryNation, n.id)
          return (
            n.id === militaryNation || rel?.treaty === 'war' || rel?.treaty === 'alliance' || hosts.has(n.id)
          )
        })
  const allowed = (a: Region, b: Region) =>
    militaryAccess ? b.nation < 0 || militaryAccess[b.nation] : !wars[a.nation]?.has(b.nation)
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
        (link.seaCost > 0 ? Math.min(passage(a.nation, link.legs), passage(b.nation, link.legs)) : 1),
      cost = physical.cost,
      sea = link.seaCost > 0
    if (capacity > 0.001 && allowed(a, b))
      graph[a.id].push({ to: b.id, cost, capacity, sea, legs: link.legs })
    if (capacity > 0.001 && allowed(b, a))
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
  const preferences = new Set(
    agreementTerms(world)
      .filter(({ term }) => ['trade', 'alliance'].includes(term.kind))
      .flatMap(({ term }) => [`${term.from}:${term.to}`, `${term.to}:${term.from}`]),
  )
  for (const body of world.institutions?.organizations ?? [])
    if (body.status === 'active' && body.charter.powers.includes('trade'))
      for (const a of body.members) for (const b of body.members) if (a !== b) preferences.add(`${a}:${b}`)
  const treaties = world.nations.map(() => new Map<number, string>())
  for (const rel of world.relations) {
    treaties[rel.a].set(rel.b, rel.treaty)
    treaties[rel.b].set(rel.a, rel.treaty)
  }
  const treaty = (a: number, b: number) => treaties[a].get(b)
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
      const paths = shortestPaths(graph, buyer.id)
      const sellers = world.regions
        .filter(
          (region) =>
            region.nation === term.from &&
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
        let amount = Math.min(
          owed,
          world.nations[term.from].treasury / Math.max(1e-9, seller.prices[good] / 1000),
          seller.stocks[good] - target(seller, good),
          Math.max(0, target(buyer, good) * 4 - buyer.stocks[good]),
          ...edgeKeys.map((edge) => capacity.get(edge) ?? 0),
        )
        for (const [index, count] of usage) amount = Math.min(amount, physicalCapacity[index] / count)
        if (amount < 0.1) continue
        publicGoods(world, term.from, seller.id, good, amount, marketStore(buyer.id))
        seller.stocks[good] -= amount
        buyer.stocks[good] += amount
        owed -= amount
        offer.delivered += amount
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
      if (!pathCache.has(buyer.id)) pathCache.set(buyer.id, shortestPaths(graph, buyer.id))
      const paths = pathCache.get(buyer.id)!
      if (!markets.has(buyer.id)) {
        const suppliers = world.regions
          .filter(
            (s) =>
              s.id !== buyer.id &&
              Number.isFinite(paths.distance[s.id]) &&
              (s.nation === buyer.nation || treaty(s.nation, buyer.nation) !== 'war'),
          )
          .map((seller) => {
            const id = laneKey(seller.id, buyer.id),
              prior = memory.get(id)
            if (prior && !plans.has(id)) {
              const best = pathTo(paths.previous, buyer.id, seller.id).reverse(),
                path = routes.get(id)?.path ?? establishedPath(graph, prior.path, best)
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
        for (const [index, count] of usage) available = Math.min(available, physicalCapacity[index] / count)
        if (available < 0.1) {
          plan.blocked = true
          return
        }
        const international = seller.nation !== buyer.nation
        const nBuyer = governance(world, buyer.nation)
        const unitPrice = seller.prices[g] / 1000
        const freightRate = Math.min(0.5, plan.cost * 0.001) * unitPrice
        const agreement = treaty(buyer.nation, seller.nation)
        const tariff =
          international &&
          agreement !== 'trade' &&
          agreement !== 'alliance' &&
          !preferences.has(`${buyer.nation}:${seller.nation}`)
            ? nBuyer.policies.tariff / 100
            : 0
        const affordable =
          balance(world, producerAccount(buyer.id)) / Math.max(1e-12, unitPrice * (1 + tariff) + freightRate)
        const amount = Math.max(
          0,
          Math.min(requested, needed, seller.stocks[g] - target(seller, g), available, affordable),
        )
        if (amount < 0.1) return
        seller.stocks[g] -= amount
        buyer.stocks[g] += amount
        needed -= amount
        edgeKeys.forEach((k) => capacity.set(k, capacity.get(k)! - amount))
        for (const [index, count] of usage) physicalCapacity[index] -= amount * count
        const value = amount * unitPrice
        recordTrade(world, seller.id, buyer.id, g, amount, unitPrice, amount * freightRate, tariff)
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
