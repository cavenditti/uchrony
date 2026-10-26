import { reliefRandom } from './relief-field'
import type { CityBuilding, CityDescription, CityLayout, CityPoint } from './city-layout'

/** Reuse the atlas's varied market, planned and riverside plans at the actual
 * parcel location. Visible houses are a readable sample, never a vertical census. */
export function parcelLayout(
  city: CityDescription,
  dry: (p: CityPoint, setback?: number) => boolean,
  plan: (description: CityDescription) => CityLayout,
): CityLayout {
  const form = city.form!,
    scale = form.metersPerMapUnit,
    parcel = form.parcel
  const radius = Math.max(8, city.radius)
  const ratio = city.radius / radius
  const tradition = Math.floor(reliefRandom(city.seed + 7193) * 10)
  const template = plan({
    ...city,
    form: undefined,
    capacity: undefined,
    radius,
    streetPattern: tradition < 6 ? 'market' : tradition < 8 ? 'spine' : 'planned',
  })
  const project = (p: CityPoint) => ({
    x: city.x + (p.x - city.x) * ratio,
    z: city.z + (p.z - city.z) * ratio,
  })
  const inside = (p: CityPoint) =>
    p.x * scale >= parcel.x &&
    p.x * scale <= parcel.x + parcel.size &&
    p.z * scale >= parcel.y &&
    p.z * scale <= parcel.y + parcel.size &&
    dry(p, 2 / scale)
  const industry = form.district === 'industrial' || form.district === 'mining'
  const buildings: CityBuilding[] = template.buildings
    .map((b, index) => ({
      ...b,
      ...project(b),
      width: b.width * ratio,
      depth: b.depth * ratio,
      use: industry && index % 3 === 0 ? ('workshop' as const) : ('housing' as const),
    }))
    .filter((b) =>
      [-1, 1].every((x) =>
        [-1, 1].every((z) =>
          inside({
            x: b.x + (x * b.width * Math.cos(b.angle) + z * b.depth * Math.sin(b.angle)) / 2,
            z: b.z + (-x * b.width * Math.sin(b.angle) + z * b.depth * Math.cos(b.angle)) / 2,
          }),
        ),
      ),
    )
  // Tiny physical plots or a clipped waterfront may have room for one home,
  // even though the decorative template's civic square consumed its sampled lots.
  if (!buildings.some((b) => b.use === 'housing')) {
    const width = Math.min(32, parcel.size * 0.22) / scale,
      depth = width * 0.8
    const p = { x: city.x, z: city.z }
    if (
      [-1, 1].every((x) =>
        [-1, 1].every((z) => inside({ x: p.x + (x * width) / 2, z: p.z + (z * depth) / 2 })),
      )
    )
      buildings.push({ ...p, width, depth, height: 0, angle: 0, tone: 0.5, roof: 'gable', use: 'housing' })
  }
  const weight = (b: CityBuilding) =>
    (0.8 + b.tone * 0.4) *
    (1 +
      Math.exp(
        -Math.hypot(b.x * scale - form.center.x, b.z * scale - form.center.y) /
          Math.max(150, parcel.size * 0.4),
      ))
  const housing = buildings.filter((b) => b.use === 'housing')
  const totalWeight = housing.reduce((sum, b) => sum + b.width * b.depth * weight(b), 0)
  const typical = Math.max(1, form.floorAreaRatio / Math.max(0.12, form.coverage))
  for (const b of buildings) {
    const floors = 2 + 4 * (1 - Math.exp((-Math.max(0, typical - 1) * weight(b)) / 6))
    // Horizontal houses are cartographic samples too. Give them the readable
    // proportions of the opening atlas, while keeping a strict aspect bound.
    const shortSide = Math.min(b.width, b.depth)
    b.height =
      b.use === 'workshop'
        ? shortSide * 0.55
        : Math.min((2.5 + floors * 1.5) / scale + shortSide * 0.45, shortSide)
    b.storeys = b.use === 'workshop' ? 1 : floors
    if (b.use === 'housing')
      b.representedCapacity =
        ((city.capacity ?? 0) * b.width * b.depth * weight(b)) / Math.max(1e-12, totalWeight)
  }
  const streets = template.streets.flatMap((street) => {
    const result: CityLayout['streets'] = []
    let run: CityPoint[] = []
    for (const p of street.points.map(project)) {
      if (inside(p)) run.push(p)
      else {
        if (run.length > 1) result.push({ points: run, width: street.width * ratio })
        run = []
      }
    }
    if (run.length > 1) result.push({ points: run, width: street.width * ratio })
    return result
  })
  const square = template.square.map(project)
  return {
    ...template,
    city,
    buildings,
    streets,
    square: city.civic !== false && square.every(inside) ? square : [],
    bridges: [], // Street projection cannot authorize a new crossing of physical water.
    plaza: project(template.plaza),
    trees: template.trees.map(project).filter(inside),
    gardens: template.gardens
      .map((g) => ({ ...g, ...project(g), width: g.width * ratio, depth: g.depth * ratio }))
      .filter((g) => inside(g)),
  }
}
