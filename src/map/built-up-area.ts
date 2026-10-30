/**
 * Cartographic texture for coarse housing records in the 2D atlas.
 *
 * A coarse record knows how many residents live in developed fabric and the
 * square support they occupy, not where each house stands. Filling that square
 * flat hid both its density and its continuity with neighbouring records, so a
 * village, a market town and a city core all read as the same tile. This
 * module draws a representative texture instead:
 *
 * - each record has an irregular rounded envelope with its square's area, and
 *   neighbouring envelopes merge into one built-up area that the records tile
 *   without gaps or double fill;
 * - intensity is a smooth field across records, so a town is dense throughout
 *   and thins only at its outer edge; street blocks shrink and fill up with it,
 *   from rows of houses among gardens to tight perimeter blocks;
 * - the street grid's orientation is shared within a 4 km neighbourhood, so a
 *   town's records read as one plan, with small per-record deviations.
 *
 * Everything is a deterministic function of the records' ids, supports and
 * intensities: panning and zoom never move a block, and the simulation never
 * reads any of it back. Surveyed buildings keep their exact footprints.
 */
import type { PointMeters, SpatialBounds } from '../sim/adaptive-types'
import { hashSeed } from '../sim/random'

/** A coarse record's drawn support and its developed intensity in [0, 1]. */
export interface FabricRecord {
  support: SpatialBounds
  intensity: number
}
/** One drawn roof: a whole perimeter block or a row of houses, in metres. */
export interface FabricLot {
  x: number
  y: number
  width: number
  depth: number
  angle: number
  /** Palette index in [0, FABRIC_TONES). */
  tone: number
}

export const FABRIC_TONES = 5
/** Envelope scale R / side. The support exp(−(r/R)⁴) crosses ½ at r = (ln 2)^¼ R,
 * so R = 0.62 side gives an isolated record a mean outline radius of 0.565 side:
 * a disc with the square's area, √(1/π) ≈ 0.564. */
const ENVELOPE = 0.62
/** Beyond 1.6 R a support is below e^(−6.5) ≈ 0.0015: it can neither carry the
 * merged area over ½ nor own a point inside it, so it is skipped. */
const REACH = 1.6
const OUTLINE_VERTICES = 40
/** Neighbourhood sharing one street orientation, in metres. */
const PLAN_NEIGHBOURHOOD = 4096

/** Stable unit random from a string key. */
const unit = (key: string) => hashSeed(key) / 0x1_0000_0000

/** Integer hash of a seed and three small integers (lowbias32 finaliser), as a
 * unit random. Lots draw several values each, so string hashing would dominate. */
function mix(seed: number, i: number, j: number, k: number) {
  let h = (seed ^ Math.imul(i + 0x9e37, 0x85ebca6b) ^ Math.imul(j + 0x7f4a, 0xc2b2ae35) ^ (k << 24)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  return ((h ^ (h >>> 16)) >>> 0) / 0x1_0000_0000
}

/** Envelope of one support, R(θ) = R (1 + 0.09 sin(3θ + a) + 0.05 cos(5θ + b)).
 * Phases are keyed by the support's position, so every record computes the same
 * shape for a shared neighbour; their sines and cosines are stored so that the
 * harmonics need only the direction's components (Chebyshev expansions), not
 * atan2 and trigonometry per evaluation. */
interface Envelope {
  x: number
  y: number
  scale: number
  intensity: number
  cosA: number
  sinA: number
  cosB: number
  sinB: number
}
function envelope({ support: p, intensity }: FabricRecord): Envelope {
  const phase = hashSeed(`${Math.round(p.x)}:${Math.round(p.y)}:${Math.round(p.size)}`),
    a = ((phase & 0xffff) / 0xffff) * 2 * Math.PI,
    b = ((phase >>> 16) / 0xffff) * 2 * Math.PI
  return {
    x: p.x + p.size / 2,
    y: p.y + p.size / 2,
    scale: p.size * ENVELOPE,
    intensity: Math.max(0, Math.min(1, intensity)),
    cosA: Math.cos(a),
    sinA: Math.sin(a),
    cosB: Math.cos(b),
    sinB: Math.sin(b),
  }
}

/** Support exp(−(r/R(θ))⁴) of one envelope at a point. */
function support(e: Envelope, x: number, y: number) {
  const dx = x - e.x,
    dy = y - e.y,
    r2 = dx * dx + dy * dy
  if (r2 > (REACH * 1.14 * e.scale) ** 2) return 0
  if (r2 === 0) return 1
  const r = Math.sqrt(r2),
    c = dx / r,
    s = dy / r,
    c2 = c * c,
    s2 = s * s
  // sin 3θ, cos 3θ, sin 5θ, cos 5θ from cos θ and sin θ.
  const sin3 = s * (3 - 4 * s2),
    cos3 = c * (4 * c2 - 3),
    sin5 = s * (16 * s2 * s2 - 20 * s2 + 5),
    cos5 = c * (16 * c2 * c2 - 20 * c2 + 5)
  const radius =
    e.scale * (1 + 0.09 * (sin3 * e.cosA + cos3 * e.sinA) + 0.05 * (cos5 * e.cosB - sin5 * e.sinB))
  const q = r2 / (radius * radius)
  return Math.exp(-q * q)
}

/**
 * A record among its neighbours. A point belongs to the built-up area when the
 * summed support of all envelopes reaches ½, so overlapping records fill the
 * gap between them, and to this record when its own support is the largest.
 * Neighbouring shares therefore tile one continuous area: a block in an
 * overlap is drawn exactly once.
 */
export class FabricShare {
  private readonly own: Envelope
  private readonly others: Envelope[]
  private readonly seed: number

  constructor(id: string, record: FabricRecord, neighbours: readonly FabricRecord[] = []) {
    this.own = envelope(record)
    this.others = neighbours.map(envelope)
    this.seed = hashSeed(`fabric:${id}`)
  }

  /** Street pitch in metres: dense cores have short blocks, edges long ones. */
  get pitch() {
    return 150 - 80 * this.own.intensity
  }

  /** Local intensity at a point of this share, or −1 outside it: the
   * support-weighted mean of the records' intensities, eased to zero at the
   * merged boundary. A town is dense throughout and thins only at its outer
   * edge, rather than every record having its own core and rim. */
  intensity(x: number, y: number) {
    const own = this.own,
      mine = support(own, x, y)
    let total = mine,
      weighted = mine * own.intensity
    for (const other of this.others) {
      const s = support(other, x, y)
      if (s > mine) return -1
      total += s
      weighted += s * other.intensity
    }
    return total < 0.5 ? -1 : (weighted / total) * Math.min(1, Math.sqrt((total - 0.5) / 0.6))
  }

  /** Boundary of the share, star-shaped about the record's centre. Each ray is
   * walked in sixths of R to the first point outside, then bisected to 1/96 R:
   * a few evaluations per ray instead of a fine march. */
  outline(): PointMeters[] {
    const { x: cx, y: cy, scale } = this.own,
      step = scale / 6,
      limit = scale * REACH
    return Array.from({ length: OUTLINE_VERTICES }, (_, i) => {
      const theta = (i / OUTLINE_VERTICES) * 2 * Math.PI,
        dx = Math.cos(theta),
        dy = Math.sin(theta)
      const inside = (r: number) => this.intensity(cx + r * dx, cy + r * dy) >= 0
      let low = 0
      while (low + step <= limit && inside(low + step)) low += step
      let high = Math.min(limit, low + step)
      for (let k = 0; k < 4; k++) {
        const middle = (low + high) / 2
        if (inside(middle)) low = middle
        else high = middle
      }
      return { x: cx + high * dx, y: cy + high * dy }
    })
  }

  /** Roofs of the share on a street grid. The open share of each block becomes
   * gardens, yards and squares; loose blocks are rows of houses along one
   * frontage, and along the opposite one too as intensity rises. */
  lots(): FabricLot[] {
    const { x: cx, y: cy, scale, intensity: t } = this.own,
      pitch = this.pitch,
      block = pitch - (16 - 7 * t),
      seed = this.seed
    const quarter = `${Math.floor(cx / PLAN_NEIGHBOURHOOD)}:${Math.floor(cy / PLAN_NEIGHBOURHOOD)}`,
      angle = unit(`plan:${quarter}`) * (Math.PI / 2) + (mix(seed, 0, 0, 255) - 0.5) * 0.24,
      cos = Math.cos(angle),
      sin = Math.sin(angle)
    const limit = scale * REACH,
      span = Math.ceil(limit / pitch),
      lots: FabricLot[] = []
    const place = (u: number, v: number, width: number, depth: number, lean: number, tone: number) =>
      lots.push({ x: cx + u * cos - v * sin, y: cy + u * sin + v * cos, width, depth, angle: lean, tone })
    for (let i = -span; i < span; i++)
      for (let j = -span; j < span; j++) {
        const random = (k: number) => mix(seed, i, j, k)
        const u = (i + 0.5 + (random(0) - 0.5) * 0.16) * pitch,
          v = (j + 0.5 + (random(1) - 0.5) * 0.16) * pitch
        if (u * u + v * v > limit * limit) continue
        const intensity = this.intensity(cx + u * cos - v * sin, cy + u * sin + v * cos)
        if (intensity < 0 || random(2) > 0.35 + 0.7 * intensity) continue
        const tone = Math.floor(random(3) * FABRIC_TONES),
          lean = angle + (random(4) - 0.5) * 0.06
        if (intensity > 0.55) {
          const side = block * (0.9 + 0.1 * random(5))
          place(u, v, side, side * (0.85 + 0.15 * random(6)), lean, tone)
          continue
        }
        const depth = block * (0.22 + 0.4 * intensity),
          offset = (block - depth) / 2,
          side = random(5) < 0.5 ? 1 : -1
        place(u, v + side * offset, block * (0.75 + 0.25 * random(6)), depth, lean, tone)
        if (random(7) < intensity + 0.2)
          place(u, v - side * offset, block * (0.6 + 0.4 * random(8)), depth, lean, (tone + 2) % FABRIC_TONES)
      }
    return lots
  }
}

/** Corners of a lot, for drawing and containment tests. */
export function lotCorners(lot: FabricLot): PointMeters[] {
  const cos = Math.cos(lot.angle),
    sin = Math.sin(lot.angle)
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, b]) => ({
    x: lot.x + ((a * lot.width) / 2) * cos - ((b * lot.depth) / 2) * sin,
    y: lot.y + ((a * lot.width) / 2) * sin + ((b * lot.depth) / 2) * cos,
  }))
}
