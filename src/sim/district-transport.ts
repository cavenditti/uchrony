import { deliverFreight } from './freight-transit'
import {
  GOODS,
  inventory,
  population,
  relation,
  type World,
  type Good,
  type Route,
  type RouteLeg,
} from './types'
import { economicRegions, provinceId } from './local-units'
import {
  corridorProfile,
  corridorUsage,
  corridorCost,
  learnCorridors,
  type CorridorProfile,
} from './corridors'
import { transportNetwork, refreshTransport, reverseLegs } from './transport'
import { retainRoadBackbone } from './road-backbone'
import { reserveTarget, householdNeed } from './economy'
import { recordTrade } from './macroeconomy'
import {
  balance,
  borrow,
  producerAccount,
  publicGoods,
  transfer,
  governmentAccount,
  householdAccount,
} from './ledger'
import { marketStore, recordTransport } from './national-accounts'
import { agreementTerms } from './agreements'
import { MinHeap } from './heap'
import { seaPassageView } from './naval-control'
import { updateDistrictNeighbors } from './districts'

export interface DistrictLink {
  to: number
  cost: number
  legs: RouteLeg[]
  usage: ReadonlyMap<number, number>
  capacity: number
}
export interface DistrictNetwork {
  graph: Map<number, DistrictLink[]>
  profile: CorridorProfile
}

/** Paths run through actual neighboring land cells. A district border is not a road. */
function localPath(profile: CorridorProfile, start: number, end: number, allowed: Set<number>) {
  const distances = new Map<number, number>([[start, 0]]),
    previous = new Map<number, number>(),
    heap = new MinHeap()
  heap.push(start, 0)
  while (heap.size) {
    const current = heap.pop()
    if (current.cost !== distances.get(current.id)) continue
    if (current.id === end) break
    for (const next of profile.adjacent[current.id]) {
      if (!allowed.has(next)) continue
      const cost = current.cost + profile.cost[profile.index(current.id, next)]
      if (cost < (distances.get(next) ?? Infinity)) {
        distances.set(next, cost)
        previous.set(next, current.id)
        heap.push(next, cost)
      }
    }
  }
  if (!distances.has(end)) return []
  const result = [end]
  while (result[0] !== start) result.unshift(previous.get(result[0])!)
  return result
}
export function districtNetwork(w: World): DistrictNetwork {
  const system = w.localEconomy!,
    profile = corridorProfile(w),
    cellUnit = updateDistrictNeighbors(w)
  refreshTransport(w, profile)
  const graph = new Map(system.active.map((id) => [id, [] as DistrictLink[]])),
    passage = seaPassageView(w)
  const add = (from: number, to: number, legs: RouteLeg[]) => {
    if (from === to || !graph.has(from) || !graph.has(to)) return
    const a = system.units[from],
      b = system.units[to]
    if (a.nation !== b.nation && relation(w, a.nation, b.nation)?.treaty === 'war') return
    const usage = corridorUsage(profile, legs)
    let capacity = Infinity
    for (const [edge, count] of usage) capacity = Math.min(capacity, profile.capacity[edge] / count)
    if (legs.some((l) => l.mode === 'sea'))
      capacity *= Math.min(passage(a.nation, legs), passage(b.nation, legs))
    if (!Number.isFinite(capacity) || capacity <= 1e-9) return
    const cost = corridorCost(profile, legs)
    const existing = graph.get(from)!.find((e) => e.to === to)
    if (existing && existing.cost <= cost) return
    if (existing) graph.get(from)!.splice(graph.get(from)!.indexOf(existing), 1)
    graph.get(from)!.push({ to, cost, legs, usage, capacity })
  }
  for (const id of system.active) {
    const a = system.units[id]
    for (const next of a.neighbors)
      if (next > id) {
        const b = system.units[next],
          path = localPath(profile, a.center, b.center, new Set([...a.cells, ...b.cells]))
        if (path.length < 2) continue
        const legs: RouteLeg[] = [{ mode: 'land', cells: path }]
        add(id, next, legs)
        add(next, id, reverseLegs(legs))
      }
  }
  // Retain surveyed long-distance roads and navigable sea corridors, including their last-mile legs.
  for (const link of transportNetwork(w).links) {
    const first = link.legs[0]?.cells[0],
      last = link.legs.at(-1)?.cells.at(-1)
    if (first === undefined || last === undefined) continue
    const from = cellUnit[first],
      to = cellUnit[last]
    if (from < 0 || to < 0) continue
    const a = system.units[from],
      b = system.units[to]
    const head = localPath(profile, a.center, first, new Set(a.cells)),
      tail = localPath(profile, last, b.center, new Set(b.cells))
    if (!head.length || !tail.length) continue
    const legs: RouteLeg[] = [
      ...(head.length > 1 ? [{ mode: 'land' as const, cells: head }] : []),
      ...link.legs,
      ...(tail.length > 1 ? [{ mode: 'land' as const, cells: tail }] : []),
    ]
    // A trunk must not bypass a closed land border inside a long route.
    const traversed = new Set(
      legs
        .filter((l) => l.mode === 'land')
        .flatMap((l) => l.cells.map((c) => w.regions[w.cells[c].region]?.nation))
        .filter((n) => n !== undefined),
    )
    if ([...traversed].some((n) => n !== a.nation && relation(w, a.nation, n)?.treaty === 'war')) continue
    add(from, to, legs)
    add(to, from, reverseLegs(legs))
  }
  retainRoadBackbone(w, graph, (id) => system.units[id])
  for (const edges of graph.values()) edges.sort((a, b) => a.to - b.to)
  return { graph, profile }
}

function nearby(graph: Map<number, DistrictLink[]>, from: number, maxCost: number) {
  const distance = new Map([[from, 0]]),
    previous = new Map<number, { from: number; edge: DistrictLink }>(),
    heap = new MinHeap(),
    reached: number[] = []
  heap.push(from, 0)
  while (heap.size) {
    const current = heap.pop()
    if (current.cost !== distance.get(current.id)) continue
    if (current.cost > maxCost) break
    if (current.id !== from) reached.push(current.id)
    for (const edge of graph.get(current.id) ?? []) {
      const cost = current.cost + edge.cost
      if (cost < (distance.get(edge.to) ?? Infinity)) {
        distance.set(edge.to, cost)
        previous.set(edge.to, { from: current.id, edge })
        heap.push(edge.to, cost)
      }
    }
  }
  return { distance, previous, reached }
}
export function tradeDistricts(w: World, network = districtNetwork(w)) {
  const system = w.localEconomy!,
    { graph, profile } = network,
    remaining = profile.capacity.slice(),
    linkRemaining = new Map<DistrictLink, number>()
  const units = economicRegions(w),
    targets = new Map(
      units.map((r) => [
        r.id,
        Object.fromEntries(GOODS.map((g) => [g, reserveTarget(r, g)])) as Record<Good, number>,
      ]),
    )
  // A desired precautionary reserve is not an export embargo. Retain one
  // month's local use; offer the rest. Imported lots cannot be resold this tick.
  const exportable = new Map(
    units.map((r) => [
      r.id,
      Object.fromEntries(
        GOODS.map((g) => [g, Math.max(0, r.stocks[g] - targets.get(r.id)![g] / (g === 'food' ? 2.4 : 3))]),
      ) as Record<Good, number>,
    ]),
  )
  const paths = new Map<number, ReturnType<typeof nearby>>(),
    routes: Route[] = [],
    preferential = new Set<string>()
  for (const { term } of agreementTerms(w))
    if (term.kind === 'trade' || term.kind === 'alliance') {
      preferential.add(`${term.from}:${term.to}`)
      preferential.add(`${term.to}:${term.from}`)
    }
  for (const body of w.institutions?.organizations ?? [])
    if (body.status === 'active' && body.charter.powers.includes('trade'))
      for (const a of body.members) for (const b of body.members) preferential.add(`${a}:${b}`)
  system.shipments = []
  // Treaty membership cannot change during this clearing phase. Price comparisons
  // need a matrix lookup, not repeated scans of every bilateral relationship.
  const nationCount = w.nations.length,
    tariffs = new Float64Array(nationCount * nationCount)
  for (let a = 0; a < nationCount; a++)
    for (let b = 0; b < nationCount; b++) {
      if (a === b) continue
      const treaty = relation(w, a, b)?.treaty
      tariffs[a * nationCount + b] =
        treaty === 'trade' || treaty === 'alliance' || preferential.has(`${a}:${b}`)
          ? 0
          : w.nations[a].policies.tariff / 100
    }
  const tariffFor = (buyer: number, seller: number) =>
    tariffs[system.units[buyer].nation * nationCount + system.units[seller].nation]
  // Within goods clearing, loan principal can only increase and bank lending
  // capacity can only fall. A rejected limit cannot become fundable until the
  // buyer receives deposits or requests a higher limit. Cache only rejections;
  // every actual origination still passes the bank's complete balance-sheet check.
  const rejectedCredit = new Map<number, number>()
  const creditLimit = (id: number) =>
    Math.max(
      1,
      GOODS.reduce(
        (sum, g) => sum + (householdNeed(system.units[id], g) * system.units[id].prices[g]) / 1000,
        0,
      ) * 6,
    )
  const pathFor = (buyer: number, seller: number) => {
    const search = paths.get(buyer)!,
      chain: DistrictLink[] = [],
      steps = [seller]
    let at = seller
    while (at !== buyer) {
      const prev = search.previous.get(at)
      if (!prev || (linkRemaining.get(prev.edge) ?? prev.edge.capacity) < 1e-6) return null
      for (const [edge, count] of prev.edge.usage) if (remaining[edge] / count < 1e-6) return null
      chain.push(prev.edge)
      at = prev.from
      steps.push(at)
    }
    const usage = new Map<number, number>()
    for (const link of chain)
      for (const [edge, count] of link.usage) usage.set(edge, (usage.get(edge) ?? 0) + count)
    return { chain, steps, cost: search.distance.get(seller)!, usage }
  }
  const ship = (buyerId: number, sellerId: number, good: Good, requested: number, donor?: number) => {
    const buyer = system.units[buyerId],
      seller = system.units[sellerId]
    const tariff = donor !== undefined ? 0 : tariffFor(buyerId, sellerId)
    const price = seller.prices[good] / 1000,
      freightRate = price * paths.get(buyerId)!.distance.get(sellerId)! * 0.002
    const payer = donor === undefined ? producerAccount(buyerId) : governmentAccount(donor)
    const unitCost = price * (1 + tariff) + freightRate
    const limit = donor === undefined ? creditLimit(buyerId) : 0
    if (
      (donor !== undefined || limit <= (rejectedCredit.get(buyerId) ?? -Infinity)) &&
      balance(w, payer) / Math.max(1e-12, unitCost) < 1e-6
    )
      return 0
    const path = pathFor(buyerId, sellerId)
    if (!path) return 0
    // A loan finances only an executable order. Exhausted corridors and unavailable
    // stocks must not leave a buyer with new debt and idle deposits.
    requested = Math.max(0, Math.min(requested, seller.stocks[good], exportable.get(sellerId)![good]))
    for (const [index, count] of path.usage) requested = Math.min(requested, remaining[index] / count)
    for (const edge of path.chain) requested = Math.min(requested, linkRemaining.get(edge) ?? edge.capacity)
    if (requested < 1e-6) return 0
    if (donor === undefined && balance(w, payer) < requested * unitCost) {
      if (limit > (rejectedCredit.get(buyerId) ?? -Infinity)) {
        const lent = borrow(w, payer, requested * unitCost - balance(w, payer), limit)
        if (!lent) rejectedCredit.set(buyerId, limit)
      }
    }
    const amount = Math.max(0, Math.min(requested, balance(w, payer) / Math.max(1e-12, unitCost)))
    if (amount < 1e-6) return 0
    if (donor === undefined)
      recordTrade(w, sellerId, buyerId, good, amount, price, amount * freightRate, tariff)
    else {
      publicGoods(w, donor, sellerId, good, amount, marketStore(buyerId), price)
      const paid = transfer(
        w,
        payer,
        householdAccount(sellerId, 'laborer'),
        amount * freightRate,
        'aid freight service',
      )
      w.economy!.households[sellerId].laborer.income += paid
      w.nations[donor].spending += paid
      // Donor-financed freight is final public service, not an unfunded charge to the recipient.
      if (paid) {
        const a = w.economy!.accounts!
        recordTransport(w, sellerId, buyerId, paid, 0)
        a.nations[buyer.nation].government += paid
      }
    }
    seller.stocks[good] = Math.max(0, seller.stocks[good] - amount)
    const legs = path.chain.flatMap((edge) => reverseLegs(edge.legs))
    deliverFreight(w, sellerId, buyerId, good, amount, legs)
    for (const [index, count] of path.usage) remaining[index] = Math.max(0, remaining[index] - amount * count)
    for (const edge of path.chain)
      linkRemaining.set(edge, (linkRemaining.get(edge) ?? edge.capacity) - amount)
    // Selling quotes follow delivered acquisition costs, with bounded adjustment.
    const targetPrice = unitCost * 1000 * 1.04
    buyer.prices[good] *= Math.exp(
      Math.max(-0.06, Math.min(0.06, Math.log(targetPrice / Math.max(0.01, buyer.prices[good])))),
    )
    exportable.get(sellerId)![good] -= amount
    system.shipments.push({
      from: sellerId,
      to: buyerId,
      good,
      quantity: amount,
      value: amount * price,
      freight: amount * freightRate,
      tariff: amount * price * tariff,
      cells: legs.flatMap((l) => l.cells),
      legs: legs,
    })
    const provincePath = path.steps
      .map((id) => system.units[id].province)
      .filter((id, i, a) => i === 0 || id !== a[i - 1])
    routes.push({
      fromDistrict: sellerId,
      toDistrict: buyerId,
      id: `local:${sellerId}:${buyerId}:${good}`,
      from: provinceId(seller),
      to: provinceId(buyer),
      path: provincePath,
      legs: legs,
      sea: legs.some((l) => l.mode === 'sea'),
      goods: { ...inventory(), [good]: amount },
      volume: amount,
      value: amount * price,
      capacity: amount,
      international: buyer.nation !== seller.nation,
    })
    return amount
  }
  const search = (id: number) => {
    if (!paths.has(id))
      paths.set(
        id,
        nearby(
          graph,
          id,
          8 +
            system.units[id].infrastructure * 5 +
            w.nations[system.units[id].nation].technologies.logistics * 2,
        ),
      )
    return paths.get(id)!
  }
  for (const { offer, term } of agreementTerms(w, 'goods')) {
    const good = term.good as Good
    let owed = term.amount
    for (const buyer of units
      .filter((r) => r.nation === term.to)
      .sort(
        (a, b) => a.stocks[good] / Math.max(1, population(a)) - b.stocks[good] / Math.max(1, population(b)),
      )) {
      for (const seller of search(buyer.id).reached.filter((id) => system.units[id].nation === term.from)) {
        const amount = ship(
          buyer.id,
          seller,
          good,
          Math.min(owed, Math.max(0, targets.get(buyer.id)![good] * 4 - buyer.stocks[good])),
          term.from,
        )
        owed -= amount
        offer.delivered += amount
        if (owed < 1e-6) break
      }
      if (owed < 1e-6) break
    }
    if (owed > 0.1) offer.breaches++
  }
  for (const good of GOODS) {
    const buyers = units
      .filter((r) => r.stocks[good] < targets.get(r.id)![good])
      .sort(
        (a, b) =>
          a.stocks[good] / Math.max(1, targets.get(a.id)![good]) -
            b.stocks[good] / Math.max(1, targets.get(b.id)![good]) || a.id - b.id,
      )
    for (const buyer of buyers) {
      if (
        balance(w, producerAccount(buyer.id)) <= 0 &&
        creditLimit(buyer.id) <= (rejectedCredit.get(buyer.id) ?? -Infinity)
      )
        continue
      const found = search(buyer.id)
      // Dijkstra settlement order places a predecessor before its descendants.
      // Propagate exhausted paths once through this tree before sorting offers;
      // rebuilding a closed journey for every commodity cannot enable a shipment.
      const reachable = new Set([buyer.id])
      const candidates: { id: number; cost: number }[] = []
      for (const id of found.reached) {
        const prev = found.previous.get(id)!
        if (!reachable.has(prev.from) || (linkRemaining.get(prev.edge) ?? prev.edge.capacity) < 1e-6) continue
        let open = true
        for (const [edge, count] of prev.edge.usage)
          if (remaining[edge] / count < 1e-6) {
            open = false
            break
          }
        if (!open) continue
        reachable.add(id)
        if (exportable.get(id)![good] > 1e-6)
          candidates.push({
            id,
            cost:
              system.units[id].prices[good] * (1 + tariffFor(buyer.id, id) + found.distance.get(id)! * 0.002),
          })
      }
      const sellers = candidates.sort((a, b) => a.cost - b.cost || a.id - b.id).map((o) => o.id)
      for (const seller of sellers) {
        const needed = targets.get(buyer.id)![good] - buyer.stocks[good]
        if (needed < 1e-6) break
        ship(buyer.id, seller, good, needed)
      }
    }
  }
  w.routes = routes
  learnCorridors(w, profile)
  // The established provincial route API remains a summary for diplomacy and the map.
  const aggregate = new Map<string, Route>()
  for (const r of routes) {
    if (r.from === r.to) continue
    const key = `${r.from}-${r.to}`,
      old = aggregate.get(key)
    if (old) {
      for (const g of GOODS) old.goods[g] += r.goods[g]
      old.volume += r.volume
      old.value += r.value
      old.capacity += r.capacity
    } else aggregate.set(key, { ...r, id: key, path: r.path, goods: { ...r.goods } })
  }
  w.routes = [...aggregate.values()]
}
