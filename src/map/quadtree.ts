import { mapHomesSnapshot, mapMeshSnapshot, type MapMesh } from '../sim/map-snapshot'
import { nodeBounds, quadrant, rootBounds, pointInPolygon, METERS_PER_MAP_UNIT } from '../sim/physical-space'
import { CELL_METERS } from '../sim/grid'
import type { SpatialBounds, PointMeters } from '../sim/adaptive-types'
import type { World } from '../sim/types'
import { urbanBlocks, urbanBlockId, type UrbanBlock } from '../sim/urban-blocks'

export interface MapWindow {
  x: number
  y: number
  width: number
  height: number
}
export interface MapLeaf {
  id: string
  bounds: SpatialBounds
  population: number
  jobs: number
  landArea: number
}
export type UrbanPlot = NonNullable<World['viewHomes']>[number] & { parcel: SpatialBounds }
type MapTotals = Pick<MapLeaf, 'population' | 'jobs' | 'landArea'>
export const MIN_POPULATION_SQUARE_PIXELS = 12
const cache = new WeakMap<
  World,
  {
    revision: number | undefined
    mesh: MapMesh | undefined
    indices: Map<string, number>
    branches: Map<string, MapTotals>
    plots: Map<number, UrbanPlot[]>
    blocks: Map<string, UrbanBlock>
  }
>()

function index(world: World) {
  const prior = cache.get(world)
  if (
    prior &&
    prior.revision === world.adaptive?.revision &&
    (!world.viewOnly || prior.mesh === world.viewMesh)
  )
    return prior
  const mesh = mapMeshSnapshot(world),
    indices = new Map<string, number>(),
    branches = new Map<string, MapTotals>()
  mesh?.addresses.forEach((id, i) => {
    indices.set(id, i)
    for (let j = 1; j < id.length; j++) {
      const parent = id.slice(0, j)
      let totals = branches.get(parent)
      if (!totals) {
        totals = { population: 0, jobs: 0, landArea: 0 }
        branches.set(parent, totals)
      }
      totals.population += mesh.population[i]
      totals.jobs += mesh.jobs[i]
      totals.landArea += mesh.landArea[i]
    }
  })
  const plots = new Map<number, UrbanPlot[]>()
  for (const home of mapHomesSnapshot(world)) {
    // Naming thresholds never decide whether occupied land or a funded project exists.
    if (!home.parcel || (!home.developed && !(home.construction! > 0))) continue
    const list = plots.get(home.cell) ?? []
    list.push(home as UrbanPlot)
    plots.set(home.cell, list)
  }
  const blocks = new Map(urbanBlocks(world).map((b) => [b.id, b]))
  const result = { revision: world.adaptive?.revision, mesh, indices, branches, plots, blocks }
  cache.set(world, result)
  return result
}
const intersects = (b: SpatialBounds, v: MapWindow) =>
  b.x < v.x + v.width && b.x + b.size > v.x && b.y < v.y + v.height && b.y + b.size > v.y

function leaf(mesh: MapMesh, id: string, bounds: SpatialBounds, i: number): MapLeaf {
  return { id, bounds, population: mesh.population[i], jobs: mesh.jobs[i], landArea: mesh.landArea[i] }
}

/** Traverse only visible branches; zoom changes drawing, never the simulation mesh. */
export function visibleMapLeaves(world: World, window: MapWindow) {
  return visibleMapCells(world, window, 0)
}

/** Combine subpixel residents into world-aligned squares with a readable screen
 * footprint. Totals include offscreen descendants, so panning cannot change a
 * square's density. Land area is summed before division, including coastal cells. */
export function visiblePopulationCells(world: World, window: MapWindow, scale: number) {
  return visibleMapCells(world, window, populationMinimumSize(world, scale))
}

function populationMinimumSize(world: World, scale: number) {
  const meters = world.adaptive?.metersPerMapUnit ?? METERS_PER_MAP_UNIT
  return (MIN_POPULATION_SQUARE_PIXELS * meters) / scale
}

function visibleMapCells(world: World, window: MapWindow, minimumSize: number) {
  const { mesh, indices, branches } = index(world),
    result: MapLeaf[] = []
  if (!mesh) return result
  const visit = (id: string, bounds: SpatialBounds) => {
    if (!intersects(bounds, window)) return
    const i = indices.get(id)
    if (i !== undefined) result.push(leaf(mesh, id, bounds, i))
    else {
      const totals = branches.get(id)
      if (!totals) return
      if (bounds.size / 2 < minimumSize) result.push({ id, bounds, ...totals })
      else for (let q = 0; q < 4; q++) visit(id + q, nodeBounds(bounds, `r${q}`))
    }
  }
  visit('r', rootBounds(world))
  return result
}

export function mapLeafAt(world: World, point: PointMeters): MapLeaf | undefined {
  return mapCellAt(world, point, 0)
}

/** Pick the same ancestor used for population shading at the current zoom.
 * Its totals cover all descendants, even when the underlying leaf is empty. */
export function mapPopulationCellAt(world: World, point: PointMeters, scale: number) {
  return mapCellAt(world, point, populationMinimumSize(world, scale))
}

function mapCellAt(world: World, point: PointMeters, minimumSize: number): MapLeaf | undefined {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    point.x < 0 ||
    point.y < 0 ||
    point.x >= world.width * CELL_METERS ||
    point.y >= world.height * CELL_METERS
  )
    return undefined
  const { mesh, indices, branches } = index(world)
  if (!mesh) return undefined
  let id = 'r',
    bounds = rootBounds(world)
  while (branches.has(id)) {
    if (bounds.size / 2 < minimumSize) return { id, bounds, ...branches.get(id)! }
    const q = quadrant(point, bounds)
    id += q
    bounds = nodeBounds(bounds, `r${q}`)
  }
  const i = indices.get(id)
  return i === undefined ? undefined : leaf(mesh, id, bounds, i)
}

export function visibleUrbanPlots(world: World, window: MapWindow) {
  const { plots } = index(world),
    result: UrbanPlot[] = []
  const x0 = Math.max(0, Math.floor(window.x / CELL_METERS)),
    x1 = Math.min(world.width - 1, Math.floor((window.x + window.width) / CELL_METERS)),
    y0 = Math.max(0, Math.floor(window.y / CELL_METERS)),
    y1 = Math.min(world.height - 1, Math.floor((window.y + window.height) / CELL_METERS))
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      for (const plot of plots.get(y * world.width + x) ?? [])
        if (intersects(plot.parcel, window)) result.push(plot)
  return result
}

/** Pick the actual footprint, rather than treating the whole numerical cell as a house. */
export function mapBuildingAt(world: World, point: PointMeters) {
  const cell = Math.floor(point.y / CELL_METERS) * world.width + Math.floor(point.x / CELL_METERS)
  return index(world)
    .plots.get(cell)
    ?.find((plot) => plot.building && pointInPolygon(point, plot.building))
}

export function mapUrbanBlockAt(world: World, point: PointMeters) {
  return index(world).blocks.get(urbanBlockId(point))
}

/** Stable physical density scale: camera movement and city names cannot recolor a home. */
export function urbanPlotDensity(plot: UrbanPlot) {
  return Math.min(1, Math.log1p(((plot.residents ?? 0) * 1e6) / plot.parcel.size ** 2) / Math.log1p(60000))
}
