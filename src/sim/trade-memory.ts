import { parameterGroup } from './configuration-context'
import { GOODS, inventory, relation, type TradeLane, type World } from './types'
import type { Graph } from './economy'

export const TRADE_INERTIA = parameterGroup('tradeMemory')
export const laneKey = (from: number, to: number) => `${from}-${to}`

/** Only explicit retained supplier memory influences current trading decisions. */
export function rememberedTrade(world: World) {
  const lanes = world.tradeLanes ?? []
  return new Map(
    lanes
      .filter((lane) => {
        const a = world.regions[lane.from].nation,
          b = world.regions[lane.to].nation
        return (
          world.month - lane.lastActive <= TRADE_INERTIA.idleMonths &&
          (a === b || relation(world, a, b)?.treaty !== 'war') &&
          GOODS.some((g) => lane.flow[g] >= 0.1)
        )
      })
      .map((lane) => [laneKey(lane.from, lane.to), lane]),
  )
}

export function pathCost(graph: Graph, path: number[]) {
  if (path.length < 2) return Infinity
  let cost = 0
  for (let i = 1; i < path.length; i++) {
    const edge = graph[path[i - 1]]?.find((e) => e.to === path[i])
    if (!edge || edge.capacity < 0.1) return Infinity
    cost += edge.cost
  }
  return cost
}

/** Keep a viable route until its replacement is more than 25% cheaper. */
export function establishedPath(graph: Graph, previous: number[] | undefined, best: number[]) {
  if (previous && previous[0] === best[0] && previous.at(-1) === best.at(-1)) {
    const oldCost = pathCost(graph, previous),
      newCost = pathCost(graph, best)
    if (Number.isFinite(oldCost) && oldCost * (1 - TRADE_INERTIA.improvement) <= newCost) return previous
  }
  return best
}

export function rememberShipments(world: World, previous: Map<string, TradeLane>) {
  const shipments = new Map(world.routes.map((r) => [laneKey(r.from, r.to), r])),
    keys = new Set([...previous.keys(), ...shipments.keys()]),
    lanes: TradeLane[] = []
  for (const key of keys) {
    const old = previous.get(key),
      current = shipments.get(key),
      flow = inventory()
    for (const good of GOODS) {
      const amount = current?.goods[good] ?? 0
      flow[good] = amount > 0 ? amount : (old?.flow[good] ?? 0) * (1 - TRADE_INERTIA.adjustment)
      if (flow[good] < 0.1) flow[good] = 0
    }
    if (!GOODS.some((good) => flow[good] > 0)) continue
    const lane = current ?? old!
    lanes.push({
      from: lane.from,
      to: lane.to,
      path: lane.path,
      flow,
      lastActive: current ? world.month : old!.lastActive,
    })
  }
  world.tradeLanes = lanes.sort((a, b) => a.from - b.from || a.to - b.to)
}
