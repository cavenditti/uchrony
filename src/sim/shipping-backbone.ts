import { corridorGeography } from './corridors'
import { MinHeap } from './heap'
import { developmentAllowance, ROAD_BACKBONE } from './road-backbone'
import type { RouteLeg, World } from './types'

export const SHIPPING_BACKBONE = { maximumDetour: 2, shortcutRatio: 1.35 } as const

/** Join shipping on water junctions, without forcing intermediate port calls.
 * The network is assembled from surveyed navigable paths; every harbor and its
 * water approach stays fixed. Young adopted paths anchor subsequent reviews.
 */
export function shippingBackbone<T extends { legs: RouteLeg[] }>(
  world: World,
  links: T[],
  canChange: (link: T) => boolean = () => true,
): T[] {
  const geo = corridorGeography(world),
    effort = (cells: number[]) =>
      cells.slice(1).reduce((sum, b, i) => sum + geo.segments[geo.index(cells[i], b)].effort, 0),
    routes = links
      .flatMap((link) => {
        const movable = canChange(link)
        return link.legs
          .filter((leg) => leg.mode === 'sea')
          .map((leg) => {
            const cells = leg.cells.slice(1, -1)
            return { leg, cells, movable, cost: effort(cells), start: cells[0], end: cells.at(-1)! }
          })
      })
      .sort(
        (a, b) =>
          a.cost - b.cost ||
          Math.min(a.start, a.end) - Math.min(b.start, b.end) ||
          Math.max(a.start, a.end) - Math.max(b.start, b.end),
      ),
    parent = new Int32Array(world.cells.length),
    adjacent = new Map<number, Map<number, number>>(),
    searches = new Map<number, Map<number, number>>()
  if (!routes.some((route) => route.movable)) return [...links]
  for (let i = 0; i < parent.length; i++) parent[i] = i
  const root = (id: number) => {
    let at = id
    while (parent[at] !== at) at = parent[at]
    while (id !== at) {
      const next = parent[id]
      parent[id] = at
      id = next
    }
    return at
  }
  const adopt = (cells: number[]) => {
    let changed = false
    for (let i = 1; i < cells.length; i++) {
      const a = cells[i - 1],
        b = cells[i],
        cost = geo.segments[geo.index(a, b)].effort
      parent[root(a)] = root(b)
      if (!adjacent.has(a)) adjacent.set(a, new Map())
      if (!adjacent.has(b)) adjacent.set(b, new Map())
      if (!adjacent.get(a)!.has(b)) changed = true
      adjacent.get(a)!.set(b, cost)
      adjacent.get(b)!.set(a, cost)
    }
    if (changed) searches.clear()
  }
  // Locked paths cannot disappear before their existing minimum tenure.
  for (const route of routes) if (!route.movable) adopt(route.cells)
  // Short port branches join first, then crossings connect the remaining
  // components. Shared water junctions count as connections immediately.
  for (const route of routes) if (root(route.start) !== root(route.end)) adopt(route.cells)
  const path = (start: number, end: number) => {
    if (start === end) return [start]
    let previous = searches.get(start)
    if (!previous) {
      previous = new Map()
      const distance = new Map([[start, 0]]),
        queue = new MinHeap()
      queue.push(start, 0)
      while (queue.size) {
        const at = queue.pop()
        if (at.cost !== distance.get(at.id)) continue
        for (const [next, step] of adjacent.get(at.id) ?? []) {
          const cost = at.cost + step
          if (cost >= (distance.get(next) ?? Infinity)) continue
          distance.set(next, cost)
          previous.set(next, at.id)
          queue.push(next, cost)
        }
      }
      // Bound temporary predecessor storage even on worlds with hundreds of ports.
      if (searches.size >= 8) searches.delete(searches.keys().next().value!)
      searches.set(start, previous)
    }
    const cells = [end]
    while (cells.at(-1) !== start) {
      const next = previous.get(cells.at(-1)!)
      if (next === undefined) throw new Error('Disconnected surveyed shipping corridor')
      cells.push(next)
    }
    return cells.reverse()
  }
  // Bound sailing detours on the actual water graph, not on journeys through
  // port cities. A relief crossing may serve many original destination pairs.
  for (const route of routes)
    if (effort(path(route.start, route.end)) > route.cost * SHIPPING_BACKBONE.maximumDetour + 1e-9)
      adopt(route.cells)
  const busy = new Set<number>(),
    extras = new Map<number, number>()
  for (const trace of world.corridors ?? [])
    if (
      trace.familiarity >= ROAD_BACKBONE.familiarity &&
      trace.traffic >= 0.1 &&
      world.cells[trace.a].terrain === 'water' &&
      world.cells[trace.b].terrain === 'water'
    ) {
      busy.add(trace.a)
      busy.add(trace.b)
    }
  for (const route of routes) {
    const from = world.regions[world.cells[route.leg.cells[0]].region],
      to = world.regions[world.cells[route.leg.cells.at(-1)!].region]
    if (
      (extras.get(route.start) ?? 0) >= developmentAllowance(world, from, busy.has(route.start)) ||
      (extras.get(route.end) ?? 0) >= developmentAllowance(world, to, busy.has(route.end)) ||
      effort(path(route.start, route.end)) <= route.cost * SHIPPING_BACKBONE.shortcutRatio + 1e-9
    )
      continue
    adopt(route.cells)
    for (const port of [route.start, route.end]) extras.set(port, (extras.get(port) ?? 0) + 1)
  }
  const replacements = new Map<RouteLeg, RouteLeg>()
  for (const route of routes) {
    if (!route.movable) continue
    const cells = [route.leg.cells[0], ...path(route.start, route.end), route.leg.cells.at(-1)!]
    if (cells.length !== route.leg.cells.length || cells.some((cell, i) => cell !== route.leg.cells[i]))
      replacements.set(route.leg, { mode: 'sea', cells })
  }
  return links.map((link) =>
    link.legs.some((leg) => replacements.has(leg))
      ? { ...link, legs: link.legs.map((leg) => replacements.get(leg) ?? leg) }
      : link,
  )
}
