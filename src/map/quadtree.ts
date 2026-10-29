/** Camera-dependent display traversal over immutable physical mesh snapshots.
 * Totals and exact inspection are shared across zoom levels; only draw work varies. */
import { mapHomesSnapshot, mapMeshSnapshot, type MapMesh } from '../sim/map-snapshot'
import { nodeBounds, quadrant, rootBounds, pointInPolygon, METERS_PER_MAP_UNIT } from '../sim/physical-space'
import { CELL_METERS } from '../sim/grid'
import type { SpatialBounds, PointMeters } from '../sim/adaptive-types'
import type { World } from '../sim/types'
import { urbanBlocks, urbanBlockId, type UrbanBlock } from '../sim/urban-blocks'
import { RenderQuadtree, type RenderBounds } from './spatial-index'

/** Visible physical area in metres; camera LoD never alters the simulation. */
export type MapWindow = RenderBounds
export interface MapLeaf {
  id: string
  bounds: SpatialBounds
  population: number
  jobs: number
  landArea: number
}
export type UrbanPlot = NonNullable<World['viewHomes']>[number] & { parcel: SpatialBounds }
type MapTotals = Pick<MapLeaf, 'population' | 'jobs' | 'landArea'>
/** A display grid has a screen-space budget, independent of simulation depth. */
export const MIN_RENDER_SQUARE_PIXELS = 12
export const MIN_POPULATION_SQUARE_PIXELS = MIN_RENDER_SQUARE_PIXELS
/** Below this footprint size the atlas previously skipped the individual draw. */
export const MIN_URBAN_PLOT_PIXELS = 0.4
const cache = new WeakMap<
  World,
  {
    revision: number | undefined
    mesh: MapMesh | undefined
    indices: Map<string, number>
    branches: Map<string, MapTotals>
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
  const result = { revision: world.adaptive?.revision, mesh, indices, branches }
  cache.set(world, result)
  return result
}

// Grid shading, footprint drawing and block inspection have independent lazy
// caches: hovering a square must not also construct every urban block.
const plotCache = new WeakMap<
  World,
  {
    revision: number | undefined
    homes: World['viewHomes']
    plots: Map<number, UrbanPlot[]>
    tree: RenderQuadtree<UrbanPlot>
  }
>()
const blockCache = new WeakMap<
  World,
  {
    revision: number | undefined
    source: World['viewUrbanBlocks']
    blocks: Map<string, UrbanBlock>
  }
>()

function plotIndex(world: World) {
  const prior = plotCache.get(world)
  if (prior && prior.revision === world.adaptive?.revision && prior.homes === world.viewHomes) return prior
  const plots = new Map<number, UrbanPlot[]>(),
    entries = []
  // Point picking uses the known simulation cell; viewport queries use the
  // footprint tree so they can prune unresolvable groups before visiting lots.
  for (const home of mapHomesSnapshot(world)) {
    // Naming thresholds never decide whether occupied land or a funded project exists.
    if (!home.parcel || (!home.developed && !(home.construction! > 0))) continue
    const list = plots.get(home.cell) ?? []
    list.push(home as UrbanPlot)
    plots.set(home.cell, list)
    const { x, y, size } = home.parcel
    entries.push({ value: home as UrbanPlot, bounds: { x, y, width: size, height: size }, span: size })
  }
  const result = {
    revision: world.adaptive?.revision,
    homes: world.viewHomes,
    plots,
    tree: new RenderQuadtree(entries),
  }
  plotCache.set(world, result)
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

/** Stop before descending into subpixel simulation leaves on every atlas layer. */
export function visibleRenderCells(world: World, window: MapWindow, scale: number) {
  return visibleMapCells(world, window, minimumMapSize(world, scale, MIN_RENDER_SQUARE_PIXELS))
}

function populationMinimumSize(world: World, scale: number) {
  return minimumMapSize(world, scale, MIN_POPULATION_SQUARE_PIXELS)
}

function minimumMapSize(world: World, scale: number, pixels: number) {
  const meters = world.adaptive?.metersPerMapUnit ?? METERS_PER_MAP_UNIT
  return scale > 0 ? (pixels * meters) / scale : Infinity
}

function visibleMapCells(world: World, window: MapWindow, minimumSize: number) {
  const result: MapLeaf[] = []
  // The root is square but worlds need not be. Never draw a padded ancestor
  // when the viewport is wholly outside the actual rectangular domain.
  if (
    !(window.width > 0 && window.height > 0) ||
    window.x >= world.width * CELL_METERS ||
    window.y >= world.height * CELL_METERS ||
    window.x + window.width <= 0 ||
    window.y + window.height <= 0
  )
    return result
  const { mesh, indices, branches } = index(world)
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

/** Exact physical leaf for inspection, regardless of the display resolution. */
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

/** Optional scale keeps inspection exact while drawing skips unresolvable lots. */
export function visibleUrbanPlots(world: World, window: MapWindow, scale?: number) {
  return plotIndex(world)
    .tree.query(window, scale === undefined ? 0 : minimumMapSize(world, scale, MIN_URBAN_PLOT_PIXELS))
    .filter((plot) => intersects(plot.parcel, window))
}

/** Pick the actual footprint, rather than treating the whole numerical cell as a house. */
export function mapBuildingAt(world: World, point: PointMeters) {
  const cell = Math.floor(point.y / CELL_METERS) * world.width + Math.floor(point.x / CELL_METERS)
  return plotIndex(world)
    .plots.get(cell)
    ?.find((plot) => plot.building && pointInPolygon(point, plot.building))
}

/** Build block lookup only when block inspection is requested. */
export function mapUrbanBlockAt(world: World, point: PointMeters) {
  let cached = blockCache.get(world)
  if (!cached || cached.revision !== world.adaptive?.revision || cached.source !== world.viewUrbanBlocks) {
    cached = {
      revision: world.adaptive?.revision,
      source: world.viewUrbanBlocks,
      blocks: new Map(urbanBlocks(world).map((b) => [b.id, b])),
    }
    blockCache.set(world, cached)
  }
  return cached.blocks.get(urbanBlockId(point))
}

/** Stable physical density scale: camera movement and city names cannot recolor a home. */
export function urbanPlotDensity(plot: UrbanPlot) {
  return Math.min(1, Math.log1p(((plot.residents ?? 0) * 1e6) / plot.parcel.size ** 2) / Math.log1p(60000))
}
