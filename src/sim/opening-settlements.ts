/**
 * Opening settlement geography: where a generated world's urban residents live
 * before anyone has moved.
 *
 * Generation decides how many urban residents each settlement has and on which
 * terrain sample its nucleus lies. Placing all of them on that one 1,024 m
 * sample made every town the same capped square at the sample centre, however
 * large it was. Instead a nucleus is anchored at an off-centre point of its
 * sample and its residents follow Clark's negative-exponential density law
 *
 *   ρ(r) = ρ₀ · e^(−r/b),   N = ∫ ρ dA = 2π ρ₀ b²,
 *
 * whose core density rises weakly with size, ρ₀ = ρ_ref · (N / 10⁴)^δ, because
 * larger cities build denser cores. The gradient length b = √(N / 2πρ₀) then
 * grows a little slower than √N: a village is a compact nucleus inside one
 * sample, a city spreads over many samples with a dense core and thinning
 * edges, and neighbouring nuclei merge into continuous conurbations.
 *
 * The same anchors fix where each coarse housing record's fabric sits inside its
 * sample (`openingFabricPosition`), so neither the settlement field nor the map
 * starts from a lattice of centred squares.
 */
import { adjacentCells, CELL_SIZE } from './grid'
import { hashSeed } from './random'
import { apportion } from './allocation'
import { METERS_PER_MAP_UNIT } from './physical-space'
import { SETTLEMENT } from './settlement-model'
import { MODEL_PARAMETERS } from './model-parameters'
import type { PointMeters } from './adaptive-types'
import type { World } from './types'

type Geography = Pick<World, 'seed' | 'cells' | 'width' | 'height'> & Partial<Pick<World, 'adaptive'>>

/** Largest anchor offset from the sample centre, as a fraction of a sample:
 * far enough to break the lattice, near enough that a nucleus never sits on the
 * sample's edge where its coastline may already be water. */
const ANCHOR_REACH = 0.36
/** Lean of a record towards built neighbours, as a fraction of a sample. */
const FABRIC_LEAN = 0.4
/** Density profiles are cut at four gradient lengths, where ~9% of an untruncated
 * profile remains; the cut mass is renormalised onto the samples that are kept. */
const PROFILE_REACH = 4
/** Midpoint-rule resolution per sample axis (128 m at 1,024 m samples). */
const QUADRATURE = 8
/** Unit offsets of `adjacentCells`, clockwise from north. */
const ADJACENT = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
].map(([q, r]) => [q / Math.hypot(q, r), r / Math.hypot(q, r)] as const)

/** Offset of a sample's settlement anchor from its centre, in samples per axis.
 * Deterministic in seed and sample. Coastal samples lean towards the shore,
 * where harbours and waterfronts form, before a hashed jitter breaks symmetry. */
export function settlementAnchor(w: Geography, cell: number) {
  const hash = hashSeed(`${w.seed}:settlement-anchor:${cell}`),
    jitter = (bits: number) => ((bits & 0xffff) / 0xffff - 0.5) * 2 * 0.28
  let dq = jitter(hash),
    dr = jitter(hash >>> 16)
  adjacentCells(cell, w.width, w.height).forEach((next, i) => {
    // Face neighbours only: a diagonal water sample does not make a waterfront.
    if (i % 2 || next < 0 || w.cells[next].terrain !== 'water') return
    dq += ADJACENT[i][0] * 0.18
    dr += ADJACENT[i][1] * 0.18
  })
  const clampReach = (v: number) => Math.max(-ANCHOR_REACH, Math.min(ANCHOR_REACH, v))
  return { dq: clampReach(dq), dr: clampReach(dr) }
}

/** Clark profile of a settlement: core density (residents / km²) and gradient
 * length (metres). At the default calibration a 1,000-resident village has
 * b ≈ 0.15 km, a 10,000-resident town 0.36 km and a 300,000-resident city 1.3 km. */
export function clarkProfile(people: number) {
  const core = SETTLEMENT.openingCoreDensity * (people / 10_000) ** SETTLEMENT.openingDensityElasticity
  return { core, gradient: Math.sqrt(people / (2 * Math.PI * core)) * 1000 }
}

/**
 * Integer residents of one nucleus on each eligible sample. A sample's weight
 * is its integrated density (midpoint rule), so the shares follow the density
 * law at any grid resolution; largest-remainder apportionment keeps the total
 * exact. When no eligible sample lies within reach, everyone stays on the
 * nucleus sample, which is always eligible by contract.
 *
 * Urban residents live in compact fabric, so the profile is cut where a
 * sample's share would leave its built cover below the compact threshold
 * (`entryBuiltCover` of `fullBuiltPopulationPerCell`, 1,440 residents by
 * default). Such a fringe would hold urban residents in no fabric at all, and a
 * frontier survey would lay them out as dozens of farmsteads that do not fit.
 * The cut residents join the samples that stay compact; their exact shares only
 * grow when others are dropped, so one pass suffices. A settlement too small to
 * be compact anywhere stays whole on its nucleus sample.
 */
export function spreadSettlement(
  w: Geography,
  nucleus: number,
  people: number,
  eligible: (cell: number) => boolean,
): Map<number, number> {
  const width = w.width,
    q0 = nucleus % width,
    r0 = Math.floor(nucleus / width),
    anchor = settlementAnchor(w, nucleus),
    aq = q0 + 0.5 + anchor.dq,
    ar = r0 + 0.5 + anchor.dr
  // Work in sample units: b is the gradient length per 1,024 m sample.
  const b = clarkProfile(Math.max(1, people)).gradient / (CELL_SIZE * METERS_PER_MAP_UNIT),
    reach = PROFILE_REACH * b
  const cells: number[] = [],
    weights: number[] = []
  for (let r = Math.max(0, Math.floor(ar - reach)); r <= Math.min(w.height - 1, Math.floor(ar + reach)); r++)
    for (let q = Math.max(0, Math.floor(aq - reach)); q <= Math.min(width - 1, Math.floor(aq + reach)); q++) {
      const cell = r * width + q
      // Nearest point of the sample to the anchor decides whether it is in reach.
      const nearest = Math.hypot(Math.max(q - aq, 0, aq - q - 1), Math.max(r - ar, 0, ar - r - 1))
      if (nearest > reach || !eligible(cell)) continue
      let mass = 0
      for (let i = 0; i < QUADRATURE; i++)
        for (let j = 0; j < QUADRATURE; j++)
          mass += Math.exp(-Math.hypot(q + (i + 0.5) / QUADRATURE - aq, r + (j + 0.5) / QUADRATURE - ar) / b)
      cells.push(cell)
      weights.push(mass)
    }
  const total = weights.reduce((sum, mass) => sum + mass, 0),
    floor = SETTLEMENT.entryBuiltCover * MODEL_PARAMETERS.fullBuiltPopulationPerCell,
    kept = weights.flatMap((mass, i) => ((people * mass) / total >= floor ? [i] : []))
  if (!kept.length) return new Map([[nucleus, Math.floor(people)]])
  const shares = apportion(
    people,
    kept.map((i) => weights[i]),
  )
  return new Map(kept.map((i, k) => [cells[i], shares[k]]))
}

/**
 * Where a coarse housing record's fabric sits inside its sample, in metres: at
 * the sample's anchor, leaning towards developed neighbours. The lean is the
 * built-cover-weighted mean direction to the eight neighbours, normalised by
 * the neighbourhood's total cover, so the ring of a spread city faces its core
 * and adjacent records read as one fabric. A nucleus with an even ring stays at
 * its anchor. The result is always strictly inside the sample.
 */
export function openingFabricPosition(
  w: Geography,
  cell: number,
  built: (cell: number) => number,
): PointMeters {
  const anchor = settlementAnchor(w, cell)
  let lq = 0,
    lr = 0,
    total = built(cell)
  adjacentCells(cell, w.width, w.height).forEach((next, i) => {
    const cover = next < 0 ? 0 : built(next)
    lq += cover * ADJACENT[i][0]
    lr += cover * ADJACENT[i][1]
    total += cover
  })
  const lean = total > 0 ? FABRIC_LEAN / total : 0,
    limit = 0.45,
    dq = Math.max(-limit, Math.min(limit, anchor.dq + lq * lean)),
    dr = Math.max(-limit, Math.min(limit, anchor.dr + lr * lean))
  const c = w.cells[cell],
    scale = w.adaptive?.metersPerMapUnit ?? METERS_PER_MAP_UNIT
  return { x: (c.x + dq * CELL_SIZE) * scale, y: (c.y + dr * CELL_SIZE) * scale }
}
