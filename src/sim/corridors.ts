import { economicRegions } from './local-units'
import { effectMultiplier } from './effects'
import { neighbors } from './hex'
import type { Cell, CorridorTrace, RouteLeg, Terrain, World } from './types'

export const CORRIDOR_LEARNING = {
  gain: 0.1,
  evaporation: 0.025,
  discount: 0.7,
  trafficAdjustment: 0.2,
  replanMonths: 3,
  minimumPathMonths: 12,
  improvement: 0.05,
} as const

const difficulty: Record<Terrain, number> = {
  water: Infinity,
  plains: 1,
  forest: 1.5,
  hills: 2,
  mountains: 5,
  desert: 1.8,
  tundra: 2,
}

/** Travel effort remains positive even on a fully established corridor. */
export function roadCost(a: Cell, b: Cell) {
  return (
    (difficulty[a.terrain] + difficulty[b.terrain]) / 2 +
    Math.abs(a.elevation - b.elevation) * 12 +
    (a.river || b.river ? 0.35 : 0)
  )
}

interface Segment {
  a: number
  b: number
  mode: 'land' | 'sea' | 'port'
  effort: number
}
const geography = new WeakMap<Cell[], ReturnType<typeof buildGeography>>()
function buildGeography(world: World) {
  const { cells, width, height } = world,
    adjacent = cells.map((cell) => neighbors(cell.id, width, height)),
    water = (id: number) => cells[id].terrain === 'water',
    shore = cells.map((cell) => water(cell.id) && adjacent[cell.id].some((id) => !water(id))),
    segments: Segment[] = [],
    indices = new Int32Array(cells.length * 4).fill(-1),
    key = (a: number, b: number) => {
      const low = Math.min(a, b),
        delta = Math.abs(a - b)
      return low * 4 + (delta === 1 ? 0 : delta === width - 1 ? 1 : delta === width ? 2 : 3)
    }
  for (const a of cells)
    for (const b of adjacent[a.id]) {
      if (a.id >= b) continue
      const mode = water(a.id) && water(b) ? 'sea' : water(a.id) || water(b) ? 'port' : 'land',
        effort =
          mode === 'land'
            ? roadCost(a, cells[b])
            : mode === 'port'
              ? 1
              : 1 + (+shore[a.id] + +shore[b]) * 0.15
      indices[key(a.id, b)] = segments.length
      segments.push({ a: a.id, b, mode, effort })
    }
  return {
    adjacent,
    segments,
    index: (a: number, b: number) => indices[key(a, b)],
    usages: new WeakMap<RouteLeg[], ReadonlyMap<number, number>>(),
  }
}
export function corridorGeography(world: World) {
  let result = geography.get(world.cells)
  if (!result) {
    result = buildGeography(world)
    geography.set(world.cells, result)
  }
  return result
}

/** A monthly cost/capacity view. Opposing traffic uses the same physical segment. */
export function corridorProfile(world: World) {
  const geo = corridorGeography(world),
    count = geo.segments.length,
    familiarity = new Float64Array(count),
    traffic = new Float64Array(count),
    baseCost = new Float64Array(count),
    cost = new Float64Array(count),
    capacity = new Float64Array(count)
  for (const trace of world.corridors ?? []) {
    const i = geo.index(trace.a, trace.b)
    familiarity[i] = trace.familiarity
    traffic[i] = trace.traffic
  }
  const provinces = new Map(economicRegions(world).map((region) => {
    const tech = world.nations[region.nation].technologies.logistics,
      infra = region.infrastructure,
      damage = 1 - region.devastation * 0.6
    return [region.id, {
      friction:
        (((2 - infra) * (1 + region.devastation * 0.5)) / (1 + tech * 0.1)) *
        effectMultiplier(world, 'tradeCost', region.nation, region.id),
      seaFriction: effectMultiplier(world, 'tradeCost', region.nation, region.id) / (1 + tech * 0.1),
      road:
        (1000 + infra * 6000) *
        (1 + tech * 0.25) *
        damage *
        effectMultiplier(world, 'tradeCapacity', region.nation, region.id),
      port:
        (2500 + infra * 9000) *
        (1 + tech * 0.15) *
        damage *
        effectMultiplier(world, 'tradeCapacity', region.nation, region.id),
    }] as const
  }))
  const cellUnit=new Int32Array(world.cells.length).fill(-1)
  for(const r of economicRegions(world))for(const c of r.cells)cellUnit[c]=r.id
  const globalCost = effectMultiplier(world, 'tradeCost'),
    globalCapacity = effectMultiplier(world, 'tradeCapacity')
  geo.segments.forEach((segment, i) => {
    const { a, b, mode, effort } = segment,
      pa = provinces.get(cellUnit[a])!,
      pb = provinces.get(cellUnit[b])!,
      learning = familiarity[i]
    if (mode === 'land') {
      baseCost[i] = ((effort / 6) * (pa.friction + pb.friction)) / 2
      capacity[i] = Math.min(pa.road, pb.road) / Math.sqrt(effort)
    } else if (mode === 'port') {
      const port = world.cells[a].terrain === 'water' ? pb : pa
      baseCost[i] = (effort / 18) * port.seaFriction
      capacity[i] = port.port
    } else {
      baseCost[i] = (effort / 18) * globalCost
      capacity[i] = 16000 * globalCapacity
    }
    capacity[i] *= 1 + learning * 0.8
    const congestion = Math.min(8, 1.5 * (traffic[i] / capacity[i]) ** 2)
    cost[i] = baseCost[i] * (1 - CORRIDOR_LEARNING.discount * learning) * (1 + congestion)
  })
  return { ...geo, baseCost, cost, capacity }
}
export type CorridorProfile = ReturnType<typeof corridorProfile>

/** Counts traversals, including backtracking through a settlement and counterflow. */
export function corridorUsage(profile: ReturnType<typeof corridorGeography>, legs: RouteLeg[]) {
  const cached = profile.usages.get(legs)
  if (cached) return cached
  const counts = new Map<number, number>()
  for (const leg of legs)
    for (let i = 1; i < leg.cells.length; i++) {
      const index = profile.index(leg.cells[i - 1], leg.cells[i])
      counts.set(index, (counts.get(index) ?? 0) + 1)
    }
  profile.usages.set(legs, counts)
  return counts as ReadonlyMap<number, number>
}

export function corridorCost(profile: CorridorProfile, legs: RouteLeg[]) {
  let cost = 0
  for (const leg of legs) {
    if (leg.mode === 'sea') cost += 2 // Loading/unloading cannot be removed by familiarity.
    for (let i = 1; i < leg.cells.length; i++)
      cost += profile.cost[profile.index(leg.cells[i - 1], leg.cells[i])]
  }
  return cost
}

/** Only fulfilled orders reinforce paths; remembered orders are never freight. */
export function learnCorridors(world: World, profile: CorridorProfile) {
  const rewards = new Float64Array(profile.segments.length),
    loads = new Float64Array(profile.segments.length),
    previous = new Map((world.corridors ?? []).map((trace) => [profile.index(trace.a, trace.b), trace])),
    next: CorridorTrace[] = []
  for (const route of world.routes) {
    if (!route.legs || route.volume <= 0) continue
    const usage = corridorUsage(profile, route.legs)
    let effort = route.legs.filter((leg) => leg.mode === 'sea').length * 2
    for (const [index, count] of usage) effort += profile.baseCost[index] * count
    // Useful tonnes per unit of unreinforced travel effort. A detour earns less;
    // revisiting an edge consumes capacity but never earns a second deposit.
    const reward = route.volume / Math.max(1, effort)
    for (const [index, count] of usage) {
      loads[index] += route.volume * count
      rewards[index] += reward
    }
  }
  profile.segments.forEach(({ a, b }, index) => {
    const old = previous.get(index),
      level = old?.familiarity ?? 0,
      signal = 1 - Math.exp(-rewards[index] / 30),
      familiarity =
        level * (1 - CORRIDOR_LEARNING.evaporation) + (1 - level) * CORRIDOR_LEARNING.gain * signal,
      traffic =
        (old?.traffic ?? 0) * (1 - CORRIDOR_LEARNING.trafficAdjustment) +
        loads[index] * CORRIDOR_LEARNING.trafficAdjustment
    if (familiarity >= 0.001 || traffic >= 0.1) next.push({ a, b, familiarity, traffic })
  })
  world.corridors = next
}
