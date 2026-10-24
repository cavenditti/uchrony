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

import { transportNetwork, reverseLegs } from './transport'
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

export function reserveTarget(r: Region, good: Good) {
  return population(r) * MONTHLY_NEED[good] * (good === 'food' ? 2.4 : 3)
}

export function produce(world: World) {
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
    const workers = labor * utilization
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
      (0.24 + r.fertility * 0.25) *
      (1 + tech.agriculture * 0.19) *
      season *
      world.climate *
      efficiency
    const industrial = (1 - farmShare) / 0.52
    const raw = (g: Good, amount: number) => {
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
    const factory = workers * (1 - farmShare) * (1 - 0.33 / 0.52) * r.industry * efficiency
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

export function transportGraph(world: World, militaryNation?: number): Graph {
  const graph: Graph = world.regions.map(() => [])
  const allowed = (a: Region, b: Region) => {
    if (militaryNation !== undefined) {
      const rel = relation(world, militaryNation, b.nation)
      return b.nation === militaryNation || rel?.treaty === 'war' || rel?.treaty === 'alliance'
    }
    return a.nation === b.nation || relation(world, a.nation, b.nation)?.treaty !== 'war'
  }
  for (const link of transportNetwork(world).links) {
    const a = world.regions[link.from],
      b = world.regions[link.to],
      infra = (a.infrastructure + b.infrastructure) / 2,
      tech = Math.min(
        world.nations[a.nation].technologies.logistics,
        world.nations[b.nation].technologies.logistics,
      ),
      damage = 1 - Math.max(a.devastation, b.devastation) * 0.6,
      sea = link.seaCost > 0,
      roadCapacity = (1000 + infra * 6000) * (1 + tech * 0.25) * damage,
      portCapacity =
        (2500 + Math.min(a.infrastructure, b.infrastructure) * 9000) * (1 + tech * 0.15) * damage,
      capacity = sea
        ? link.landCost > 0
          ? Math.min(roadCapacity, portCapacity)
          : portCapacity
        : roadCapacity,
      cost =
        ((link.landCost / 6) * (2 - infra)) / (1 + tech * 0.1) +
        (sea ? 2 + link.seaCost / 18 / (1 + tech * 0.1) : 0)
    // Each direction is checked independently: military access is directional.
    if (allowed(a, b)) graph[a.id].push({ to: b.id, cost, capacity, sea, legs: link.legs })
    if (allowed(b, a)) graph[b.id].push({ to: a.id, cost, capacity, sea, legs: reverseLegs(link.legs) })
  }
  return graph
}

export function shortestPaths(graph: Graph, from: number) {
  const distance = new Float64Array(graph.length).fill(Infinity)
  const previous = new Int32Array(graph.length).fill(-1),
    visited = new Uint8Array(graph.length)
  distance[from] = 0
  for (let step = 0; step < graph.length; step++) {
    let at = -1,
      best = Infinity
    for (let i = 0; i < graph.length; i++)
      if (!visited[i] && distance[i] < best) {
        at = i
        best = distance[i]
      }
    if (at < 0) break
    visited[at] = 1
    for (const e of graph[at])
      if (distance[e.to] > best + e.cost) {
        distance[e.to] = best + e.cost
        previous[e.to] = at
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
  const graph = transportGraph(world),
    capacity = new Map<string, number>(),
    routes = new Map<string, Route>(),
    memory = rememberedTrade(world)
  const key = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`
  for (let a = 0; a < graph.length; a++) for (const e of graph[a]) capacity.set(key(a, e.to), e.capacity)
  const pathCache = new Map<number, ReturnType<typeof shortestPaths>>(),
    plans = new Map<string, { path: number[]; cost: number }>()
  world.routes = []
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
              path = establishedPath(graph, prior?.path, best)
            plans.set(id, { path, cost: pathCost(graph, path) })
          }
          const plan = plans.get(id)!
          return {
            seller,
            path: plan.path,
            score: plan.cost * (seller.nation === buyer.nation ? 0.6 : 1),
            prior: prior?.flow[g] ?? 0,
          }
        })
        .sort((a, b) => a.score - b.score || a.seller.id - b.seller.id)
      if (!candidates.length) continue
      const transfer = (candidate: (typeof candidates)[number], requested: number) => {
        const { seller, path } = candidate
        if (needed < 0.1 || requested < 0.1 || path.length < 2) return
        const edgeKeys = path.slice(1).map((id, i) => key(path[i], id))
        const available = Math.min(...edgeKeys.map((k) => capacity.get(k) ?? 0))
        const international = seller.nation !== buyer.nation
        const nBuyer = world.nations[buyer.nation],
          nSeller = world.nations[seller.nation]
        const unitPrice = (buyer.prices[g] + seller.prices[g]) / 2 / 1000
        const agreement = relation(world, buyer.nation, seller.nation)?.treaty
        const tariff =
          international && agreement !== 'trade' && agreement !== 'alliance'
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
            legs: path.slice(1).flatMap((to, i) => graph[path[i]].find((edge) => edge.to === to)!.legs),
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
          // appears, release 25% per month instead of replacing the relationship.
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
}

export function consume(world: World) {
  for (const r of world.regions) {
    const pop = population(r)
    for (const g of GOODS) {
      // Inputs consumed by factories have already been accounted for; these are household and maintenance demands.
      const need = pop * MONTHLY_NEED[g] * (g === 'arms' ? 0.15 : g === 'iron' || g === 'coal' ? 0.25 : 1)
      const actual = Math.min(r.stocks[g], need)
      r.stocks[g] -= actual
      r.consumption[g] += actual
      if (g === 'food') r.foodCoverage = need > 0 ? actual / need : 1
      const decay = g === 'food' ? 0.035 : g === 'timber' || g === 'textiles' ? 0.006 : 0.001
      r.stocks[g] = Math.min(r.stocks[g] * (1 - decay), Math.max(1, reserveTarget(r, g)) * 20)
    }
  }
}
