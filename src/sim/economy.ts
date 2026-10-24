import { simulationSettings } from './settings'
import { MinHeap } from './heap'
import { seaPassageFactor } from './naval-control'
import {
  GOODS,
  inventory,
  population,
  relation,
  clamp,
  type World,
  type Region,
  type Good,
  type Inventory,
  type Route,
  type RouteLeg,
} from './types'

import { agreementTerms } from './agreements'
import { effectMultiplier } from './effects'
import { transportNetwork, reverseLegs, refreshTransport } from './transport'
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

export const BASE_PRICE: Inventory = {
  food: 14,
  timber: 24,
  stone: 18,
  iron: 65,
  coal: 32,
  tools: 155,
  textiles: 100,
  arms: 290,
}
export const MONTHLY_NEED: Inventory = {
  food: 0.025,
  timber: 0.0025,
  stone: 0.0012,
  iron: 0.0015,
  coal: 0.0013,
  tools: 0.00045,
  textiles: 0.00055,
  arms: 0.00015,
}

export function householdNeed(r: Region, good: Good) {
  const livingStandard =
      good === 'food'
        ? 0.95 + r.urban * 0.15
        : 0.65 + r.urban * 1.3 + r.infrastructure * 0.3 + r.industry * 0.3,
    allocation = good === 'arms' ? 0.15 : good === 'iron' || good === 'coal' ? 0.25 : 1
  return population(r) * MONTHLY_NEED[good] * livingStandard * allocation
}
export function reserveTarget(r: Region, good: Good) {
  const p = r.production,
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

export function produce(world: World) {
  const abundance = simulationSettings(world).abundance
  for (const r of world.regions) {
    const n = world.nations[r.nation],
      pop = population(r),
      p = n.policies,
      tech = n.technologies
    r.production = inventory()
    r.consumption = inventory()
    r.migration = 0
    const labor = r.population.adults * 0.73 * (0.6 + r.health * 0.4)
    const utilization = clamp(
      0.58 + r.infrastructure * 0.2 + n.stability / 500 - r.devastation * 0.4,
      0.15,
      0.96,
    )
    const workers = labor * utilization * (0.75 + 0.25 * (r.materialCoverage ?? 1))
    r.employed = workers
    const efficiency = (1 + r.literacy * 0.35 + tech.industry * 0.13) * (1 - r.devastation * 0.55)
    const farmShare = clamp(
      0.58 - r.urban * 0.18 + (p.priority === 'agriculture' ? 0.15 : p.priority === 'industry' ? -0.1 : 0),
      0.3,
      0.78,
    )
    const season = 1 + Math.sin((((world.month % 12) - 4) / 12) * Math.PI * 2) * 0.23
    const arableCapacity = Math.max(1, r.cells.length * 1800 * (0.35 + r.fertility * 0.65))
    const effectiveFarmLabor = arableCapacity * (1 - Math.exp((-workers * farmShare) / arableCapacity))
    const farm =
      effectiveFarmLabor *
      (0.105 + r.fertility * 0.125) *
      abundance *
      (1 + tech.agriculture * 0.19) *
      season *
      world.climate *
      efficiency *
      effectMultiplier(world, 'harvest', n.id, r.id)
    const industrial = (1 - farmShare) / 0.52
    const raw = (g: Good, amount: number) => {
      if (['timber', 'stone', 'iron', 'coal'].includes(g))
        amount *= abundance * effectMultiplier(world, 'extraction', n.id, r.id)
      r.production[g] = amount
      r.stocks[g] += amount
    }
    raw('food', farm)
    raw('timber', workers * 0.11 * 0.13 * r.deposits.timber * efficiency * industrial)
    raw('stone', workers * 0.08 * 0.12 * r.deposits.stone * efficiency * industrial)
    raw('iron', workers * 0.075 * 0.07 * r.deposits.iron * efficiency * industrial)
    raw('coal', workers * 0.065 * 0.1 * r.deposits.coal * efficiency * industrial)
    const manufacture = (good: Good, potential: number, recipe: Partial<Inventory>) => {
      let amount = potential
      for (const [input, rate] of Object.entries(recipe))
        amount = Math.min(amount, r.stocks[input as Good] / rate)
      amount = Math.max(0, amount)
      for (const [input, rate] of Object.entries(recipe)) {
        r.stocks[input as Good] -= amount * rate
        r.consumption[input as Good] += amount * rate
      }
      raw(good, amount)
    }
    // Farming and extraction use explicit shares; the remaining 36.5% of
    // non-farm labor works in manufacturing. The recipe rates include its
    // allocation among toolmakers, textile workers, and arms makers.
    const factory =
      workers *
      (1 - farmShare) *
      (1 - 0.33 / 0.52) *
      r.industry *
      efficiency *
      effectMultiplier(world, 'manufacturing', n.id, r.id)
    manufacture('tools', factory * (0.007 / 0.19), { iron: 0.65, coal: 0.3, timber: 0.25 })
    manufacture('textiles', factory * (0.013 / 0.19), { timber: 0.3, food: 0.12 })
    manufacture('arms', factory * (0.0025 / 0.19) * (p.priority === 'military' ? 2 : 1), {
      iron: 0.9,
      coal: 0.5,
      tools: 0.3,
    })
    for (const g of GOODS) {
      r.prices[g] = BASE_PRICE[g] * clamp(reserveTarget(r, g) / Math.max(1, r.stocks[g]), 0.55, 3)
    }
    r.gdp = GOODS.reduce((sum, g) => sum + r.production[g] * r.prices[g], 0) / 1000
    if (!pop) r.gdp = 0
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
  let metrics = linkMetrics.get(profile)
  if (!metrics) {
    metrics = new Map()
    linkMetrics.set(profile, metrics)
  }
  const allowed = (a: Region, b: Region) => {
    if (militaryNation !== undefined) {
      const rel = relation(world, militaryNation, b.nation)
      return (
        b.nation === militaryNation ||
        rel?.treaty === 'war' ||
        rel?.treaty === 'alliance' ||
        hosts.has(b.nation)
      )
    }
    return a.nation === b.nation || relation(world, a.nation, b.nation)?.treaty !== 'war'
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
        Math.min(seaPassageFactor(world, a.nation, link.legs), seaPassageFactor(world, b.nation, link.legs)),
      cost = physical.cost,
      sea = link.seaCost > 0
    if (capacity > 0.001 && allowed(a, b))
      graph[a.id].push({ to: b.id, cost, capacity, sea, legs: link.legs })
    if (capacity > 0.001 && allowed(b, a))
      graph[b.id].push({ to: a.id, cost, capacity, sea, legs: reverseLegs(link.legs) })
  }
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
  const preferences = new Set(
    agreementTerms(world)
      .filter(({ term }) => ['trade', 'alliance'].includes(term.kind))
      .flatMap(({ term }) => [`${term.from}:${term.to}`, `${term.to}:${term.from}`]),
  )
  const profile = corridorProfile(world)
  refreshTransport(world, profile)
  const graph = transportGraph(world, undefined, profile),
    physicalCapacity = profile.capacity.slice(),
    capacity = new Map<string, number>(),
    routes = new Map<string, Route>(),
    memory = rememberedTrade(world)
  const key = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`
  for (let a = 0; a < graph.length; a++) for (const e of graph[a]) capacity.set(key(a, e.to), e.capacity)
  const pathCache = new Map<number, ReturnType<typeof shortestPaths>>(),
    plans = new Map<
      string,
      {
        path: number[]
        cost: number
        physical?: { legs: RouteLeg[]; usage: ReadonlyMap<number, number> }
      }
    >()
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
            region.stocks[good] > reserveTarget(region, good) &&
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
          seller.stocks[good] - reserveTarget(seller, good),
          Math.max(0, reserveTarget(buyer, good) * 4 - buyer.stocks[good]),
          ...edgeKeys.map((edge) => capacity.get(edge) ?? 0),
        )
        for (const [index, count] of usage) amount = Math.min(amount, physicalCapacity[index] / count)
        if (amount < 0.1) continue
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
      .filter((r) => r.stocks[g] < reserveTarget(r, g) * (establishedBuyers.has(r.id) ? 1 : 0.9))
      .sort(
        (a, b) =>
          a.stocks[g] / Math.max(1, reserveTarget(a, g)) - b.stocks[g] / Math.max(1, reserveTarget(b, g)) ||
          a.id - b.id,
      )
    for (const buyer of buyers) {
      let needed = reserveTarget(buyer, g) - buyer.stocks[g]
      if (!pathCache.has(buyer.id)) pathCache.set(buyer.id, shortestPaths(graph, buyer.id))
      const paths = pathCache.get(buyer.id)!
      const candidates = world.regions
        .filter(
          (s) =>
            s.id !== buyer.id &&
            Number.isFinite(paths.distance[s.id]) &&
            s.stocks[g] >
              reserveTarget(s, g) * ((memory.get(laneKey(s.id, buyer.id))?.flow[g] ?? 0) >= 0.1 ? 1 : 1.1),
        )
        .filter((s) => s.nation === buyer.nation || relation(world, s.nation, buyer.nation)?.treaty !== 'war')
        .map((seller) => {
          const id = laneKey(seller.id, buyer.id),
            prior = memory.get(id)
          if (!plans.has(id)) {
            const best = pathTo(paths.previous, buyer.id, seller.id).reverse(),
              path = routes.get(id)?.path ?? establishedPath(graph, prior?.path, best)
            plans.set(id, { path, cost: pathCost(graph, path) })
          }
          const plan = plans.get(id)!
          return {
            seller,
            path: plan.path,
            plan,
            score: plan.cost * (seller.nation === buyer.nation ? 0.6 : 1),
            prior: prior?.flow[g] ?? 0,
          }
        })
        .sort((a, b) => a.score - b.score || a.seller.id - b.seller.id)
      if (!candidates.length) continue
      const transfer = (candidate: (typeof candidates)[number], requested: number) => {
        const { seller, path, plan } = candidate
        if (needed < 0.1 || requested < 0.1 || path.length < 2) return
        const edgeKeys = path.slice(1).map((id, i) => key(path[i], id))
        let available = Math.min(...edgeKeys.map((k) => capacity.get(k) ?? 0))
        if (available < 0.1) return
        if (!plan.physical) {
          const legs = path.slice(1).flatMap((to, i) => graph[path[i]].find((edge) => edge.to === to)!.legs)
          plan.physical = { legs, usage: corridorUsage(profile, legs) }
        }
        const { legs, usage } = plan.physical
        for (const [index, count] of usage) available = Math.min(available, physicalCapacity[index] / count)
        const international = seller.nation !== buyer.nation
        const nBuyer = world.nations[buyer.nation],
          nSeller = world.nations[seller.nation]
        const unitPrice = (buyer.prices[g] + seller.prices[g]) / 2 / 1000
        const agreement = relation(world, buyer.nation, seller.nation)?.treaty
        const tariff =
          international &&
          agreement !== 'trade' &&
          agreement !== 'alliance' &&
          !preferences.has(`${buyer.nation}:${seller.nation}`)
            ? nBuyer.policies.tariff / 100
            : 0
        const affordable = international
          ? Math.max(0, nBuyer.treasury - 200) / (unitPrice * (1 + tariff))
          : Infinity
        // Tariffs are border friction in this public-inventory abstraction;
        // a trade treaty removes the reduction in cross-border throughput.
        const amount =
          Math.max(
            0,
            Math.min(requested, needed, seller.stocks[g] - reserveTarget(seller, g), available, affordable),
          ) /
          (1 + tariff)
        if (amount < 0.1) return
        seller.stocks[g] -= amount
        buyer.stocks[g] += amount
        needed -= amount
        edgeKeys.forEach((k) => capacity.set(k, capacity.get(k)! - amount))
        for (const [index, count] of usage) physicalCapacity[index] -= amount * count
        const value = amount * unitPrice
        if (international) {
          nBuyer.treasury -= value
          nSeller.treasury += value
        }
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
      const established = candidates.filter((candidate) => candidate.prior >= 0.1),
        previousTotal = established.reduce((sum, candidate) => sum + candidate.prior, 0),
        initialNeed = needed,
        urgentFood = g === 'food' && buyer.stocks.food < population(buyer) * MONTHLY_NEED.food
      if (!urgentFood && previousTotal > 0) {
        for (const candidate of established) {
          // Preserve normal supplier shares. When a meaningfully better option
          // appears, release a small monthly share instead of replacing the relationship.
          const competitive = candidate.score * (1 - TRADE_INERTIA.improvement) <= candidates[0].score,
            retention = competitive ? 1 : 1 - TRADE_INERTIA.adjustment
          transfer(candidate, ((initialNeed * candidate.prior) / previousTotal) * retention)
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
  for (const r of world.regions) {
    let materialCoverage = 0
    const weights: Partial<Inventory> = {
      tools: 0.35,
      textiles: 0.25,
      timber: 0.15,
      stone: 0.1,
      iron: 0.05,
      coal: 0.1,
    }
    for (const g of GOODS) {
      // Inputs consumed by factories have already been accounted for; these are household and maintenance demands.
      const need = householdNeed(r, g)
      const actual = Math.min(r.stocks[g], need)
      r.stocks[g] -= actual
      r.consumption[g] += actual
      const coverage = need > 0 ? actual / need : 1
      if (g === 'food') r.foodCoverage = coverage
      materialCoverage += (weights[g] ?? 0) * coverage
      const decay = g === 'food' ? 0.035 : g === 'timber' || g === 'textiles' ? 0.006 : 0.001
      r.stocks[g] = Math.min(r.stocks[g] * (1 - decay), Math.max(1, reserveTarget(r, g)) * 20)
    }
    r.materialCoverage = clamp(materialCoverage)
    if (r.materialCoverage < 0.7)
      r.infrastructure = Math.max(0.05, r.infrastructure - (0.7 - r.materialCoverage) * 0.002)
  }
}
