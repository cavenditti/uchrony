import { appendInfluenceTree, type InfluenceInput } from '../../src/sim/influence-kernel'
import { adjacentCells, CELL_METERS } from '../../src/sim/grid'
/** Dense deterministic physical workload: no simulation RNG or city objects. */
export function influenceFixture(width = 8, height = 8, homesPerCell = 32, jobsPerCell = 16): InfluenceInput {
  const count = width * height,
    nodes: number[] = [],
    edges: number[] = [],
    costs: number[] = []
  const offsets = new Int32Array(count + 1),
    roots = new Int32Array(count),
    terrain = new Float64Array(count).fill(1)
  const targets = new Float64Array(count * homesPerCell * 4),
    batches: number[] = [0]
  for (let cell = 0; cell < count; cell++) {
    const x = (cell % width) * CELL_METERS,
      y = Math.floor(cell / width) * CELL_METERS
    roots[cell] = appendInfluenceTree(
      nodes,
      Array.from({ length: jobsPerCell }, (_, i) => ({
        x: x + 10 + ((i * 73) % 1000),
        y: y + 10 + ((i * 137) % 1000),
        jobs: 10 + (i % 13),
        services: i % 7,
      })),
    )
    offsets[cell] = edges.length
    for (const next of adjacentCells(cell, width, height))
      if (next >= 0) {
        edges.push(next)
        costs.push(
          Math.hypot((cell % width) - (next % width), Math.floor(cell / width) - Math.floor(next / width)) *
            CELL_METERS *
            0.015,
        )
      }
    for (let h = 0; h < homesPerCell; h++) {
      const id = cell * homesPerCell + h
      targets.set([x + 20 + ((h * 37) % 980), y + 20 + ((h * 61) % 980), cell, 0.7], id * 4)
      if ((h + 1) % 64 === 0 || h === homesPerCell - 1) batches.push(id + 1)
    }
  }
  offsets[count] = edges.length
  return {
    width,
    offsets,
    edges: Int32Array.from(edges),
    costs: Float64Array.from(costs),
    terrain,
    roots,
    nodes: Float64Array.from(nodes),
    targets,
    batches: Int32Array.from(batches),
    tolerance: 0.02,
  }
}
