/**
 * Settlement fields: one continuous description of developed land, read at two scales.
 *
 * Towns and countryside are not different kinds of land. Every residential
 * support contributes the residents it houses in developed fabric to a smooth
 * field. Urban living conditions, agglomeration pull and the emergent
 * administrative places (`places.ts`) are all read from these fields; no place
 * record ever feeds back into them.
 *
 * Two scales, one construction:
 * - `FABRIC` (32 m nodes, 160 m kernel) is the neighbourhood a household sees.
 *   It sets *urbanity*, the share of urban living conditions.
 * - `AGGLOMERATION` (256 m nodes, 2,048 m kernel) is a market's reach. It sets
 *   which centres are prominent enough to be places and how strongly they pull
 *   households. At this scale a lattice of similar coarse records one terrain
 *   sample apart merges into one smooth plateau with a single summit, so evenly
 *   spread growth can never produce a grid of identical named towns.
 *
 * Geometry. Fields are sampled on canonical quadtree nodes below a terrain
 * sample: aligned squares addressed exactly like the adaptive mesh but
 * independent of the active leaves. Each terrain sample with mass owns one
 * dense tile, keyed by the stable sample ID. Both spans divide the 1,024 m
 * sample, so every node lies in one sample, one province and one sovereign.
 *
 * Kernel. A support (a parcel square, or a node for point-like buildings) is
 * convolved with a separable biweight of half-width `bandwidth`. The product
 * kernel shares the quadtree's square geometry, and box ⊗ kernel has a closed
 * form through the biweight CDF, so large coarse parcels need no sub-sampling.
 * Each 1D weight vector is normalized to sum to one, which makes the field
 * conserve developed residents exactly: Σ density · node area equals the
 * developed census, whatever the mesh or observer resolution.
 */
import type { World } from './types'
import type { PhysicalSite, SpatialBounds } from './adaptive-types'
import { CELL_METERS } from './grid'
import { MODEL_PARAMETERS } from './model-parameters'
import { SETTLEMENT } from './settlement-model'
import { openingFabricPosition } from './opening-settlements'
import {
  developedResidents,
  occupiedResidents,
  openingHousingCapacity,
  openingSupport,
  residentialSites,
} from './residential-sites'

export interface FieldScale {
  /** Node side in metres; divides the 1,024 m terrain sample. */
  readonly span: number
  /** Biweight half-width in metres. */
  readonly bandwidth: number
}
/** Neighbourhood scale: about a two-minute walk. */
export const FABRIC: FieldScale = { span: 32, bandwidth: 160 }
/** Market scale: two terrain samples, roughly a 25-minute walk. */
export const AGGLOMERATION: FieldScale = { span: 256, bandwidth: 2048 }
export const SAMPLE_KM2 = (CELL_METERS / 1000) ** 2

/** A residential support as the fields see it. Adaptive worlds use their
 * physical sites; legacy cell economies are projected onto the equivalent
 * opening records, so conversion cannot change a place's identity. */
export interface FieldSource {
  id: string
  cell: number
  pool: number
  x: number
  y: number
  /** Square physical support of the developed residents, in metres. */
  support: SpatialBounds
  /** Occupants of the record. */
  people: number
  /** Occupants housed in developed fabric (≤ people). */
  developed: number
}

export interface SettlementField {
  readonly scale: FieldScale
  /** Nodes per tile side (one tile per terrain sample). */
  readonly tile: number
  /** Canonical node grid dimensions. */
  readonly columns: number
  readonly rows: number
  readonly width: number
  /** Developed residents per km², one dense tile per terrain sample with mass. */
  readonly tiles: ReadonlyMap<number, Float64Array>
  /** Smoothed developed residents falling inside each terrain sample. */
  readonly sampleMass: Float64Array
  /** Total developed residents deposited (conservation reference). */
  readonly developed: number
  /** km² per unit density at which `reach` equals residents: a point mass reads its own size. */
  readonly reachArea: number
}

/** Biweight CDF on [-1, 1]: ∫ (15/16)(1 − t²)² dt from −1 to u. */
function biweightCdf(u: number) {
  if (u <= -1) return 0
  if (u >= 1) return 1
  const u2 = u * u
  return 0.5 + (15 / 16) * u * (1 - (2 * u2) / 3 + (u2 * u2) / 5)
}

/** Normalized 1D weights of the box [a, b] ⊗ biweight at node centres from
 * node `first`. The common 1/(b − a) factor cancels on normalization, and
 * normalizing after clipping to the world keeps edge deposits conservative. */
function boxWeights(scale: FieldScale, a: number, b: number, limit: number) {
  const { span, bandwidth } = scale
  const first = Math.max(0, Math.floor((a - bandwidth) / span))
  const last = Math.min(limit - 1, Math.floor((b + bandwidth) / span))
  const weights = new Float64Array(Math.max(0, last - first + 1))
  let total = 0
  for (let i = first; i <= last; i++) {
    const c = (i + 0.5) * span
    total += weights[i - first] = biweightCdf((c - a) / bandwidth) - biweightCdf((c - b) / bandwidth)
  }
  for (let i = 0; i < weights.length; i++) weights[i] /= total
  return { first, weights }
}

/** Point-like supports are pooled into their node, which is then deposited
 * with a translation-invariant stencil, precomputed once per scale. */
interface Stencil {
  radius: number
  weights: Float64Array
}
function nodeStencil({ span, bandwidth }: FieldScale): Stencil {
  const radius = Math.ceil(bandwidth / span),
    weights = new Float64Array(2 * radius + 1)
  let total = 0
  for (let k = -radius; k <= radius; k++)
    total += weights[k + radius] =
      biweightCdf((k * span + span / 2) / bandwidth) - biweightCdf((k * span - span / 2) / bandwidth)
  for (let k = 0; k < weights.length; k++) weights[k] /= total
  return { radius, weights }
}
const STENCILS = new Map<FieldScale, Stencil>([FABRIC, AGGLOMERATION].map((s) => [s, nodeStencil(s)]))

/** Residential supports for the fields. Vacant records are included so that a
 * place's territory covers its empty buildings, but they deposit no mass. */
export function fieldSources(w: World): FieldSource[] {
  if (w.adaptive?.residentialVersion === 1)
    return residentialSites(w).flatMap((site) => {
      const people = occupiedResidents(w, site)
      if (!(people > 0 || site.capacity > 0)) return []
      return [siteSource(w, site, people)]
    })
  const local = w.localEconomy
  if (!local) return []
  const sources: FieldSource[] = []
  for (const id of local.active) {
    const unit = local.units[id]
    for (const cell of unit.cells) {
      const people = unit.residents[cell] ?? 0,
        built = local.built[cell] ?? 0
      if (!(people > 0)) continue
      const { parcel, ...p } = openingSupport(
        w,
        cell,
        openingFabricPosition(w, cell, (c) => local.built[c] ?? 0),
        openingHousingCapacity(people, built),
      )
      sources.push({
        id: `home:${cell}`,
        cell,
        pool: id,
        ...p,
        support: parcel,
        people,
        developed: Math.min(people, built * MODEL_PARAMETERS.fullBuiltPopulationPerCell),
      })
    }
  }
  return sources.sort((a, b) => a.cell - b.cell)
}

function siteSource(w: World, site: PhysicalSite, people: number): FieldSource {
  return {
    id: site.id,
    cell: site.cell,
    pool: site.pool,
    x: site.x,
    y: site.y,
    support: site.parcel ?? {
      x: site.x - FABRIC.span / 2,
      y: site.y - FABRIC.span / 2,
      size: FABRIC.span,
    },
    people,
    developed: developedResidents(w, site),
  }
}

/** Deposit every source's developed residents at one scale. Cost is
 * O(sources × support nodes); point-like supports are pooled per node first,
 * so a dense town costs one stencil per occupied node rather than one per house. */
export function buildSettlementField(
  w: Pick<World, 'width' | 'height' | 'cells'>,
  sources: readonly FieldSource[],
  scale: FieldScale = FABRIC,
): SettlementField {
  const { span } = scale,
    tile = CELL_METERS / span,
    nodesPerTile = tile * tile,
    nodeKm2 = (span / 1000) ** 2
  const columns = w.width * tile,
    rows = w.height * tile
  const tiles = new Map<number, Float64Array>(),
    sampleMass = new Float64Array(w.cells.length)
  let developed = 0
  const deposit = (fx: number, wx: Float64Array, fy: number, wy: Float64Array, mass: number) => {
    for (let j = 0; j < wy.length; j++) {
      const ny = fy + j,
        row = Math.floor(ny / tile) * w.width,
        local = (ny % tile) * tile,
        rowMass = mass * wy[j]
      let i = 0
      // Walk each row in tile-sized runs so the tile lookup is hoisted out of the inner loop.
      while (i < wx.length) {
        const tx = Math.floor((fx + i) / tile),
          cell = row + tx,
          end = Math.min(wx.length, (tx + 1) * tile - fx)
        let target = tiles.get(cell)
        if (!target) tiles.set(cell, (target = new Float64Array(nodesPerTile)))
        let deposited = 0
        for (; i < end; i++) {
          const share = rowMass * wx[i]
          target[local + ((fx + i) % tile)] += share / nodeKm2
          deposited += share
        }
        sampleMass[cell] += deposited
      }
    }
  }
  const pooled = new Map<number, number>()
  for (const source of sources) {
    if (!(source.developed > 0)) continue
    developed += source.developed
    const s = source.support
    if (s.size <= span) {
      const node =
        Math.min(rows - 1, Math.floor(source.y / span)) * columns +
        Math.min(columns - 1, Math.floor(source.x / span))
      pooled.set(node, (pooled.get(node) ?? 0) + source.developed)
      continue
    }
    const x = boxWeights(scale, s.x, s.x + s.size, columns),
      y = boxWeights(scale, s.y, s.y + s.size, rows)
    deposit(x.first, x.weights, y.first, y.weights, source.developed)
  }
  const { radius, weights } = STENCILS.get(scale) ?? nodeStencil(scale)
  for (const [node, mass] of [...pooled].sort((a, b) => a[0] - b[0])) {
    const nx = node % columns,
      ny = Math.floor(node / columns)
    // Interior nodes reuse the stencil; nodes near the world edge renormalize their clipped kernel.
    if (nx >= radius && ny >= radius && nx + radius < columns && ny + radius < rows)
      deposit(nx - radius, weights, ny - radius, weights, mass)
    else {
      const x = boxWeights(scale, nx * span, (nx + 1) * span, columns),
        y = boxWeights(scale, ny * span, (ny + 1) * span, rows)
      deposit(x.first, x.weights, y.first, y.weights, mass)
    }
  }
  const centre = weights[radius]
  return {
    scale,
    tile,
    columns,
    rows,
    width: w.width,
    tiles,
    sampleMass,
    developed,
    reachArea: nodeKm2 / (centre * centre),
  }
}

/** Field density at a canonical node, or 0 outside the field's support. */
export function nodeDensity(field: SettlementField, nx: number, ny: number) {
  if (nx < 0 || ny < 0 || nx >= field.columns || ny >= field.rows) return 0
  const t = field.tile,
    tile = field.tiles.get(Math.floor(ny / t) * field.width + Math.floor(nx / t))
  return tile ? tile[(ny % t) * t + (nx % t)] : 0
}

/** Field density at a metre position, bilinear between node centres. Sampling
 * is continuous and mirror-symmetric, so a point on a node boundary reads the
 * mean of both sides instead of snapping to one. */
export function fieldDensity(field: SettlementField, x: number, y: number) {
  const fx = x / field.scale.span - 0.5,
    fy = y / field.scale.span - 0.5
  const nx = Math.floor(fx),
    ny = Math.floor(fy),
    tx = fx - nx,
    ty = fy - ny
  return (
    (1 - ty) * ((1 - tx) * nodeDensity(field, nx, ny) + tx * nodeDensity(field, nx + 1, ny)) +
    ty * ((1 - tx) * nodeDensity(field, nx, ny + 1) + tx * nodeDensity(field, nx + 1, ny + 1))
  )
}

/** Developed residents within reach of a point, distance-weighted by the
 * kernel: a single isolated building of n residents reads n at its own node. */
export const fieldReach = (field: SettlementField, x: number, y: number) =>
  fieldDensity(field, x, y) * field.reachArea

/** Share of urban living conditions at a developed density: a logistic in
 * log-density, ρ² / (ρ² + ρ½²). With the default half-density of 1,500/km²
 * (the Degree of Urbanisation's urban-centre density) it is about 4% at
 * 300/km² and above 90% beyond 5,000/km². */
export function urbanity(density: number) {
  const half = SETTLEMENT.urbanDensity
  return density > 0 ? (density * density) / (density * density + half * half) : 0
}

/** Mean urbanity over a support's nodes; a point-like support uses its own node. */
function supportUrbanity(field: SettlementField, source: FieldSource) {
  const s = source.support,
    { span } = field.scale
  if (s.size <= span) return urbanity(fieldDensity(field, source.x, source.y))
  const x0 = Math.floor(s.x / span),
    y0 = Math.floor(s.y / span)
  const x1 = Math.max(x0, Math.ceil((s.x + s.size) / span) - 1),
    y1 = Math.max(y0, Math.ceil((s.y + s.size) / span) - 1)
  let total = 0
  for (let ny = y0; ny <= y1; ny++)
    for (let nx = x0; nx <= x1; nx++) total += urbanity(nodeDensity(field, nx, ny))
  return total / ((x1 - x0 + 1) * (y1 - y0 + 1))
}

/** Mean urbanity of a support's occupants on the fabric field. Developed
 * residents live at the density of their own fabric; dispersed residents share
 * their terrain sample's mean developed density, so a farm household beside a
 * town is partly urban and one in open country is not. */
export function sourceUrbanity(fabric: SettlementField, source: FieldSource) {
  if (!(source.people > 0)) return 0
  const dispersed = urbanity(fabric.sampleMass[source.cell] / SAMPLE_KM2)
  if (!(source.developed > 0)) return dispersed
  return (
    (source.developed * supportUrbanity(fabric, source) + (source.people - source.developed) * dispersed) /
    source.people
  )
}
