import type { World } from '../../src/sim/types'
import type { PhysicalSite, PointMeters } from '../../src/sim/adaptive-types'
import { CELL_METERS } from '../../src/sim/grid'
import { METERS_PER_MAP_UNIT } from '../../src/sim/physical-space'
import { openingSupportSize } from '../../src/sim/residential-sites'
import { buildingFootprint } from '../../src/sim/building-lots'

/** Minimal flat world for settlement-field and place tests: all land, one
 * province per nation, physical sites only. No economy, cohorts or accounts. */
export function settlementWorld(width = 32, height = 32, nationOf: (cell: number) => number = () => 0) {
  const cells = Array.from({ length: width * height }, (_, id) => {
    const q = id % width,
      r = Math.floor(id / width)
    return {
      id,
      q,
      r,
      x: ((q + 0.5) * CELL_METERS) / METERS_PER_MAP_UNIT,
      y: ((r + 0.5) * CELL_METERS) / METERS_PER_MAP_UNIT,
      terrain: 'plains',
      elevation: 0.2,
      region: nationOf(id),
    }
  })
  return {
    seed: 'synthetic settlements',
    month: 0,
    width,
    height,
    cells,
    regions: ['Avon', 'Brill', 'Corve'].map((name, id) => ({ id, name, nation: id })),
    nations: [],
    adaptive: { residentialVersion: 1, metersPerMapUnit: METERS_PER_MAP_UNIT, sites: {} },
    localEconomy: { active: [], units: {}, cities: [], nextCity: 0 },
  } as unknown as World
}

const cellAt = (w: World, p: PointMeters) =>
  Math.floor(p.y / CELL_METERS) * w.width + Math.floor(p.x / CELL_METERS)

/** A compact town of surveyed buildings on a square block of side `side`
 * metres around `centre`, its residents split evenly. */
export function addTown(w: World, centre: PointMeters, people: number, side = 256, spacing = 16) {
  const points: PointMeters[] = []
  for (let y = -side / 2 + spacing / 2; y < side / 2; y += spacing)
    for (let x = -side / 2 + spacing / 2; x < side / 2; x += spacing)
      points.push({ x: centre.x + x, y: centre.y + y })
  const each = Math.floor(people / points.length)
  return points.map((point, i) => addBuilding(w, point, each + (i < people - each * points.length ? 1 : 0)))
}

let next = 0
export function addBuilding(w: World, point: PointMeters, residents: number): PhysicalSite {
  const cell = cellAt(w, point)
  const site: PhysicalSite = {
    id: `residence:${next++}`,
    cell,
    pool: w.cells[cell].region,
    ...point,
    kind: 'residential',
    entity: `residents:${w.cells[cell].region}`,
    founded: 0,
    capacity: Math.max(1, residents),
    openingCapacity: Math.max(1, residents),
    capitalReference: 0,
    residents,
    parcel: { x: point.x - 8, y: point.y - 8, size: 16 },
    building: buildingFootprint(w.seed, point),
  }
  w.adaptive!.sites[site.id] = site
  return site
}

/** A coarse opening record at a terrain-sample centre, as settled worlds start. */
export function addRecord(w: World, cell: number, residents: number, built: number): PhysicalSite {
  const x = ((cell % w.width) + 0.5) * CELL_METERS,
    y = (Math.floor(cell / w.width) + 0.5) * CELL_METERS,
    size = openingSupportSize(residents * 1.15)
  const site: PhysicalSite = {
    id: `home:${cell}`,
    cell,
    pool: w.cells[cell].region,
    x,
    y,
    kind: 'residential',
    entity: `residents:${w.cells[cell].region}`,
    founded: 0,
    capacity: Math.ceil(residents * 1.15),
    openingCapacity: Math.ceil(residents * 1.15),
    openingBuilt: built,
    capitalReference: 0,
    residents,
    parcel: { x: x - size / 2, y: y - size / 2, size },
  }
  w.adaptive!.sites[site.id] = site
  return site
}

/** Living place identities, largest first. */
export const livingPlaces = (w: World) =>
  w
    .localEconomy!.cities.filter((c) => c.absorbedBy === undefined && c.abandoned === undefined)
    .sort((a, b) => b.population - a.population || a.id - b.id)
