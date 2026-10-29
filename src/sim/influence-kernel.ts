import { MinHeap } from './heap'
import { CELL_METERS } from './grid'

/** Immutable numeric snapshot. No city IDs, accounts, cohorts or random state cross threads. */
export interface InfluenceInput {
  width: number
  offsets: Int32Array
  edges: Int32Array
  costs: Float64Array
  terrain: Float64Array
  roots: Int32Array
  /** Preorder source quadtrees: x, y, radius, jobs, services, subtree end. */
  nodes: Float64Array
  /** x, y, terrain cell, habitat. Sorted by cell, then stable site ID. */
  targets: Float64Array
  /** Target offsets; large urban cells are divided into independent bounded batches. */
  batches: Int32Array
  tolerance: number
}
export interface InfluenceSource {
  x: number
  y: number
  jobs: number
  services: number
}
import { SOURCE_STRIDE } from './simulation-invariants'
export { SOURCE_STRIDE } from './simulation-invariants'
import { TARGET_STRIDE } from './simulation-invariants'
export { TARGET_STRIDE } from './simulation-invariants'
import { WALK_MINUTES_PER_METER as WALK } from './simulation-invariants'
import { INFLUENCE_RADIUS } from './simulation-invariants'
export { INFLUENCE_RADIUS } from './simulation-invariants'
import { INFLUENCE_MINUTES } from './simulation-invariants'
export { INFLUENCE_MINUTES } from './simulation-invariants'

/** Exact coincident-source aggregation; bounded-error tree reduction for separated sources.
 * The tree is independent of numerical mesh depth and never aggregates across terrain cells. */
export function appendInfluenceTree(nodes: number[], sources: InfluenceSource[]): number {
  const start = nodes.length / SOURCE_STRIDE
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    jobs = 0,
    services = 0
  for (const s of sources) {
    minX = Math.min(minX, s.x)
    maxX = Math.max(maxX, s.x)
    minY = Math.min(minY, s.y)
    maxY = Math.max(maxY, s.y)
    jobs += s.jobs
    services += s.services
  }
  const x = (minX + maxX) / 2,
    y = (minY + maxY) / 2
  nodes.push(x, y, Math.hypot(maxX - minX, maxY - minY) / 2, jobs, services, 0)
  if (maxX > minX || maxY > minY) {
    const groups: InfluenceSource[][] = [[], [], [], []]
    for (const s of sources) groups[Number(s.x > x) + 2 * Number(s.y > y)].push(s)
    // Floating-point positions can be adjacent representable numbers. Avoid a non-shrinking tree.
    if (groups.some((g) => g.length === sources.length)) {
      for (const s of sources) nodes.push(s.x, s.y, 0, s.jobs, s.services, nodes.length / SOURCE_STRIDE + 1)
    } else for (const group of groups) if (group.length) appendInfluenceTree(nodes, group)
  }
  nodes[start * SOURCE_STRIDE + 5] = nodes.length / SOURCE_STRIDE
  return start
}

/** Reverse shortest paths give source-to-home access even when terrain costs are directed. */
function reachable(input: InfluenceInput, origin: number) {
  const distances = new Map([[origin, 0]]),
    heap = new MinHeap()
  heap.push(origin, 0)
  while (heap.size) {
    const at = heap.pop()
    if (at.cost !== distances.get(at.id)) continue
    for (let i = input.offsets[at.id]; i < input.offsets[at.id + 1]; i++) {
      const next = input.edges[i],
        cost = at.cost + input.costs[i]
      if (cost <= INFLUENCE_MINUTES && cost < (distances.get(next) ?? Infinity)) {
        distances.set(next, cost)
        heap.push(next, cost)
      }
    }
  }
  // A congested road must not hide a directly walkable adjacent source cell.
  for (let i = input.offsets[origin]; i < input.offsets[origin + 1]; i++)
    if (!distances.has(input.edges[i])) distances.set(input.edges[i], Infinity)
  return [...distances].filter(([cell]) => input.roots[cell] >= 0).sort((a, b) => a[0] - b[0])
}
const center = (cell: number, width: number) => ({
  x: ((cell % width) + 0.5) * CELL_METERS,
  y: (Math.floor(cell / width) + 0.5) * CELL_METERS,
})

/** One batch writes disjoint output slots. Thread count/order cannot change a reduction. */
export function solveInfluenceBatch(input: InfluenceInput, output: Float64Array, batch: number) {
  const begin = input.batches[batch],
    end = input.batches[batch + 1]
  if (begin === end) return
  const origin = input.targets[begin * TARGET_STRIDE + 2],
    homeCenter = center(origin, input.width)
  const sources = reachable(input, origin)
  const adjacent = new Set<number>()
  for (let i = input.offsets[origin]; i < input.offsets[origin + 1]; i++) adjacent.add(input.edges[i])
  for (let h = begin; h < end; h++) {
    const offset = h * TARGET_STRIDE,
      x = input.targets[offset],
      y = input.targets[offset + 1]
    const access = Math.hypot(x - homeCenter.x, y - homeCenter.y) * WALK
    let jobs = 0,
      services = 0
    for (const [cell, network] of sources) {
      const c = center(cell, input.width),
        root = input.roots[cell]
      const stop = input.nodes[root * SOURCE_STRIDE + 5]
      const direct = cell === origin || adjacent.has(cell)
      const rate = WALK * Math.max(input.terrain[cell], input.terrain[origin])
      for (let n = root; n < stop;) {
        const p = n * SOURCE_STRIDE,
          sx = input.nodes[p],
          sy = input.nodes[p + 1]
        const radius = input.nodes[p + 2],
          distance = Math.hypot(sx - x, sy - y)
        const viaNetwork = network + access + Math.hypot(sx - c.x, sy - c.y) * WALK
        const minutes =
          cell === origin ? distance * rate : Math.min(viaNetwork, direct ? distance * rate : Infinity)
        const error = radius * (direct ? rate : WALK)
        const next = input.nodes[p + 5]
        if (distance - radius > INFLUENCE_RADIUS || minutes - error > INFLUENCE_MINUTES) {
          n = next
          continue
        }
        // No approximation across a hard cutoff. Relative error is <= exp(error/30)-1.
        const accept =
          radius === 0 ||
          (distance + radius <= INFLUENCE_RADIUS &&
            minutes + error <= INFLUENCE_MINUTES &&
            Math.expm1(error / 30) <= input.tolerance)
        if (!accept) {
          n++
          continue
        }
        const decay = Math.exp(-minutes / 30)
        jobs += input.nodes[p + 3] * decay
        services += input.nodes[p + 4] * decay
        n = next
      }
    }
    output[h * 2] = jobs
    output[h * 2 + 1] = services
  }
}
export function solveInfluence(input: InfluenceInput) {
  const output = new Float64Array((input.targets.length / TARGET_STRIDE) * 2)
  for (let batch = 0; batch < input.batches.length - 1; batch++) solveInfluenceBatch(input, output, batch)
  return output
}

export interface SharedInfluenceJob {
  input: InfluenceInput
  output: Float64Array
  control: Int32Array
}
/** Work stealing splits a dense cell across all available workers, without shared accumulation. */
export function runInfluenceJobs(job: SharedInfluenceJob) {
  try {
    for (;;) {
      if (Atomics.load(job.control, 2)) break
      const batch = Atomics.add(job.control, 0, 1)
      if (batch >= job.input.batches.length - 1) break
      solveInfluenceBatch(job.input, job.output, batch)
      Atomics.add(job.control, 3, 1)
      if (batch % 8 === 0) Atomics.notify(job.control, 1)
    }
  } catch {
    Atomics.store(job.control, 2, 1)
  } finally {
    Atomics.add(job.control, 1, 1)
    Atomics.notify(job.control, 1)
  }
}
