import { movementNeighbors, stepDistance } from './grid'
import { MinHeap } from './heap'
import { bundleCorridors } from './corridor-bundling'
import { shippingBackbone } from './shipping-backbone'
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
  buffers?: { distance: Float64Array; previous: Int32Array },
) {
  const distance = buffers?.distance ?? new Float64Array(adjacent.length).fill(Infinity),
    previous = buffers?.previous ?? new Int32Array(adjacent.length).fill(-1),
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
    const surveyed = buildNetwork(world)
    network = {
      ...surveyed,
      links: shippingBackbone(world, surveyed.links).map((link) => physicalLink(world, link)),
    }
    cache.set(world.cells, network)
  }
  return network
}

const planned = new WeakMap<CorridorPlan, TransportNetwork>()
export function transportNetwork(world: World): TransportNetwork {
  if (!world.corridorPlan) return baseNetwork(world)
  let network = planned.get(world.corridorPlan)
  if (!network) {
    network = world.corridorPlan.links.every((link) => traversableLegs(world, link.legs))
      ? {
          links: world.corridorPlan.links.map((link) => physicalLink(world, link)),
          harbors: baseNetwork(world).harbors,
        }
      : baseNetwork(world)
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

/** Quarterly cost replanning and nearby trunk consolidation, with annual path inertia. */
export function refreshTransport(world: World, profile: CorridorProfile) {
  const previous = world.corridorPlan?.links.every((link) => traversableLegs(world, link.legs))
    ? world.corridorPlan
    : undefined
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
  const bundled = shippingBackbone(
    world,
    bundleCorridors(
      world,
      profile,
      links,
      (link) =>
        world.month - (ages.get(`${link.from}-${link.to}`) ?? world.month) >=
        CORRIDOR_LEARNING.minimumPathMonths,
    ),
    (link) =>
      world.month - (ages.get(`${link.from}-${link.to}`) ?? world.month) >=
      CORRIDOR_LEARNING.minimumPathMonths,
  )
  for (const link of bundled) {
    const prior = oldLinks.get(`${link.from}-${link.to}`),
      unchanged =
        prior &&
        prior.legs.length === link.legs.length &&
        prior.legs.every(
          (leg, i) =>
            leg.mode === link.legs[i].mode &&
            leg.cells.length === link.legs[i].cells.length &&
            leg.cells.every((cell, j) => cell === link.legs[i].cells[j]),
        )
    link.changedAt = unchanged ? (ages.get(`${link.from}-${link.to}`) ?? world.month) : world.month
  }
  world.corridorPlan = { month: world.month, links: bundled }
}

function buildNetwork(world: World, profile?: CorridorProfile, base?: TransportNetwork): TransportNetwork {
  const { cells, regions } = world,
    { adjacent } = corridorGeography(world),
    isWater = (id: number) => cells[id].terrain === 'water',
    landEffort = (a: number, b: number) =>
      profile ? profile.cost[profile.index(a, b)] : roadCost(cells[a], cells[b])

  // Each province has one road tree rooted at its settlement. Roads to borders
  // and harbors therefore share trunks instead of drawing a separate line per shipment.
  // Province trees are disjoint. One pair of arrays serves the entire map,
  // rather than retaining a map-sized allocation for every province.
  const roadBuffers = {
    distance: new Float64Array(cells.length).fill(Infinity),
    previous: new Int32Array(cells.length).fill(-1),
  }
  const roads = regions.map((r) =>
    search(
      r.center,
      adjacent,
      (a, b) => (cells[b].region === r.id && !isWater(b) ? landEffort(a, b) : Infinity),
      undefined,
      roadBuffers,
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
  if (!base && regions.length > 300) {
    // A sea Voronoi network connects neighboring port catchments. It spans
    // each navigable basin without materializing every possible port pair.
    candidates.push(...seaBackbone(world, harbors, adjacent, shore, borders))
  }
  for (let i = 0; i < harbors.length && (base || regions.length <= 300); i++) {
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
            : (1 + (Number(shore[from]) + Number(shore[to])) * 0.15) * stepDistance(cells[from], cells[to])
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

/** Multi-source sailing distances produce a sparse, physically navigable port graph. */
function seaBackbone(
  world: World,
  ports: Harbor[],
  adjacent: number[][],
  shore: boolean[],
  borders: Map<string, unknown>,
): TransportLink[] {
  const distance = new Float64Array(world.cells.length).fill(Infinity),
    previous = new Int32Array(world.cells.length).fill(-1),
    owner = new Int32Array(world.cells.length).fill(-1),
    queue = new MinHeap(),
    crossings = new Map<string, { from: number; to: number; a: number; b: number; cost: number }>()
  ports.forEach((port, i) => {
    if (distance[port.water] === 0) {
      // Two settlements can share a shore tile, and both still need a sea connection.
      const other = owner[port.water],
        a = ports[other]
      crossings.set(`${a.region}-${port.region}`, {
        from: other,
        to: i,
        a: port.water,
        b: port.water,
        cost: 0,
      })
    } else {
      distance[port.water] = 0
      owner[port.water] = i
      queue.push(port.water, 0)
    }
  })
  while (queue.size) {
    const at = queue.pop()
    if (at.cost !== distance[at.id]) continue
    for (const next of adjacent[at.id]) {
      if (world.cells[next].terrain !== 'water') continue
      const step =
          (1 + (+shore[at.id] + +shore[next]) * 0.15) * stepDistance(world.cells[at.id], world.cells[next]),
        candidate = at.cost + step
      if (candidate < distance[next]) {
        distance[next] = candidate
        previous[next] = at.id
        owner[next] = owner[at.id]
        queue.push(next, candidate)
      }
    }
  }
  for (let a = 0; a < adjacent.length; a++) {
    if (owner[a] < 0) continue
    for (const b of adjacent[a]) {
      if (owner[b] < 0 || owner[a] >= owner[b]) continue
      const from = owner[a],
        to = owner[b],
        key = `${ports[from].region}-${ports[to].region}`,
        cost =
          distance[a] +
          distance[b] +
          (1 + (+shore[a] + +shore[b]) * 0.15) * stepDistance(world.cells[a], world.cells[b])
      if (cost < (crossings.get(key)?.cost ?? Infinity)) crossings.set(key, { from, to, a, b, cost })
    }
  }
  return [...crossings.values()].flatMap((crossing) => {
    const a = ports[crossing.from],
      b = ports[crossing.to]
    if (borders.has(`${a.region}-${b.region}`)) return []
    const left = trace(previous, a.water, crossing.a),
      right = trace(previous, b.water, crossing.b).reverse()
    if (!left.length || !right.length) return []
    if (left.at(-1) === right[0]) right.shift()
    const legs: RouteLeg[] = []
    if (a.access.length > 1) legs.push({ mode: 'land', cells: a.access })
    legs.push({ mode: 'sea', cells: [a.land, ...left, ...right, b.land] })
    if (b.access.length > 1) legs.push({ mode: 'land', cells: [...b.access].reverse() })
    return [{ from: a.region, to: b.region, landCost: a.cost + b.cost, seaCost: crossing.cost + 2, legs }]
  })
}

/** Old route plans cannot keep an impassable ridge open through path inertia. */
export function traversableLegs(world: World, legs: RouteLeg[]) {
  return legs.every((leg) =>
    leg.cells.every(
      (id, i) =>
        i === 0 || movementNeighbors(world.cells, leg.cells[i - 1], world.width, world.height).includes(id),
    ),
  )
}
export function invalidateTransport(world: World) {
  cache.delete(world.cells)
  if (world.corridorPlan) planned.delete(world.corridorPlan)
  delete world.corridorPlan
}
