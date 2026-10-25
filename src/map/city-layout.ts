import type { Settlement } from '../sim/spatial'
import type { World } from '../sim/types'
import { hashSeed } from '../sim/random'
import { reliefRandom } from './relief-field'
import { HEX } from '../sim/hex'
import { riverHalfWidth, riverPoint, type RiverCurve } from './rivers'

export type CityPoint = { x: number; z: number }
export type CityBuilding = CityPoint & {
  width: number
  depth: number
  height: number
  angle: number
  roof: 'gable' | 'hip' | 'flat'
  tone: number
}
export type CityDescription = {
  id: string
  cell: number
  key: string
  x: number
  z: number
  radius: number
  seed: number
  kind: Settlement['kind']
  capital: boolean
  style: number
}
export type CityLayout = {
  city: CityDescription
  pattern: 'market' | 'planned' | 'spine'
  buildings: CityBuilding[]
  streets: { points: CityPoint[]; width: number }[]
  bridges: { a: CityPoint; b: CityPoint; width: number }[]
  square: CityPoint[]
  trees: CityPoint[]
  gardens: (CityPoint & { width: number; depth: number; angle: number })[]
  landmark: 'belfry' | 'dome' | 'keep'
  plaza: CityPoint
  angle: number
}

/** Stable visual identities do not depend on district IDs or monthly population totals. */
export function describeCity(
  world: Pick<World, 'seed' | 'cells' | 'regions'>,
  site: Settlement,
): CityDescription {
  const cell = world.cells[site.cell],
    seed = hashSeed(`${world.seed}:townscape:1:${site.id}`)
  const style =
    cell.terrain === 'desert'
      ? 2
      : hashSeed(`${world.seed}:architecture:${world.regions[site.region]?.culture ?? 0}`) % 4
  const radius =
    (site.kind === 'city' ? 15 : site.kind === 'town' ? 10 : 5.5) * (0.92 + reliefRandom(seed) * 0.16)
  return {
    id: site.id,
    cell: site.cell,
    key: `${site.id}:${site.cell}:${site.kind}:${site.capital}:${style}`,
    x: cell.x,
    z: cell.y,
    radius,
    seed,
    kind: site.kind,
    capital: site.capital,
    style,
  }
}
const distanceTo = (p: CityPoint, a: CityPoint, b: CityPoint) => {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)))
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz)
}

/** Decorative town plans at cartographic scale, not a census of simulated buildings. */
export function cityLayout(
  world: Pick<World, 'cells' | 'width' | 'height'>,
  city: CityDescription,
  rivers: readonly RiverCurve[] = [],
): CityLayout {
  const random = (n: number) => reliefRandom(city.seed + n * 1013)
  const channels: { a: CityPoint; b: CityPoint; width: number }[] = []
  for (const river of rivers) {
    const bounds = [river.a, river.b, river.c, river.d]
    if (
      Math.min(...bounds.map((p) => p.x)) > city.x + city.radius + 8 ||
      Math.max(...bounds.map((p) => p.x)) < city.x - city.radius - 8 ||
      Math.min(...bounds.map((p) => p.y)) > city.z + city.radius + 8 ||
      Math.max(...bounds.map((p) => p.y)) < city.z - city.radius - 8
    )
      continue
    const length = bounds
      .slice(1)
      .reduce((sum, p, i) => sum + Math.hypot(p.x - bounds[i].x, p.y - bounds[i].y), 0)
    const steps = Math.min(160, Math.max(4, Math.ceil(length / 0.8)))
    for (let i = 0; i < steps; i++) {
      const a = riverPoint(river, i / steps),
        b = riverPoint(river, (i + 1) / steps)
      if (Math.hypot(a.x - city.x, a.y - city.z) > city.radius + 8) continue
      channels.push({
        a: { x: a.x, z: a.y },
        b: { x: b.x, z: b.y },
        width: riverHalfWidth(river, (i + 0.5) / steps),
      })
    }
  }
  if (!rivers.length) {
    const origin = world.cells[city.cell]
    for (let dr = -3; dr <= 3; dr++)
      for (let dq = -3; dq <= 3; dq++) {
        const q = origin.q + dq,
          r = origin.r + dr
        if (q < 0 || q >= world.width || r < 0 || r >= world.height) continue
        const c = world.cells[r * world.width + q],
          d = c.downstream === undefined ? undefined : world.cells[c.downstream]
        if (c.river && d)
          channels.push({
            a: { x: c.x, z: c.y },
            b: { x: d.x, z: d.y },
            width: Math.min(6, 0.35 + Math.sqrt(c.riverFlow ?? 24) * 0.13) / 2,
          })
      }
  }
  const isLand = (p: CityPoint) => {
    const row = Math.round(p.z / (HEX * 1.5))
    let closest = Infinity,
      land = false
    for (let r = row - 1; r <= row + 1; r++) {
      const col = Math.round(p.x / (Math.sqrt(3) * HEX) - (r % 2) / 2)
      for (let q = col - 1; q <= col + 1; q++) {
        if (q < 0 || q >= world.width || r < 0 || r >= world.height) continue
        const c = world.cells[r * world.width + q],
          distance = (c.x - p.x) ** 2 + (c.y - p.z) ** 2
        if (distance < closest) {
          closest = distance
          land = c.terrain !== 'water'
        }
      }
    }
    return land
  }
  const dry = (p: CityPoint, setback = 1) =>
    isLand(p) && channels.every(({ a, b, width }) => distanceTo(p, a, b) > width + setback)
  const pattern = (['market', 'planned', 'spine'] as const)[Math.floor(random(71) * 3) % 3]
  let angle = random(1) * Math.PI * 2
  if (pattern === 'spine' && channels.length) {
    const nearest = [...channels].sort((a, b) => distanceTo(city, a.a, a.b) - distanceTo(city, b.a, b.b))[0]
    angle = Math.atan2(nearest.b.z - nearest.a.z, nearest.b.x - nearest.a.x)
  }
  const cosine = Math.cos(angle),
    sine = Math.sin(angle),
    r = city.radius
  const point = (u: number, v: number): CityPoint => ({
    x: city.x + u * cosine - v * sine,
    z: city.z + u * sine + v * cosine,
  })
  const local = (p: CityPoint) => ({
    u: (p.x - city.x) * cosine + (p.z - city.z) * sine,
    v: -(p.x - city.x) * sine + (p.z - city.z) * cosine,
  })
  const inside = (p: CityPoint) => {
    const { u, v } = local(p)
    if (pattern === 'planned') return Math.abs(u) < r * 0.86 && Math.abs(v) < r * 0.78
    if (pattern === 'spine') return (u / r) ** 2 + (v / (r * 0.64)) ** 2 < 1
    const a = Math.atan2(v, u)
    return (
      Math.hypot(u, v) <
      r *
        (0.76 +
          0.16 * Math.sin(a * (2 + Math.floor(random(4) * 3)) + random(5) * 6) +
          0.07 * Math.cos(a * 3 + random(6) * 5))
    )
  }
  const buildings: CityBuilding[] = [],
    streets: CityLayout['streets'] = [],
    bridges: CityLayout['bridges'] = [],
    trees: CityPoint[] = []
  const plazaSize = Math.min(3.1, r * 0.25)
  let plaza = point(0, 0),
    square: CityPoint[] = []
  const candidates: CityPoint[] = []
  for (let row = -2; row <= 2; row++)
    for (let col = -2; col <= 2; col++) candidates.push(point(col * 2.8, row * 2.8))
  candidates.sort((a, b) => Math.hypot(a.x - city.x, a.z - city.z) - Math.hypot(b.x - city.x, b.z - city.z))
  for (const p of candidates) {
    const { u, v } = local(p)
    const candidate = [
      point(u - plazaSize, v - plazaSize),
      point(u + plazaSize, v - plazaSize),
      point(u + plazaSize, v + plazaSize),
      point(u - plazaSize, v + plazaSize),
    ]
    if (candidate.every((c) => inside(c) && dry(c, 0.6)) && dry(p, plazaSize)) {
      plaza = p
      square = candidate
      break
    }
  }
  const raw: CityLayout['streets'] = []
  if (pattern === 'planned') {
    for (let i = -3; i <= 3; i++) {
      raw.push({ points: [point(-r, i * 4.3), point(r, i * 4.3)], width: i === 0 ? 1.15 : 0.52 })
      raw.push({ points: [point(i * 4.3, -r), point(i * 4.3, r)], width: i === 0 ? 1.15 : 0.52 })
    }
  } else if (pattern === 'market') {
    const center = local(plaza),
      arms = 3 + Math.floor(random(11) * 4),
      phase = random(12) * Math.PI * 2
    const bearings = Array.from(
      { length: arms },
      (_, i) => phase + (i * Math.PI * 2) / arms + (random(20 + i) - 0.5) * 0.45,
    )
    for (let i = 0; i < arms; i++) {
      const a = bearings[i],
        reach = r * (0.65 + random(30 + i) * 0.35)
      raw.push({
        points: [
          plaza,
          point(center.u + Math.cos(a + 0.15) * reach * 0.52, center.v + Math.sin(a + 0.15) * reach * 0.52),
          point(center.u + Math.cos(a) * reach, center.v + Math.sin(a) * reach),
        ],
        width: i === 0 ? 1.05 : 0.62,
      })
    }
    // Partial neighborhood lanes have different centers, extents, and connections.
    // They never stamp two complete concentric rings onto every settlement.
    const districts = 1 + Math.floor(random(21) * 3)
    for (let d = 0; d < districts; d++) {
      const start = bearings[d % arms],
        span = Math.PI * (0.65 + random(50 + d) * 0.75),
        radius = r * (0.4 + d * 0.15)
      const cx = center.u + (random(61 + d) - 0.5) * r * 0.3,
        cy = center.v + (random(66 + d) - 0.5) * r * 0.3
      const points = Array.from({ length: 23 }, (_, i) => {
        const a = start + (span * i) / 22,
          rr = radius * (1 + 0.15 * Math.sin(a * 2 + random(19 + d) * 5))
        return point(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
      })
      raw.push({ points, width: 0.44 })
    }
  } else {
    for (const v of [-r * 0.3, 0, r * 0.3])
      raw.push({
        points: [point(-r, v - 0.8), point(0, v + 0.4), point(r, v - 0.4)],
        width: v === 0 ? 1.25 : 0.6,
      })
    for (let i = -2; i <= 2; i++)
      raw.push({
        points: [point(i * 4.8, -r * 0.7), point(i * 4.8 + 0.5, 0), point(i * 4.8 - 1, r * 0.7)],
        width: i === 0 ? 0.9 : 0.5,
      })
  }
  // Sample and clip streets; only major streets bridge a short river interval.
  for (const road of raw) {
    const samples: CityPoint[] = []
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1],
        b = road.points[i],
        steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5))
      for (let j = 0; j < steps; j++)
        samples.push({ x: a.x + ((b.x - a.x) * j) / steps, z: a.z + ((b.z - a.z) * j) / steps })
    }
    samples.push(road.points.at(-1)!)
    let run: CityPoint[] = [],
      gapStart: CityPoint | undefined,
      gapLand = true
    for (const p of samples) {
      const valid = inside(p) && dry(p, 0.65)
      if (valid) {
        if (gapStart && gapLand && road.width >= 0.9 && bridges.length < 2) {
          const length = Math.hypot(p.x - gapStart.x, p.z - gapStart.z)
          if (
            length > 1 &&
            length < 12 &&
            bridges.every((b) => Math.hypot(b.a.x - gapStart!.x, b.a.z - gapStart!.z) > 6)
          )
            bridges.push({ a: gapStart, b: p, width: road.width })
        }
        gapStart = undefined
        run.push(p)
      } else {
        if (run.length > 1) streets.push({ points: run, width: road.width })
        if (run.length) {
          gapStart = run.at(-1)
          gapLand = true
        }
        gapLand = gapLand && isLand(p) && inside(p)
        run = []
      }
    }
    if (run.length > 1) streets.push({ points: run, width: road.width })
  }
  // Continuous paths along both banks make the water a deliberate public edge.
  for (const channel of channels) {
    const { a, b, width } = channel,
      len = Math.hypot(b.x - a.x, b.z - a.z) || 1
    for (const side of [-1, 1]) {
      const dx = (-(b.z - a.z) / len) * (width + 0.65) * side,
        dz = ((b.x - a.x) / len) * (width + 0.65) * side
      const pa = { x: a.x + dx, z: a.z + dz },
        pb = { x: b.x + dx, z: b.z + dz }
      if (inside(pa) && inside(pb) && isLand(pa) && isLand(pb))
        streets.push({ points: [pa, pb], width: 0.42 })
    }
  }
  const roadClear = (p: CityPoint, width: number, depth: number, angle: number) =>
    raw.every((road) =>
      road.points.slice(1).every((b, i) => {
        const a = road.points[i],
          length = Math.hypot(b.x - a.x, b.z - a.z) || 1,
          nx = -(b.z - a.z) / length,
          nz = (b.x - a.x) / length
        const support =
          (Math.abs(nx * Math.cos(angle) - nz * Math.sin(angle)) * width +
            Math.abs(nx * Math.sin(angle) + nz * Math.cos(angle)) * depth) /
          2
        return distanceTo(p, a, b) > support + road.width / 2 + 0.1
      }),
    )
  const lots: { p: CityPoint; a: number; key: number }[] = []
  for (let roadIndex = 0; roadIndex < raw.length; roadIndex++) {
    const road = raw[roadIndex]
    for (let segment = 1; segment < road.points.length; segment++) {
      const a = road.points[segment - 1],
        b = road.points[segment],
        length = Math.hypot(b.x - a.x, b.z - a.z)
      const dx = (b.x - a.x) / length,
        dz = (b.z - a.z) / length,
        step = 1.25 + random(101 + roadIndex) * 0.2
      for (let d = step * 0.5; d < length; d += step)
        for (const side of [-1, 1])
          for (let row = 0; row < 2; row++) {
            const offset = (road.width / 2 + 0.78 + row * 1.35) * side
            lots.push({
              p: { x: a.x + dx * d - dz * offset, z: a.z + dz * d + dx * offset },
              a: -Math.atan2(dz, dx),
              key: 1000 + roadIndex * 241 + segment * 71 + Math.floor(d * 10) * 11 + side * 3 + row,
            })
          }
    }
  }
  if (pattern === 'market') {
    for (let ring = 0, rr = plazaSize + 1.3; rr < r; rr += 1.9, ring++) {
      const count = Math.floor((Math.PI * 2 * rr) / 1.65)
      for (let i = 0; i < count; i++) {
        const a = (i * Math.PI * 2) / count + ring * 0.14
        lots.push({
          p: { x: plaza.x + Math.cos(a) * rr, z: plaza.z + Math.sin(a) * rr },
          a: -a - Math.PI / 2,
          key: 30 + ring * 300 + i * 7,
        })
      }
    }
  } else if (pattern === 'planned') {
    for (let row = -4; row <= 3; row++)
      for (let col = -4; col <= 3; col++)
        for (let j = 0; j < 4; j++)
          lots.push({
            p: point((col + (j % 2 ? 0.75 : 0.25)) * 4.3, (row + (j > 1 ? 0.75 : 0.25)) * 4.3),
            a: -angle,
            key: 40 + (row + 4) * 173 + (col + 4) * 19 + j * 5,
          })
  } else {
    for (let row = -9; row <= 9; row++)
      for (let col = -9; col <= 9; col++)
        lots.push({
          p: point(col * 1.65 + 0.7, row * 1.65 + 0.7),
          a: -angle,
          key: 40 + (row + 9) * 151 + (col + 9) * 7,
        })
  }
  const overlaps = (p: CityPoint, width: number, depth: number, angle: number, b: CityBuilding) => {
    for (const a of [angle, angle + Math.PI / 2, b.angle, b.angle + Math.PI / 2]) {
      const nx = Math.cos(a),
        nz = -Math.sin(a)
      const extent = (w: number, d: number, r: number) =>
        (Math.abs(nx * Math.cos(r) - nz * Math.sin(r)) * w +
          Math.abs(nx * Math.sin(r) + nz * Math.cos(r)) * d) /
        2
      if (
        Math.abs((b.x - p.x) * nx + (b.z - p.z) * nz) >
        extent(width, depth, angle) + extent(b.width, b.depth, b.angle) + 0.08
      )
        return false
    }
    return true
  }
  for (const { p, a, key } of lots) {
    if (buildings.length >= 350) break
    if (!inside(p) || !dry(p, 1.4) || Math.hypot(p.x - plaza.x, p.z - plaza.z) < plazaSize + 1.2) continue
    const edge = Math.hypot(p.x - city.x, p.z - city.z) / r
    if (random(key) < Math.max(0.04, (edge - 0.65) * 0.6)) {
      if (dry(p, 2)) trees.push(p)
      continue
    }
    const workshop = pattern === 'spine' && Math.abs(local(p).v) > r * 0.25
    const width = workshop ? 1.5 : 0.7 + random(key + 1) * 0.48,
      depth = workshop ? 1.12 : 0.85 + random(key + 2) * 0.5
    const radius = Math.hypot(width, depth) / 2
    if (!roadClear(p, width, depth, a) || buildings.some((b) => overlaps(p, width, depth, a, b))) continue
    if (
      ![
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ].every(([x, z]) => dry({ x: p.x + x * radius * 0.72, z: p.z + z * radius * 0.72 }, 1))
    )
      continue
    buildings.push({
      ...p,
      width,
      depth,
      height: (workshop ? 0.8 : 0.65 + random(key + 3) * 1.1) + (edge < 0.5 ? 0.5 : 0),
      angle: a,
      roof: workshop ? 'gable' : city.style === 2 ? 'flat' : random(key + 4) < 0.35 ? 'hip' : 'gable',
      tone: random(key + 4),
    })
  }
  const gardens: CityLayout['gardens'] = []
  for (let i = 0; i < 32 && gardens.length < 12; i++) {
    const a = i * 2.39996 + random(801) * 6,
      distance = r * (0.8 + random(802 + i) * 0.3),
      p = point(Math.cos(a) * distance, Math.sin(a) * distance),
      width = 1.2 + random(850 + i) * 0.9,
      depth = 1.6 + random(890 + i) * 1.0,
      radius = Math.hypot(width, depth) / 2
    if (!dry(p, radius + 1) || !roadClear(p, width, depth, -angle)) continue
    if (buildings.some((b) => overlaps(p, width, depth, -angle, b))) continue
    if (Math.hypot(p.x - plaza.x, p.z - plaza.z) < plazaSize + radius + 1) continue
    if (
      ![-1, 1].every((x) =>
        [-1, 1].every((z) =>
          dry(point(Math.cos(a) * distance + (x * width) / 2, Math.sin(a) * distance + (z * depth) / 2), 0.5),
        ),
      )
    )
      continue
    if (
      gardens.some((g) => Math.hypot(g.x - p.x, g.z - p.z) < radius + Math.hypot(g.width, g.depth) / 2 + 0.3)
    )
      continue
    gardens.push({ ...p, width, depth, angle: -angle })
  }
  return {
    city,
    pattern,
    buildings,
    streets,
    bridges,
    square,
    trees,
    gardens,
    plaza,
    angle: -angle,
    landmark: (['belfry', 'dome', 'keep'] as const)[Math.floor(random(9) * 3) % 3],
  }
}
