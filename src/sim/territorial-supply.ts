/** Capital reach follows the same surveyed corridors, border closures and port
 * blockades as commerce. A narrow neutral detour remains a genuine lifeline. */
import { transportGraph } from './economy'
import { seaPassageView } from './naval-control'
import { tradePolicy } from './trade-policy'
import type { World } from './types'

/** One graph per phase, then one bounded traversal per living state. */
export function capitalConnections(w: World) {
  const graph = transportGraph(w),
    policy = tradePolicy(w),
    passage = seaPassageView(w),
    connected = new Uint8Array(w.regions.length)
  // Most states have no closures. Reuse physical connected components for them
  // instead of repeating a full continental traversal for every peaceful capital.
  const components = new Int32Array(graph.length).fill(-1)
  for (let root = 0; root < graph.length; root++) {
    if (components[root] !== -1) continue
    components[root] = root
    const pending = [root]
    while (pending.length)
      for (const edge of graph[pending.pop()!]) {
        if (components[edge.to] !== -1) continue
        components[edge.to] = root
        pending.push(edge.to)
      }
  }
  const blockaded = w.warfare?.fleets.some((f) => f.mission === 'blockade')
  for (const nation of w.nations) {
    if (w.regions[nation.capital]?.nation !== nation.id) continue
    if (policy.unrestricted(nation.id) && !blockaded) {
      for (const r of w.regions)
        if (r.nation === nation.id && components[r.id] === components[nation.capital]) connected[r.id] = 1
      continue
    }
    const visited = new Set([nation.capital]),
      pending = [nation.capital]
    while (pending.length) {
      const at = pending.pop()!
      if (w.regions[at].nation === nation.id) connected[at] = 1
      for (const edge of graph[at]) {
        if (
          visited.has(edge.to) ||
          !policy.routeAllowed(nation.id, nation.id, edge.legs) ||
          (edge.sea && passage(nation.id, edge.legs) <= 0)
        )
          continue
        visited.add(edge.to)
        pending.push(edge.to)
      }
    }
  }
  return connected
}

/** Three months of grace, then a year-long erosion of remote civil reach.
 * Reconnection recovers twice as fast; it does not erase accumulated grievances. */
export function isolationPressure(previous: number, connected: boolean) {
  const months = connected ? Math.max(0, previous - 2) : previous + 1
  return { months, pressure: Math.min(1, Math.max(0, months - 3) / 12) }
}
