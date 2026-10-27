import { MinHeap } from './heap'
import { random } from './random'
import type { World } from './types'

/** Terrain-weighted Voronoi regions on the land graph. Every homeland grows
 * from a single origin; disconnected islands receive their own origin. */
export function identityHomelands(world: World, rng: { rng: number }) {
  const { regions, cells } = world
  const seeds = [regions[Math.floor(random(rng) * regions.length)].id]
  const count = Math.min(regions.length, Math.max(4, Math.round(Math.sqrt(regions.length))))
  const distance = new Float64Array(regions.length).fill(Infinity)
  while (seeds.length < count) {
    const last = cells[regions[seeds[seeds.length - 1]].center]
    let best = -1
    for (const r of regions) {
      const at = cells[r.center]
      distance[r.id] = Math.min(distance[r.id], Math.hypot(last.x - at.x, last.y - at.y))
      if (!seeds.includes(r.id) && (best < 0 || distance[r.id] > distance[best])) best = r.id
    }
    seeds.push(best)
  }
  const owner = new Int32Array(regions.length).fill(-1)
  const costs = new Float64Array(regions.length).fill(Infinity)
  const queue = new MinHeap()
  const seed = (id: number, index: number) => {
    owner[id] = index
    costs[id] = 0
    queue.push(id, 0)
  }
  seeds.forEach(seed)
  const grow = () => {
    while (queue.size) {
      const { id, cost } = queue.pop()
      if (cost !== costs[id]) continue
      const a = cells[regions[id].center]
      for (const next of regions[id].neighbors) {
        const b = cells[regions[next].center]
        const step =
          Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) *
          (1 +
            Math.abs(a.elevation - b.elevation) * 4 +
            (a.terrain === 'mountains' || b.terrain === 'mountains' ? 2 : 0))
        if (cost + step >= costs[next]) continue
        costs[next] = cost + step
        owner[next] = owner[id]
        queue.push(next, costs[next])
      }
    }
  }
  grow()
  for (const r of regions) {
    if (owner[r.id] >= 0) continue
    seed(r.id, seeds.length)
    seeds.push(r.id)
    grow()
  }
  return { seeds: seeds.map((id) => regions[id]), owner }
}
