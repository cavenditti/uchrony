/**
 * Topology of the agglomeration field: urban areas and their density modes.
 *
 * The superlevel set {reach ≥ placeReach} on habitable land is partitioned into
 * connected *urban areas*: land within market reach of enough developed
 * residents. Inside an area, each local maximum of the field is a *mode*.
 * Processing nodes from densest to sparsest with a union–find (persistence-based
 * clustering, as in ToMATo) yields the full merge tree in one O(n log n) pass:
 * when two growing basins first touch at density s, the one with the lower peak
 * records `saddle = s` and the other as its `parent`. A mode's prominence,
 * (peak − saddle) / peak, is a scale-free measure of how distinct a centre is
 * from the land joining it to a larger one: separate market towns stay
 * prominent, while ripples over evenly settled land, or a bump on a city's
 * flank, do not.
 *
 * Connectivity uses the eight node neighbours, restricted to one sovereign
 * (field nodes never straddle a terrain sample, so each has one nation).
 * A diagonal step needs an orthogonal neighbour inside the domain, so an area
 * cannot leak through the corner where water or a ridge meets land.
 */
import type { World } from './types'
import { habitableLand } from './terrain-access'
import { parameterGroup } from './configuration-context'
import {
  AGGLOMERATION,
  FABRIC,
  buildSettlementField,
  fieldReach,
  fieldSources,
  sourceUrbanity,
  type FieldSource,
  type SettlementField,
} from './settlement-field'

/** Shared by the topology floor and the place rules in `places.ts`. */
export const PLACE_TOPOLOGY = parameterGroup('placeTopology')

export interface FieldMode {
  /** Canonical node index (row-major) of the peak. */
  node: number
  /** Developed residents per km² at the peak. */
  peak: number
  /** Density at which this mode's basin joins a higher one; 0 for an area summit. */
  saddle: number
  /** Index of the higher mode it joins, or −1. Always smaller than this mode's index. */
  parent: number
  /** Urban area containing the mode. */
  area: number
}

export interface SettlementTopology {
  /** Modes in strictly descending peak order (ties by node index). */
  readonly modes: readonly FieldMode[]
  /** Summit mode of each urban area. */
  readonly summits: readonly number[]
  /** Gradient-ascent mode of a canonical node, or −1 outside every urban area. */
  modeAt(node: number): number
}

/** Fields, topology and per-source attribution computed once per refresh. */
export interface SettlementStructure {
  readonly sources: readonly FieldSource[]
  /** Neighbourhood field: urbanity of living conditions. */
  readonly fabric: SettlementField
  /** Market field: place topology and agglomeration pull. */
  readonly agglomeration: SettlementField
  readonly topology: SettlementTopology
  /** Raw ascent mode of each source's own node (−1: open country). */
  readonly sourceMode: Int32Array
  /** Mean urbanity of each source's occupants. */
  readonly sourceUrbanity: Float64Array
  /** Developed residents within market reach of each source. */
  readonly sourceReach: Float64Array
}

export const prominence = (mode: FieldMode) => (mode.peak - mode.saddle) / mode.peak

const OFFSETS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
] as const

export function settlementTopology(
  w: Pick<World, 'cells' | 'regions'>,
  field: SettlementField,
  minimumReach: number = PLACE_TOPOLOGY.placeReach,
): SettlementTopology {
  const minimumDensity = minimumReach / field.reachArea
  const { columns, rows, tile: side } = field
  // Dense per-tile index of domain nodes keeps neighbour lookup O(1) without a global hash.
  const index = new Map<number, Int32Array>()
  const nodes: number[] = [],
    density: number[] = [],
    nations: number[] = []
  for (const [cell, tile] of [...field.tiles].sort((a, b) => a[0] - b[0])) {
    if (!habitableLand(w.cells[cell])) continue
    const nation = w.regions[w.cells[cell].region]?.nation ?? -1
    const tx = cell % field.width,
      ty = Math.floor(cell / field.width)
    let local: Int32Array | undefined
    for (let k = 0; k < tile.length; k++) {
      if (!(tile[k] >= minimumDensity)) continue
      if (!local) index.set(cell, (local = new Int32Array(tile.length).fill(-1)))
      local[k] = nodes.length
      nodes.push((ty * side + Math.floor(k / side)) * columns + tx * side + (k % side))
      density.push(tile[k])
      nations.push(nation)
    }
  }
  const lookup = (nx: number, ny: number) => {
    if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) return -1
    const local = index.get(Math.floor(ny / side) * field.width + Math.floor(nx / side))
    return local ? local[(ny % side) * side + (nx % side)] : -1
  }
  const n = nodes.length
  const order = new Uint32Array(n)
    .map((_, i) => i)
    .sort((a, b) => density[b] - density[a] || nodes[a] - nodes[b])
  const ascent = new Int32Array(n).fill(-1),
    rank = new Int32Array(n).fill(-1),
    parent = new Int32Array(n),
    top = new Int32Array(n)
  const find = (i: number) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]]
    return i
  }
  const modes: FieldMode[] = []
  const linked = new Int32Array(8)
  for (let position = 0; position < n; position++) {
    const i = order[position],
      nx = nodes[i] % columns,
      ny = Math.floor(nodes[i] / columns)
    rank[i] = position
    parent[i] = i
    let best = -1,
      count = 0
    for (let k = 0; k < OFFSETS.length; k++) {
      const [dx, dy] = OFFSETS[k]
      const j = lookup(nx + dx, ny + dy)
      if (j < 0 || rank[j] < 0 || nations[j] !== nations[i]) continue
      if (dx && dy) {
        const a = lookup(nx + dx, ny),
          b = lookup(nx, ny + dy)
        if (!((a >= 0 && nations[a] === nations[i]) || (b >= 0 && nations[b] === nations[i]))) continue
      }
      if (best < 0 || rank[j] < rank[best]) best = j
      linked[count++] = find(j)
    }
    if (best < 0) {
      top[i] = ascent[i] = modes.length
      modes.push({ node: nodes[i], peak: density[i], saddle: 0, parent: -1, area: -1 })
      continue
    }
    ascent[i] = ascent[best]
    // Modes are created in processing order, so the smaller top-mode index is
    // always the higher peak (ties already broken by node index).
    let winner = linked[0]
    for (let k = 1; k < count; k++) if (top[linked[k]] < top[winner]) winner = linked[k]
    for (let k = 0; k < count; k++) {
      const root = find(linked[k])
      if (root === winner) continue
      const absorbed = modes[top[root]]
      absorbed.saddle = density[i]
      absorbed.parent = top[winner]
      parent[root] = winner
    }
    parent[i] = winner
  }
  // Parents precede children, so one forward pass labels every area.
  const summits: number[] = []
  modes.forEach((mode, m) => {
    if (mode.parent < 0) {
      mode.area = summits.length
      summits.push(m)
    } else mode.area = modes[mode.parent].area
  })
  return {
    modes,
    summits,
    modeAt(node: number) {
      const i = lookup(node % columns, Math.floor(node / columns))
      return i < 0 ? -1 : ascent[i]
    },
  }
}

/** Canonical node containing a metre position. */
export const fieldNode = (field: SettlementField, x: number, y: number) =>
  Math.min(field.rows - 1, Math.max(0, Math.floor(y / field.scale.span))) * field.columns +
  Math.min(field.columns - 1, Math.max(0, Math.floor(x / field.scale.span)))

/** Build the complete settlement structure of the current physical census.
 * Pure: it reads sites and cells and writes nothing. */
export function settlementStructure(w: World): SettlementStructure {
  const sources = fieldSources(w)
  const fabric = buildSettlementField(w, sources, FABRIC),
    agglomeration = buildSettlementField(w, sources, AGGLOMERATION)
  const topology = settlementTopology(w, agglomeration)
  const sourceMode = new Int32Array(sources.length),
    urban = new Float64Array(sources.length),
    reach = new Float64Array(sources.length)
  sources.forEach((source, i) => {
    sourceMode[i] = topology.modeAt(fieldNode(agglomeration, source.x, source.y))
    urban[i] = sourceUrbanity(fabric, source)
    reach[i] = fieldReach(agglomeration, source.x, source.y)
  })
  return { sources, fabric, agglomeration, topology, sourceMode, sourceUrbanity: urban, sourceReach: reach }
}

/** Urbanity-weighted occupants per terrain sample: the continuous successor of
 * a binary "settled residents" census. */
export function urbanResidentsByCell(structure: SettlementStructure) {
  const result = new Map<number, number>()
  structure.sources.forEach((source, i) => {
    const urban = source.people * structure.sourceUrbanity[i]
    if (urban > 0) result.set(source.cell, (result.get(source.cell) ?? 0) + urban)
  })
  return result
}
