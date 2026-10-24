import { CORRIDOR_LEARNING, type CorridorProfile } from './corridors'
import { MinHeap } from './heap'
import type { RouteLeg, World } from './types'

export const CORRIDOR_BUNDLING = {
  radius: 3,
  minimumSharedEdges: 12,
  reuseDiscount: 0.4,
  maximumExtraEffort: 0.15,
  maximumExtraCost: 0.3,
} as const

/** Consolidate nearby physical paths, without changing ports or connection pairs.
 * The reuse credit is a planning preference only; freight pays the real tile cost.
 */
export function bundleCorridors<T extends { from: number; to: number; legs: RouteLeg[] }>(
  world: World,
  profile: CorridorProfile,
  links: T[],
  canChange: (link: T) => boolean,
): T[] {
  const { radius, minimumSharedEdges, reuseDiscount, maximumExtraEffort, maximumExtraCost } =
      CORRIDOR_BUNDLING,
    active = new Uint8Array(profile.segments.length),
    trunk = new Uint8Array(profile.segments.length),
    trunkCells = new Uint8Array(world.cells.length),
    result = [...links]
  for (const trace of world.corridors ?? [])
    if (trace.traffic >= 0.1) active[profile.index(trace.a, trace.b)] = 1
  if (!active.some(Boolean)) return result

  // Reuse map-sized scratch space; each search touches only the route's narrow band.
  const seen = new Int32Array(world.cells.length),
    depth = new Uint8Array(world.cells.length),
    distance = new Float64Array(world.cells.length),
    previous = new Int32Array(world.cells.length)
  let generation = 0
  const effort = (path: number[], costs: Float64Array, credit = false) => {
    let total = 0
    for (let i = 1; i < path.length; i++) {
      const edge = profile.index(path[i - 1], path[i])
      total += costs[edge] * (credit && trunk[edge] ? 1 - reuseDiscount : 1)
    }
    return total
  }
  const shared = (path: number[]) => {
    let total = 0,
      run = 0,
      longest = 0
    for (let i = 1; i < path.length; i++) {
      if (trunk[profile.index(path[i - 1], path[i])]) {
        total++
        longest = Math.max(longest, ++run)
      } else run = 0
    }
    return { total, longest }
  }
  const bundle = (leg: RouteLeg): RouteLeg => {
    // Preserve both the land harbor and its selected water tile.
    const path = leg.mode === 'sea' ? leg.cells.slice(1, -1) : leg.cells
    if (path.length <= minimumSharedEdges) return leg
    const start = path[0],
      end = path[path.length - 1],
      fromRegion = world.cells[start].region,
      toRegion = world.cells[end].region,
      allowed = (id: number) => {
        const cell = world.cells[id]
        return leg.mode === 'sea'
          ? cell.terrain === 'water'
          : cell.terrain !== 'water' && (cell.region === fromRegion || cell.region === toRegion)
      },
      band = [...path]
    generation++
    for (const id of band) {
      seen[id] = generation
      depth[id] = 0
      distance[id] = Infinity
      previous[id] = -1
    }
    let nearby = false
    for (let i = 0; i < band.length; i++) {
      const at = band[i]
      if (trunkCells[at]) nearby = true
      if (depth[at] === radius) continue
      for (const next of profile.adjacent[at]) {
        if (seen[next] === generation || !allowed(next)) continue
        seen[next] = generation
        depth[next] = depth[at] + 1
        distance[next] = Infinity
        previous[next] = -1
        band.push(next)
      }
    }
    if (!nearby) return leg
    const queue = new MinHeap()
    distance[start] = 0
    queue.push(start, 0)
    while (queue.size) {
      const at = queue.pop()
      if (at.cost !== distance[at.id]) continue
      if (at.id === end) break
      for (const next of profile.adjacent[at.id]) {
        if (seen[next] !== generation) continue
        const edge = profile.index(at.id, next),
          cost = at.cost + profile.cost[edge] * (trunk[edge] ? 1 - reuseDiscount : 1)
        if (cost >= distance[next]) continue
        distance[next] = cost
        previous[next] = at.id
        queue.push(next, cost)
      }
    }
    if (distance[end] >= effort(path, profile.cost, true) * (1 - CORRIDOR_LEARNING.improvement)) return leg
    const joined = [end]
    while (joined[joined.length - 1] !== start) {
      const next = previous[joined[joined.length - 1]]
      if (next < 0) return leg
      joined.push(next)
    }
    joined.reverse()
    const overlap = shared(joined)
    if (
      overlap.longest < minimumSharedEdges ||
      overlap.total < shared(path).total + minimumSharedEdges ||
      joined.length > path.length + radius * 2 ||
      effort(joined, profile.baseCost) > effort(path, profile.baseCost) * (1 + maximumExtraEffort) ||
      effort(joined, profile.cost) > effort(path, profile.cost) * (1 + maximumExtraCost)
    )
      return leg
    return {
      mode: leg.mode,
      cells: leg.mode === 'sea' ? [leg.cells[0], ...joined, leg.cells[leg.cells.length - 1]] : joined,
    }
  }

  // Longest trunks first, with stable endpoint tie breaks. Accepted paths alone
  // attract later links, so two equally busy parallel lanes do not attract each other.
  const ordered = links
    .map((link, index) => ({ link, index, length: Math.max(...link.legs.map((leg) => leg.cells.length)) }))
    .sort((a, b) => b.length - a.length || a.link.from - b.link.from || a.link.to - b.link.to)
  for (const { link, index } of ordered) {
    const legs = canChange(link) ? link.legs.map(bundle) : link.legs
    if (legs.some((leg, i) => leg !== link.legs[i])) result[index] = { ...link, legs }
    for (const leg of legs) {
      if (leg.cells.length <= minimumSharedEdges) continue
      for (let i = 1; i < leg.cells.length; i++) {
        const a = leg.cells[i - 1],
          b = leg.cells[i],
          edge = profile.index(a, b)
        if (!active[edge] || profile.segments[edge].mode === 'port') continue
        trunk[edge] = trunkCells[a] = trunkCells[b] = 1
      }
    }
  }
  return result
}
