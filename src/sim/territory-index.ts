/** A phase owns its territorial index. Rebuild after any phase that can change
 * sovereignty; never retain it across ticks, commands, save restoration or trials.
 * This makes invalidation explicit without instrumenting every historical writer. */
import type { Region, World } from './types'

/** Group provinces in O(regions). Border sets are built once on first use, in
 * O(regions + edges), so fiscal/science summaries pay no border-allocation cost. */
export function territorialIndex(w: World) {
  const regions = new Map<number, Region[]>()
  let borders: Map<number, Set<number>> | undefined
  for (const r of w.regions) {
    let own = regions.get(r.nation)
    if (!own) regions.set(r.nation, (own = []))
    own.push(r)
  }
  return {
    regions: (nation: number): readonly Region[] => regions.get(nation) ?? [],
    alive: (nation: number) => regions.has(nation),
    bordering: (a: number, b: number) => {
      if (!borders) {
        borders = new Map()
        for (const [nation, own] of regions) {
          const adjacent = new Set<number>()
          for (const r of own) for (const id of r.neighbors) adjacent.add(w.regions[id].nation)
          borders.set(nation, adjacent)
        }
      }
      return borders.get(a)?.has(b) ?? false
    },
  }
}
/** Standalone callers receive a fresh collection; phase code reuses territorialIndex. */
export const nationRegions = (w: World, id: number) => w.regions.filter((r) => r.nation === id)
/** Legal ownership, rather than temporary military occupation, determines survival. */
export const isAlive = (w: World, id: number) => w.regions.some((r) => r.nation === id)
/** Border direction follows the province neighbor graph, including domestic neighbors. */
export const bordering = (w: World, a: number, b: number) =>
  w.regions.some((r) => r.nation === a && r.neighbors.some((id) => w.regions[id].nation === b))
