import { MinHeap } from './heap'
import type { Cell, CorridorPlan, RouteLeg, World } from './types'
import {
  CORRIDOR_LEARNING,
  corridorCost,
  corridorGeography,
  roadCost,
  type CorridorProfile,
} from './corridors'

export interface TransportLink {
  from: number
  to: number
  landCost: number
  seaCost: number
  legs: RouteLeg[]
}
export interface Harbor {
  region: number
  land: number
  water: number
  access: number[]
  cost: number
}
export interface TransportNetwork {
  links: TransportLink[]
  harbors: Harbor[]
}
const cache = new WeakMap<Cell[], TransportNetwork>()

function search(
  start: number,
  adjacent: number[][],
  cost: (a: number, b: number) => number,
  targets?: Set<number>,
) {
  const distance = new Float64Array(adjacent.length).fill(Infinity),
    previous = new Int32Array(adjacent.length).fill(-1),
    queue = new MinHeap()
  distance[start] = 0
  queue.push(start, 0)
  while (queue.size) {
    const at = queue.pop()
    if (at.cost !== distance[at.id]) continue
    if (targets) {
      targets.delete(at.id)
      if (!targets.size) break
    }
    for (const next of adjacent[at.id]) {
      const candidate = at.cost + cost(at.id, next)
      if (candidate < distance[next]) {
        distance[next] = candidate
        previous[next] = at.id
        queue.push(next, candidate)
      }
    }
  }
  return { distance, previous }
}

function trace(previous: Int32Array, start: number, end: number) {
  const path = [end]
  while (path[path.length - 1] !== start) {
    const next = previous[path[path.length - 1]]
    if (next < 0 || path.length > previous.length) return []
    path.push(next)
  }
  return path.reverse()
}

const reversed = new WeakMap<RouteLeg[], RouteLeg[]>()
export function reverseLegs(legs: RouteLeg[]): RouteLeg[] {
  let result = reversed.get(legs)
  if (!result) {
    result = [...legs].reverse().map((leg) => ({ mode: leg.mode, cells: [...leg.cells].reverse() }))
    reversed.set(legs, result)
  }
  return result
}

/** Static harbor locations and connection pairs are determined by geography. */
function baseNetwork(world: World): TransportNetwork {
  let network = cache.get(world.cells)
  if (!network) {
    network = buildNetwork(world)
    cache.set(world.cells, network)
  }
  return network
}

const planned = new WeakMap<CorridorPlan, TransportNetwork>()
export function transportNetwork(world: World): TransportNetwork {
  if (!world.corridorPlan) return baseNetwork(world)
  let network = planned.get(world.corridorPlan)
  if (!network) {
    network = {
      links: world.corridorPlan.links.map((link) => physicalLink(world, link)),
      harbors: baseNetwork(world).harbors,
    }
    planned.set(world.corridorPlan, network)
  }
  return network
}

function physicalLink(world: World, link: { from: number; to: number; legs: RouteLeg[] }): TransportLink {
  const geo = corridorGeography(world)
  let landCost = 0,
    seaCost = 0
  for (const leg of link.legs)
    for (let i = 1; i < leg.cells.length; i++) {
      const segment = geo.segments[geo.index(leg.cells[i - 1], leg.cells[i])]
      if (segment.mode === 'land') landCost += segment.effort
      else seaCost += segment.effort
    }
  return { ...link, landCost, seaCost }
}

/** Reconsider tile paths quarterly; retain the old path unless savings exceed 5%. */
export function refreshTransport(world: World, profile: CorridorProfile) {
  const previous = world.corridorPlan
  if (
    previous &&
    Math.floor(previous.month / CORRIDOR_LEARNING.replanMonths) ===
      Math.floor(world.month / CORRIDOR_LEARNING.replanMonths)
  )
    return
  if (
    previous &&
    previous.links.every((link) => world.month - link.changedAt < CORRIDOR_LEARNING.minimumPathMonths)
  )
    return
  const base = baseNetwork(world),
    old = transportNetwork(world),
    proposed = world.corridors?.length ? buildNetwork(world, profile, base) : base,
    oldLinks = new Map(old.links.map((link) => [`${link.from}-${link.to}`, link])),
    ages = new Map(previous?.links.map((link) => [`${link.from}-${link.to}`, link.changedAt]))
  const links = proposed.links.map((link) => {
    const prior = oldLinks.get(`${link.from}-${link.to}`),
      changedAt = ages.get(`${link.from}-${link.to}`) ?? world.month,
      keep =
        prior &&
        (world.month - changedAt < CORRIDOR_LEARNING.minimumPathMonths ||
          corridorCost(profile, prior.legs) * (1 - CORRIDOR_LEARNING.improvement) <=
            corridorCost(profile, link.legs)),
      selected = keep ? prior : link
    return {
      from: selected.from,
      to: selected.to,
      legs: selected.legs,
      changedAt: keep ? changedAt : world.month,
    }
  })
  world.corridorPlan = { month: world.month, links }
}

function buildNetwork(world: World, profile?: CorridorProfile, base?: TransportNetwork): TransportNetwork {
  const { cells, regions } = world,
    { adjacent } = corridorGeography(world),
    isWater = (id: number) => cells[id].terrain === 'water',
    landEffort = (a: number, b: number) =>
      profile ? profile.cost[profile.index(a, b)] : roadCost(cells[a], cells[b])

  // Each province has one road tree rooted at its settlement. Roads to borders
  // and harbors therefore share trunks instead of drawing a separate line per shipment.
  const roads = regions.map((r) =>
    search(r.center, adjacent, (a, b) =>
      cells[b].region === r.id && !isWater(b) ? landEffort(a, b) : Infinity,
    ),
  )
  const borders = new Map<string, { from: number; to: number; a: number; b: number; cost: number }>()
  for (const a of cells) {
    if (isWater(a.id)) continue
    for (const id of adjacent[a.id]) {
      const b = cells[id]
      if (isWater(id) || a.region >= b.region) continue
      const cost = roads[a.region].distance[a.id] + landEffort(a.id, b.id) + roads[b.region].distance[b.id],
        key = `${a.region}-${b.region}`
      if (Number.isFinite(cost) && cost < (borders.get(key)?.cost ?? Infinity))
        borders.set(key, { from: a.region, to: b.region, a: a.id, b: b.id, cost })
    }
  }
  const links: TransportLink[] = [...borders.values()].map((b) => ({
    from: b.from,
    to: b.to,
    landCost: b.cost,
    seaCost: 0,
    legs: [
      {
        mode: 'land',
        cells: [
          ...trace(roads[b.from].previous, regions[b.from].center, b.a),
          ...trace(roads[b.to].previous, regions[b.to].center, b.b).reverse(),
        ],
      },
    ],
  }))

  const harbors: Harbor[] = []
  if (base) {
    // Ports do not jump along the coast when shipping lanes improve.
    for (const port of base.harbors)
      harbors.push({
        ...port,
        access: trace(roads[port.region].previous, regions[port.region].center, port.land),
        cost: roads[port.region].distance[port.land],
      })
  } else {
    // A province facing a lake and the ocean uses the larger connected water body.
    // The selected shore must be reachable by road from its settlement.
    const basin = new Int32Array(cells.length).fill(-1),
      sizes: number[] = []
    for (const c of cells) {
      if (!isWater(c.id) || basin[c.id] >= 0) continue
      const id = sizes.length,
        group = [c.id]
      basin[c.id] = id
      for (let i = 0; i < group.length; i++)
        for (const next of adjacent[group[i]])
          if (isWater(next) && basin[next] < 0) {
            basin[next] = id
            group.push(next)
          }
      sizes.push(group.length)
    }
    for (const r of regions) {
      let best: Harbor | undefined
      for (const id of r.cells) {
        const cost = roads[r.id].distance[id]
        if (!Number.isFinite(cost)) continue
        for (const water of adjacent[id]) {
          if (!isWater(water)) continue
          if (
            !best ||
            sizes[basin[water]] > sizes[basin[best.water]] ||
            (basin[water] === basin[best.water] && cost < best.cost)
          )
            best = { region: r.id, land: id, water, cost, access: [] }
        }
      }
      if (best) {
        best.access = trace(roads[r.id].previous, r.center, best.land)
        harbors.push(best)
      }
    }
  }
  const shore = cells.map((c) => isWater(c.id) && adjacent[c.id].some((n) => !isWater(n))),
    candidates: TransportLink[] = [],
    seaPairs = base
      ? new Set(base.links.filter((link) => link.seaCost > 0).map((link) => `${link.from}-${link.to}`))
      : undefined
  for (let i = 0; i < harbors.length; i++) {
    const a = harbors[i]
    if (seaPairs && !harbors.slice(i + 1).some((b) => seaPairs.has(`${a.region}-${b.region}`))) continue
    // A replan needs only the existing destination ports, not distances to every sea tile.
    const targets = seaPairs
      ? new Set(
          harbors
            .slice(i + 1)
            .filter((b) => seaPairs.has(`${a.region}-${b.region}`))
            .map((b) => b.water),
        )
      : undefined
    const paths = search(
      a.water,
      adjacent,
      (from, to) =>
        isWater(to)
          ? profile
            ? profile.cost[profile.index(from, to)]
            : 1 + (Number(shore[from]) + Number(shore[to])) * 0.15
          : Infinity,
      targets,
    )
    for (let j = i + 1; j < harbors.length; j++) {
      const b = harbors[j],
        seaCost = paths.distance[b.water]
      if (
        (seaPairs && !seaPairs.has(`${a.region}-${b.region}`)) ||
        !Number.isFinite(seaCost) ||
        borders.has(`${Math.min(a.region, b.region)}-${Math.max(a.region, b.region)}`)
      )
        continue
      const legs: RouteLeg[] = []
      if (a.access.length > 1) legs.push({ mode: 'land', cells: a.access })
      legs.push({ mode: 'sea', cells: [a.land, ...trace(paths.previous, a.water, b.water), b.land] })
      if (b.access.length > 1) legs.push({ mode: 'land', cells: [...b.access].reverse() })
      candidates.push({ from: a.region, to: b.region, landCost: a.cost + b.cost, seaCost: seaCost + 2, legs })
    }
  }
  if (base) return { links: [...links, ...candidates].map((link) => physicalLink(world, link)), harbors }
  const effort = (link: TransportLink) => link.landCost / 6 + link.seaCost / 18 + 2
  candidates.sort((a, b) => effort(a) - effort(b) || a.from - b.from || a.to - b.to)
  const chosen = new Set<TransportLink>(),
    parent = regions.map((r) => r.id)
  const root = (id: number): number => (parent[id] === id ? id : (parent[id] = root(parent[id])))
  // Preserve connectivity between landmasses without a distance cutoff that
  // strands islands. Then add the three cheapest sea connections at each port.
  for (const link of links) parent[root(link.from)] = root(link.to)
  const landmass = regions.map((r) => root(r.id))
  for (const link of candidates) {
    if (root(link.from) === root(link.to)) continue
    parent[root(link.from)] = root(link.to)
    chosen.add(link)
  }
  for (const harbor of harbors) {
    const nearby = candidates.filter((l) => l.from === harbor.region || l.to === harbor.region)
    for (const link of nearby.slice(0, 3)) chosen.add(link)
    // Coastal neighbors must not crowd out useful crossings. Give each harbor
    // access to the two nearest other landmasses, avoiding a single artificial
    // intercontinental bottleneck selected by the connectivity tree above.
    const destinations = new Set<number>([landmass[harbor.region]])
    for (const link of nearby) {
      const other = landmass[link.from === harbor.region ? link.to : link.from]
      if (destinations.has(other)) continue
      destinations.add(other)
      chosen.add(link)
      if (destinations.size === 3) break
    }
  }
  links.push(...chosen)
  return { links, harbors }
}
