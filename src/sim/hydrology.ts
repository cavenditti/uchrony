import { edgeNeighbors } from './hex'
import { MinHeap } from './heap'
import { fractal, hashSeed } from './random'
import { clamp, type Cell } from './types'

const PASSES = 24
const CHANNEL_RUNOFF = 24

/** Generation-time landscape evolution. Ocean cells stay fixed, while runoff repeatedly
 * finds the least-cost descending route through spatially varying rock resistance.
 * Stream-power incision feeds the resulting valleys back into the next routing pass.
 * This is a bounded synthetic erosion model, not a hydraulic/sediment simulation.
 */
export function erodeDrainage(cells: Cell[], width: number, height: number, seed: string, sea: number) {
  const count = cells.length,
    adjacent = new Int32Array(count * 6),
    distances = new Float64Array(count * 6),
    resistance = new Float64Array(count),
    surface = new Float64Array(count),
    filled = new Float64Array(count),
    cost = new Float64Array(count),
    flow = new Float64Array(count),
    previousFlow = new Float64Array(count),
    downstream = new Int32Array(count).fill(-1),
    visited = new Uint8Array(count)
  const land: number[] = [],
    outlets: number[] = []
  const noiseSeed = hashSeed(`${seed}:watersheds:1`)
  // Distances come from geographic positions; districts and administrative refinement
  // never participate. Normalize by one geographic sample's average spacing.
  let spacing = 0,
    edges = 0
  for (const c of cells) {
    const ns = edgeNeighbors(c.id, width, height)
    for (let side = 0; side < 6; side++) {
      const at = c.id * 6 + side,
        next = ns[side]
      adjacent[at] = next
      if (next >= 0) {
        distances[at] = Math.hypot(c.x - cells[next].x, c.y - cells[next].y)
        spacing += distances[at]
        edges++
      }
    }
    if (c.terrain !== 'water') land.push(c.id)
    else if (ns.some((id) => id >= 0 && cells[id].terrain !== 'water')) outlets.push(c.id)
  }
  if (land.length && !outlets.length) throw new Error('Drainage requires an ocean outlet')
  spacing = spacing / Math.max(1, edges) || 1
  for (let i = 0; i < distances.length; i++) distances[i] /= spacing
  for (const c of cells) {
    const x = c.x / spacing,
      y = c.y / spacing
    // Sub-grid geology breaks the directional bias of a smooth, regularly sampled
    // continental slope. The relief is real input to erosion, not decorative bends.
    resistance[c.id] =
      0.15 + 5 * fractal(x / 1.9, y / 1.9, noiseSeed) ** 3 + fractal(x / 8.3, y / 8.3, noiseSeed + 29) * 0.5
    surface[c.id] = c.elevation
    if (c.terrain !== 'water')
      surface[c.id] +=
        ((fractal(x / 5.7, y / 5.7, noiseSeed + 71) - 0.5) * 0.09 +
          (fractal(x / 1.8, y / 1.8, noiseSeed + 127) - 0.5) * 0.018) *
        clamp((c.elevation - sea) / 0.025)
  }

  for (let pass = 0; pass <= PASSES; pass++) {
    // Priority flood supplies a depression-free hydraulic surface only. Its visitation
    // parent is deliberately NOT the river route: that was the source of grid canals.
    filled.set(surface)
    visited.fill(0)
    const queue = new MinHeap()
    for (const id of outlets) {
      visited[id] = 1
      queue.push(id, surface[id])
    }
    while (queue.size) {
      const { id } = queue.pop()
      for (let side = 0; side < 6; side++) {
        const at = id * 6 + side,
          next = adjacent[at]
        if (next < 0 || visited[next] || cells[next].terrain === 'water') continue
        visited[next] = 1
        filled[next] = Math.max(surface[next], filled[id])
        queue.push(next, filled[next])
      }
    }
    cost.fill(Infinity)
    flow.fill(0)
    const routes = new MinHeap(),
      order: number[] = []
    for (const id of outlets) {
      cost[id] = 0
      routes.push(id, 0)
    }
    // Dijkstra searches from every outlet, allowing travel across filled flats.
    // Strictly positive edge resistance makes receivers precede their tributaries;
    // there are no cycles or neighbour-order gradients across a filled depression.
    while (routes.size) {
      const { id, cost: total } = routes.pop()
      if (total !== cost[id]) continue
      if (cells[id].terrain !== 'water') order.push(id)
      for (let side = 0; side < 6; side++) {
        const at = id * 6 + side,
          next = adjacent[at],
          distance = distances[at]
        if (next < 0 || cells[next].terrain === 'water' || filled[next] < filled[id]) continue
        const slope = (filled[next] - filled[id]) / distance
        const channel = 1 / (1 + Math.min(4, Math.sqrt(previousFlow[id]) * 0.32))
        const local =
          (distance * (resistance[id] + resistance[next]) * channel) / (1 + Math.min(4, slope * 250))
        const candidate = total + local
        if (candidate < cost[next]) {
          cost[next] = candidate
          downstream[next] = id
          routes.push(next, candidate)
        }
      }
    }
    for (const id of order) flow[id] = 0.4 + cells[id].moisture
    for (let i = order.length - 1; i >= 0; i--) {
      const id = order[i]
      flow[downstream[id]] += flow[id]
    }
    if (pass === PASSES) {
      // Resolve residual flats only AFTER routing, along the chosen channels.
      for (const id of order) filled[id] = Math.max(filled[id], filled[downstream[id]] + 1e-7)
      break
    }
    // Implicit stream-power update (n=1, m=1/2): stable even for large catchments.
    // Work from outlets upward so no incision can overtake its downstream bed.
    for (const id of order) {
      const next = downstream[id],
        distance = Math.hypot(cells[id].x - cells[next].x, cells[id].y - cells[next].y) / spacing,
        strength = (0.02 * Math.sqrt(flow[id])) / (resistance[id] * distance),
        bed = Math.max(sea, surface[next])
      surface[id] = Math.max(sea + 1e-6, (filled[id] + strength * bed) / (1 + strength))
    }
    previousFlow.set(flow)
  }
  for (const c of cells) {
    delete c.downstream
    c.riverFlow = flow[c.id]
    c.river = false
    if (c.terrain === 'water') continue
    c.elevation = filled[c.id]
    c.downstream = downstream[c.id]
    c.river = flow[c.id] >= CHANNEL_RUNOFF
  }
}
