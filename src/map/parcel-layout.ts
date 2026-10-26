import type { CityBuilding, CityDescription, CityLayout, CityPoint } from './city-layout'
import { reliefRandom } from './relief-field'
import { urbanEnvelope } from './urban-form'

/** One street frame per connected city, with blocks clipped to its developed
 * support. Parcel boundaries constrain ownership, never prescribe a town plan. */
export function parcelLayout(
  city: CityDescription,
  dry: (p: CityPoint, setback?: number) => boolean,
): CityLayout {
  const f = city.form!,
    scale = f.metersPerMapUnit,
    p = f.parcel,
    angle = f.angle ?? 0,
    cosine = Math.cos(angle),
    sine = Math.sin(angle),
    seed = f.planSeed ?? city.seed,
    industry = f.district === 'industrial' || f.district === 'mining',
    sparse = f.district === 'gardens',
    block = industry ? 110 : sparse ? 95 : 80,
    lane = industry ? 12 : 9
  const random = (key: number) => reliefRandom(seed + key * 1013)
  // A gentle shared street bend avoids independently rotated stamps per parcel.
  const bend = (u: number) => 12 * Math.sin(u / 240 + (seed % 11))
  const point = (u: number, v: number): CityPoint => ({
    x: (f.center.x + u * cosine - (v + bend(u)) * sine) / scale,
    z: (f.center.y + u * sine + (v + bend(u)) * cosine) / scale,
  })
  const local = (x: number, y: number) => ({
    u: (x - f.center.x) * cosine + (y - f.center.y) * sine,
    v: -(x - f.center.x) * sine + (y - f.center.y) * cosine,
  })
  const corners = [
    [p.x, p.y],
    [p.x + p.size, p.y],
    [p.x, p.y + p.size],
    [p.x + p.size, p.y + p.size],
  ].map(([x, y]) => local(x, y))
  const minU = Math.floor(Math.min(...corners.map((c) => c.u)) / block) - 1,
    maxU = Math.ceil(Math.max(...corners.map((c) => c.u)) / block) + 1,
    minV = Math.floor(Math.min(...corners.map((c) => c.v)) / block) - 1,
    maxV = Math.ceil(Math.max(...corners.map((c) => c.v)) / block) + 1
  const inside = (a: CityPoint) =>
    a.x * scale >= p.x &&
    a.x * scale <= p.x + p.size &&
    a.z * scale >= p.y &&
    a.z * scale <= p.y + p.size &&
    urbanEnvelope(f, a.x * scale, a.z * scale)
  const buildings: CityBuilding[] = [],
    streets: CityLayout['streets'] = [],
    trees: CityPoint[] = [],
    gardens: CityLayout['gardens'] = []
  const add = (
    u: number,
    v: number,
    width: number,
    depth: number,
    key: number,
    workshop = false,
    rotation = 0,
  ) => {
    if (buildings.length >= 256) return
    const a = point(u, v),
      bearing = -(angle + Math.atan(0.05 * Math.cos(u / 240 + (seed % 11)))) + rotation,
      w = width / scale,
      d = depth / scale
    const safe = [-1, 1].every((x) =>
      [-1, 1].every((z) => {
        const corner = {
          x: a.x + (x * w * Math.cos(bearing) + z * d * Math.sin(bearing)) / 2,
          z: a.z + (-x * w * Math.sin(bearing) + z * d * Math.cos(bearing)) / 2,
        }
        return inside(corner) && dry(corner, 2 / scale)
      }),
    )
    if (!safe) return
    buildings.push({
      ...a,
      width: w,
      depth: d,
      height: 0,
      angle: bearing,
      tone: random(key),
      use: workshop ? 'workshop' : 'housing',
      roof: workshop ? 'gable' : sparse ? 'hip' : random(key + 1) < 0.35 ? 'gable' : 'flat',
    })
  }
  for (let row = minV; row <= maxV; row++)
    for (let col = minU; col <= maxU; col++) {
      const u = (col + 0.5) * block,
        v = (row + 0.5) * block,
        key = row * 7919 + col * 131
      if (industry) {
        add(u - 12, v - 15, 62, 30, key, true)
        add(u - 24, v + 27, 22, 16, key + 3)
        add(u + 16, v + 27, 26, 16, key + 7)
      } else if (sparse || Math.hypot(u, v) > p.size * 0.39) {
        add(u - 18, v - 14, 18 + random(key) * 10, 14 + random(key + 2) * 6, key)
        if (random(key + 4) > 0.35) add(u + 20, v + 18, 20, 16, key + 5)
        const tree = point(u + 25, v - 20)
        if (inside(tree) && dry(tree, 5 / scale)) trees.push(tree)
        const garden = point(u - 19, v + 17)
        if (gardens.length < 12 && inside(garden) && dry(garden, 15 / scale))
          gardens.push({ ...garden, width: 22 / scale, depth: 16 / scale, angle: -angle })
      } else if (f.district !== 'center' || Math.hypot(u, v) > p.size * 0.26) {
        // Residential streets between the central perimeter blocks and gardens.
        add(u - 18, v - 19, 27 + random(key) * 7, 16, key)
        add(u + 19, v - 18, 23, 18, key + 4)
        if (random(key + 8) > 0.2) add(u - 16, v + 19, 31, 16, key + 9)
        const tree = point(u + 22, v + 20)
        if (inside(tree) && dry(tree, 5 / scale)) trees.push(tree)
      } else {
        // Several buildings form a block around a real open courtyard. Unequal
        // frontages and occasional open sides distinguish blocks from house arrays.
        add(u - 8, v - 25, 38 + random(key) * 13, 12 + random(key + 2) * 5, key)
        add(u + 25, v + 5, 38 + random(key + 3) * 12, 13, key + 4, false, Math.PI / 2)
        if (random(key + 8) > 0.18) add(u - 9, v + 25, 34 + random(key + 9) * 15, 13, key + 10)
        if (random(key + 12) > 0.45) add(u - 25, v - 1, 28, 12, key + 13, false, Math.PI / 2)
        const tree = point(u, v)
        if (inside(tree) && dry(tree, 4 / scale)) trees.push(tree)
      }
    }
  // A tiny or awkward parcel must still represent its funded housing if a dry
  // location exists. This is a single building, not a whole default town stamp.
  if (!buildings.some((b) => b.use === 'housing')) {
    const c = local(p.x + p.size / 2, p.y + p.size / 2)
    for (const [dx, dy] of [
      [0, 0],
      [12, 0],
      [-12, 0],
      [0, 12],
      [0, -12],
    ]) {
      add(c.u + dx, c.v - bend(c.u) + dy, Math.min(20, p.size * 0.2), Math.min(16, p.size * 0.16), 314)
      if (buildings.some((b) => b.use === 'housing')) break
    }
  }
  const housing = buildings.filter((b) => b.use === 'housing'),
    ground = housing.reduce((sum, b) => sum + b.width * b.depth * scale * scale, 0)
  const shrink = Math.min(1, Math.sqrt((f.coverage * p.size * p.size) / Math.max(1e-12, ground)))
  for (const b of housing) {
    b.width *= shrink
    b.depth *= shrink
  }
  const weight = (b: CityBuilding) =>
    (0.5 +
      2.5 *
        Math.exp(
          -Math.hypot(b.x * scale - f.center.x, b.z * scale - f.center.y) / Math.max(150, p.size * 0.3),
        )) *
    (0.8 + b.tone * 0.4)
  const weightedArea = housing.reduce((sum, b) => sum + b.width * b.depth * scale * scale * weight(b), 0)
  for (const b of buildings) {
    b.storeys =
      b.use === 'workshop' ? 1 : ((city.capacity ?? 0) * 40 * weight(b)) / Math.max(1e-12, weightedArea)
    b.height = ((b.use === 'workshop' ? 6 : 3 * b.storeys) / scale) * 2
    if (b.use === 'housing') b.representedCapacity = (b.width * b.depth * scale * scale * b.storeys) / 40
  }
  for (const vertical of [false, true])
    for (let i = vertical ? minU : minV; i <= (vertical ? maxU : maxV); i++) {
      let run: CityPoint[] = []
      const from = (vertical ? minV : minU) * block,
        to = (vertical ? maxV : maxU) * block
      for (let j = from; j <= to; j += 10) {
        const a = point(vertical ? i * block : j, vertical ? j : i * block)
        if (inside(a) && dry(a, lane / (2 * scale))) run.push(a)
        else {
          if (run.length > 1) streets.push({ points: run, width: lane / scale })
          run = []
        }
      }
      if (run.length > 1) streets.push({ points: run, width: lane / scale })
    }
  return {
    city,
    buildings,
    streets,
    trees,
    gardens,
    square: [],
    bridges: [],
    plaza: { x: city.x, z: city.z },
    angle: -angle,
    landmark: 'belfry',
    pattern: industry ? 'spine' : f.district === 'center' ? 'market' : 'planned',
  }
}
