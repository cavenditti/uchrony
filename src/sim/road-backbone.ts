import { parameterGroup } from './configuration-context'
import { corridorGeography } from './corridors'
import { MinHeap } from './heap'
import type { Region, RouteLeg, World } from './types'

export const ROAD_BACKBONE = parameterGroup('roads')

interface Road {
  from: number
  to: number
  legs: RouteLeg[]
}

/** Shared development gate; each network supplies its own evidence of traffic. */
export function developmentAllowance(world: World, region: Region, busy: boolean) {
  const logistics = world.nations?.[region.nation]?.technologies.logistics ?? 0
  return region.infrastructure >= ROAD_BACKBONE.infrastructure && logistics >= ROAD_BACKBONE.logistics && busy
    ? Math.min(3, 1 + Math.floor((logistics - ROAD_BACKBONE.logistics) / 2))
    : 0
}

/** Select actual civilian roads from surveyed possibilities. A young economy
 * gets a sparse backbone; developed, busy places can justify useful cross-links.
 * Geography ranks the forest, so monthly prices and congestion cannot reshuffle it.
 */
export function roadBackbone<T extends Road>(
  world: World,
  links: T[],
  place: (id: number) => Region = (id) => world.regions[id],
): T[] {
  const geo = corridorGeography(world),
    roads = links
      .filter((link) => link.legs.length && link.legs.every((leg) => leg.mode === 'land'))
      .map((link) => ({
        link,
        domestic: place(link.from).nation === place(link.to).nation,
        effort: link.legs.reduce(
          (sum, leg) =>
            sum +
            leg.cells
              .slice(1)
              .reduce((cost, b, i) => cost + geo.segments[geo.index(leg.cells[i], b)].effort, 0),
          0,
        ),
      }))
      .sort(
        (a, b) =>
          Number(b.domestic) - Number(a.domestic) ||
          a.effort - b.effort ||
          Math.min(a.link.from, a.link.to) - Math.min(b.link.from, b.link.to) ||
          Math.max(a.link.from, a.link.to) - Math.max(b.link.from, b.link.to),
      ),
    parent = new Map<number, number>(),
    tree = new Map<number, { to: number; cost: number }[]>(),
    selected = new Set<T>()
  for (const { link } of roads)
    for (const id of [link.from, link.to]) {
      parent.set(id, id)
      tree.set(id, [])
    }
  const root = (id: number): number => {
    let at = id
    while (parent.get(at) !== at) at = parent.get(at)!
    while (id !== at) {
      const next = parent.get(id)!
      parent.set(id, at)
      id = next
    }
    return at
  }
  const adopt = (link: T, effort: number) => {
    selected.add(link)
    tree.get(link.from)!.push({ to: link.to, cost: effort })
    tree.get(link.to)!.push({ to: link.from, cost: effort })
  }
  // Connect domestic components first: a country's internal access must not
  // depend on an incidental shortcut through another country.
  for (const { link, effort } of roads) {
    const a = root(link.from),
      b = root(link.to)
    if (a === b) continue
    parent.set(b, a)
    adopt(link, effort)
  }

  const busy = new Set<number>()
  for (const trace of world.corridors ?? [])
    if (trace.familiarity >= ROAD_BACKBONE.familiarity && trace.traffic >= 0.1) {
      busy.add(trace.a)
      busy.add(trace.b)
    }
  const allowance = (id: number) => {
      const region = place(id)
      return developmentAllowance(world, region, busy.has(region.center))
    },
    extras = new Map<number, number>()
  const closeEnough = (from: number, to: number, limit: number) => {
    const distance = new Map([[from, 0]]),
      queue = new MinHeap()
    queue.push(from, 0)
    while (queue.size) {
      const at = queue.pop()
      if (at.cost !== distance.get(at.id)) continue
      if (at.cost > limit) break
      if (at.id === to) return true
      for (const edge of tree.get(at.id)!) {
        const cost = at.cost + edge.cost
        if (cost > limit || cost >= (distance.get(edge.to) ?? Infinity)) continue
        distance.set(edge.to, cost)
        queue.push(edge.to, cost)
      }
    }
    return false
  }
  // A strict tree can send neighboring cities around an entire continent.
  // Add only the connections needed to bound those exceptional detours.
  for (const { link, effort } of roads)
    if (!selected.has(link) && !closeEnough(link.from, link.to, effort * ROAD_BACKBONE.maximumDetour))
      adopt(link, effort)
  for (const { link, effort } of roads) {
    if (
      selected.has(link) ||
      (extras.get(link.from) ?? 0) >= allowance(link.from) ||
      (extras.get(link.to) ?? 0) >= allowance(link.to) ||
      closeEnough(link.from, link.to, effort * ROAD_BACKBONE.shortcutRatio)
    )
      continue
    adopt(link, effort)
    for (const id of [link.from, link.to]) extras.set(id, (extras.get(id) ?? 0) + 1)
  }
  return links.filter((link) => link.legs.some((leg) => leg.mode === 'sea') || selected.has(link))
}

/** Apply after access/capacity checks, retaining the original edge objects and
 * their undiscounted costs and shared physical capacity in both directions.
 */
export function retainRoadBackbone<T extends { to: number; legs: RouteLeg[] }>(
  world: World,
  graph: Iterable<[number, T[]]>,
  place: (id: number) => Region = (id) => world.regions[id],
) {
  const entries = [...graph],
    roads = entries.flatMap(([from, edges]) =>
      edges.filter((edge) => from < edge.to).map((edge) => ({ from, to: edge.to, legs: edge.legs })),
    ),
    key = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`,
    chosen = new Set(roadBackbone(world, roads, place).map((road) => key(road.from, road.to)))
  for (const [from, edges] of entries)
    for (let i = edges.length - 1; i >= 0; i--)
      if (!edges[i].legs.some((leg) => leg.mode === 'sea') && !chosen.has(key(from, edges[i].to)))
        edges.splice(i, 1)
}
