import type { CorridorProfile } from './corridors'
import { MinHeap } from './heap'
import type { RouteLeg, World } from './types'

export const CORRIDOR_BUNDLING = {
  radius: 8,
  minimumSharedEdges: 3,
  travelWeight: 0.15,
  maximumExtraEffort: 0.25,
  maximumExtraCost: 0.4,
  passes: 4,
} as const

/** Minimize occupied corridor effort plus travel effort across the surveyed network.
 * Each leg temporarily releases its edges before looking for a shared alternative.
 * The network score must strictly decrease; actual freight pays undiscounted costs.
 */
export function bundleCorridors<T extends { from: number; to: number; legs: RouteLeg[] }>(
  world: World,
  profile: CorridorProfile,
  links: T[],
  canChange: (link: T) => boolean,
): T[] {
  const { radius, minimumSharedEdges, travelWeight, maximumExtraEffort, maximumExtraCost, passes } =
    CORRIDOR_BUNDLING
  const result = [...links]
  if (!(world.corridors ?? []).some((trace) => trace.traffic >= 0.1)) return result

  const usage = new Uint32Array(profile.segments.length),
    seen = new Int32Array(world.cells.length),
    depth = new Uint8Array(world.cells.length),
    distance = new Float64Array(world.cells.length),
    previous = new Int32Array(world.cells.length)
  const pathOf = (leg: RouteLeg) => (leg.mode === 'sea' ? leg.cells.slice(1, -1) : leg.cells)
  const visitEdges = (path: number[], visit: (edge: number) => void) => {
    for (let i = 1; i < path.length; i++) visit(profile.index(path[i - 1], path[i]))
  }
  const effort = (path: number[], costs: Float64Array) => {
    let total = 0
    visitEdges(path, (edge) => {
      total += costs[edge]
    })
    return total
  }
  const score = (path: number[]) => {
    let total = 0
    visitEdges(path, (edge) => {
      total += (usage[edge] ? 0 : profile.baseCost[edge]) + travelWeight * profile.cost[edge]
    })
    return total
  }
  const shared = (path: number[]) => {
    let run = 0,
      longest = 0
    visitEdges(path, (edge) => {
      if (usage[edge]) {
        longest = Math.max(longest, ++run)
      } else run = 0
    })
    return longest
  }
  const networkScore = (network: T[]) => {
    const occupied = new Set<number>()
    let total = 0
    for (const link of network)
      for (const leg of link.legs)
        visitEdges(pathOf(leg), (edge) => {
          if (!occupied.has(edge)) total += profile.baseCost[edge]
          occupied.add(edge)
          total += travelWeight * profile.cost[edge]
        })
    return total
  }

  // Long connections join the network first. Unlike current path length, endpoint
  // span cannot change just because a branch acquired joining sections.
  const ordered = links
    .map((link, index) => ({
      link,
      index,
      movable: canChange(link),
      span: Math.max(
        0,
        ...link.legs.map((leg) => {
          const a = world.cells[leg.cells[0]],
            b = world.cells[leg.cells.at(-1)!]
          return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
        }),
      ),
      originals: link.legs.map(pathOf),
    }))
    .sort((a, b) => b.span - a.span || a.link.from - b.link.from || a.link.to - b.link.to)

  let generation = 0
  const bundle = (leg: RouteLeg, original: number[], release = true): RouteLeg => {
    const path = pathOf(leg)
    if (path.length <= minimumSharedEdges) return leg
    const start = path[0],
      end = path.at(-1)!,
      fromRegion = world.cells[start].region,
      toRegion = world.cells[end].region,
      allowed = (id: number) => {
        const cell = world.cells[id]
        return leg.mode === 'sea'
          ? cell.terrain === 'water'
          : cell.terrain !== 'water' && (cell.region === fromRegion || cell.region === toRegion)
      },
      // Always bound search and detours against the input, not successive passes.
      band = [...original]
    generation++
    for (const id of band) {
      seen[id] = generation
      depth[id] = 0
    }
    for (let i = 0; i < band.length; i++) {
      const at = band[i]
      if (depth[at] === radius) continue
      for (const next of profile.adjacent[at]) {
        if (seen[next] === generation || !allowed(next)) continue
        seen[next] = generation
        depth[next] = depth[at] + 1
        band.push(next)
      }
    }
    if (release) visitEdges(path, (edge) => usage[edge]--)
    const oldScore = score(path),
      maxEffort = effort(original, profile.baseCost) * (1 + maximumExtraEffort),
      maxCost = effort(original, profile.cost) * (1 + maximumExtraCost)
    let best = path,
      bestScore = oldScore
    // If the strongest attraction proposes an excessive detour, try more
    // travel-sensitive alternatives rather than rejecting every possible join.
    for (const weight of [travelWeight, 0.5, 1.5]) {
      for (const id of band) {
        distance[id] = Infinity
        previous[id] = -1
      }
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
            cost = at.cost + (usage[edge] ? 0 : profile.baseCost[edge]) + weight * profile.cost[edge]
          if (cost >= distance[next]) continue
          distance[next] = cost
          previous[next] = at.id
          queue.push(next, cost)
        }
      }
      if (!Number.isFinite(distance[end])) continue
      const joined = [end]
      while (joined.at(-1) !== start) joined.push(previous[joined.at(-1)!])
      joined.reverse()
      const overlap = shared(joined),
        candidateScore = score(joined)
      if (
        candidateScore >= bestScore - 1e-9 ||
        overlap < minimumSharedEdges ||
        joined.length > original.length + radius * 2 ||
        effort(joined, profile.baseCost) > maxEffort ||
        effort(joined, profile.cost) > maxCost
      )
        continue
      best = joined
      bestScore = candidateScore
      // The first search minimizes the exact network objective. A valid result
      // cannot be improved by the fallback searches.
      break
    }
    visitEdges(best, (edge) => usage[edge]++)
    return best === path
      ? leg
      : {
          mode: leg.mode,
          cells: leg.mode === 'sea' ? [leg.cells[0], ...best, leg.cells.at(-1)!] : best,
        }
  }

  // Establish long, actually used trunks first. A pure all-pairs relaxation can
  // settle on a web of short private connectors before any useful trunk forms.
  // This seed uses the same search and bounds; unused connections cannot anchor it.
  const active = new Uint8Array(profile.segments.length)
  for (const trace of world.corridors ?? [])
    if (trace.traffic >= 0.1) active[profile.index(trace.a, trace.b)] = 1
  usage.fill(0)
  for (const { link, index, movable, originals } of ordered) {
    const legs = link.legs.map((leg, i) => {
      const path = originals[i]
      let used = 0
      visitEdges(path, (edge) => {
        used += active[edge]
      })
      if (path.length <= minimumSharedEdges || used < (path.length - 1) * 0.8) return leg
      if (movable) return bundle(leg, path, false)
      visitEdges(path, (edge) => usage[edge]++)
      return leg
    })
    if (legs.some((leg, i) => leg !== link.legs[i])) result[index] = { ...link, legs }
  }
  usage.fill(0)
  for (const link of result) for (const leg of link.legs) visitEdges(pathOf(leg), (edge) => usage[edge]++)

  for (let pass = 0; pass < passes; pass++) {
    let changed = false
    for (const { index, movable, originals } of ordered) {
      if (!movable) continue
      const link = result[index],
        legs = link.legs.map((leg, i) => bundle(leg, originals[i]))
      if (legs.some((leg, i) => leg !== link.legs[i])) {
        result[index] = { ...link, legs }
        changed = true
      }
    }
    if (!changed) break
  }
  // Seeding sees only the trunks established so far. Check the complete network
  // too, so neither seeding nor repeated reviews can worsen the same objective.
  return networkScore(result) < networkScore(links) - 1e-9 ? result : [...links]
}
