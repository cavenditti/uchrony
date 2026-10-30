import {
  visibleRenderCells,
  visiblePopulationCells,
  visibleUrbanPlots,
  urbanPlotDensity,
  urbanFabricIntensity,
  urbanFabricSupport,
  urbanPlotNeighbours,
  type MapWindow,
  type UrbanPlot,
} from './quadtree'
import { METERS_PER_MAP_UNIT } from '../sim/physical-space'
import { CELL_METERS } from '../sim/grid'
import type { PointMeters } from '../sim/adaptive-types'
import type { World, Layer } from '../sim/types'
import { drawGroundRoads } from './ground-roads'
import { hashSeed } from '../sim/random'
import { FABRIC_TONES, FabricShare, lotCorners } from './built-up-area'

const ROOFS = ['#956f50', '#8c6251', '#aaa38b', '#797c6d', '#b19570']
/** Zoom at which built-up areas resolve into blocks: when 100 m spans 2.5 px.
 * One threshold for every record, so a town never mixes blocks and flat areas. */
const BLOCK_PIXELS_PER_100M = 2.5

/** Coarse occupied fabric is drawn as representative blocks, not as its square. */
const coarseFabric = (plot: UrbanPlot) => !plot.building && !!plot.developed && (plot.residents ?? 0) > 0

function trace(path: Path2D, points: readonly PointMeters[], meters: number) {
  points.forEach((p, i) =>
    i ? path.lineTo(p.x / meters, p.y / meters) : path.moveTo(p.x / meters, p.y / meters),
  )
  path.closePath()
}

/** Fabric paths in map units for each plot of the current snapshot. The
 * outline is needed at every zoom; roofs are built on first use at reading
 * zoom, so an overview of a whole continent never lays out its blocks. A new
 * snapshot brings new plot objects, and their stale paths are collected. */
interface FabricPaths {
  share: FabricShare
  intensity: number
  outline: Path2D
  lots?: Path2D[]
}
const fabricPaths = new WeakMap<UrbanPlot, FabricPaths>()
function urbanFabricPaths(world: World, plot: UrbanPlot, meters: number): FabricPaths {
  let paths = fabricPaths.get(plot)
  if (paths) return paths
  const intensity = urbanFabricIntensity(plot),
    share = new FabricShare(
      plot.id,
      { support: urbanFabricSupport(plot), intensity },
      urbanPlotNeighbours(world, plot),
    ),
    outline = new Path2D()
  trace(outline, share.outline(), meters)
  paths = { share, intensity, outline }
  fabricPaths.set(plot, paths)
  return paths
}
function fabricLots(paths: FabricPaths, meters: number) {
  if (!paths.lots) {
    paths.lots = Array.from({ length: FABRIC_TONES }, () => new Path2D())
    for (const lot of paths.share.lots()) trace(paths.lots[lot.tone], lotCorners(lot), meters)
  }
  return paths.lots
}

/** Built-up areas of coarse records, clipped to land. Overlapping envelopes of
 * neighbouring records merge into one area; at reading zoom it resolves into
 * blocks and houses whose size and coverage follow developed intensity. */
function drawUrbanFabric(
  ctx: CanvasRenderingContext2D,
  world: World,
  plots: readonly UrbanPlot[],
  layer: Layer,
  scale: number,
  meters: number,
  land: Path2D,
) {
  ctx.save()
  ctx.clip(land, 'evenodd')
  const alpha = layer === 'terrain' ? 0.95 : 0.65
  ctx.globalAlpha = alpha
  for (const plot of plots) {
    if (!coarseFabric(plot)) continue
    const paths = urbanFabricPaths(world, plot, meters),
      { outline, intensity: t } = paths
    if ((100 / meters) * scale < BLOCK_PIXELS_PER_100M) {
      ctx.fillStyle = `rgb(${Math.round(217 - 95 * t)},${Math.round(199 - 120 * t)},${Math.round(156 - 98 * t)})`
      ctx.fill(outline)
      continue
    }
    // Streets, yards and gardens first, translucent so the land shows through
    // and the built-up area reads by its roofs; then roofs by tone.
    ctx.globalAlpha = alpha * 0.55
    ctx.fillStyle = `rgb(${Math.round(222 - 30 * t)},${Math.round(209 - 38 * t)},${Math.round(172 - 45 * t)})`
    ctx.fill(outline)
    ctx.globalAlpha = alpha
    fabricLots(paths, meters).forEach((path, tone) => {
      ctx.fillStyle = ROOFS[tone]
      ctx.fill(path)
    })
  }
  ctx.restore()
}

/** Screen-sized ancestors of the physical mesh and persistent occupied lots.
 * Building footprints remain simulation-owned; zoom changes only display work. */
export function drawQuadtree(
  ctx: CanvasRenderingContext2D,
  world: World,
  layer: Layer,
  scale: number,
  window: MapWindow,
  land: Path2D,
) {
  if (!world.adaptive) return
  const meters = world.adaptive.metersPerMapUnit ?? METERS_PER_MAP_UNIT
  const cells =
    layer === 'population'
      ? visiblePopulationCells(world, window, scale)
      : visibleRenderCells(world, window, scale)
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, (world.width * CELL_METERS) / meters, (world.height * CELL_METERS) / meters)
  ctx.clip()
  // Population and grid lines share a readable display resolution. Density is
  // total residents / total land area; zero-land squares never acquire a tint.
  if (layer === 'population') {
    ctx.save()
    ctx.clip(land, 'evenodd')
    for (const cell of cells) {
      if (!cell.landArea) continue
      const t = Math.min(1, Math.log1p((cell.population * 1e6) / cell.landArea) / Math.log1p(60000))
      const b = cell.bounds
      ctx.fillStyle = `rgb(${199 - t * 141},${209 - t * 91},${164 - t * 67})`
      ctx.fillRect(b.x / meters, b.y / meters, b.size / meters, b.size / meters)
    }
    ctx.restore()
  }
  // Draw subdivision beneath physical buildings, with screen-space stroke width.
  for (const water of [true, false]) {
    ctx.beginPath()
    for (const cell of cells) {
      const b = cell.bounds
      if ((cell.landArea === 0) !== water || (b.size / meters) * scale < 5) continue
      ctx.rect(b.x / meters, b.y / meters, b.size / meters, b.size / meters)
    }
    ctx.lineWidth = 0.65 / scale
    ctx.strokeStyle = water ? '#a4c4c91f' : '#263c3455'
    ctx.stroke()
  }
  // Drawn fabric reaches up to ~0.6 samples beyond a record's support.
  const reach = CELL_METERS * 0.6,
    plots = visibleUrbanPlots(
      world,
      {
        x: window.x - reach,
        y: window.y - reach,
        width: window.width + 2 * reach,
        height: window.height + 2 * reach,
      },
      scale,
    )
  // Roads are drawn over coarse fabric, where they read as its main streets.
  if (layer !== 'population') drawUrbanFabric(ctx, world, plots, layer, scale, meters, land)
  drawGroundRoads(
    ctx,
    world,
    scale,
    {
      x: window.x / meters,
      y: window.y / meters,
      width: window.width / meters,
      height: window.height / meters,
    },
    land,
  )
  for (const plot of plots) {
    const p = plot.parcel,
      x = p.x / meters,
      y = p.y / meters,
      size = p.size / meters
    const shape = new Path2D()
    if (plot.building) {
      plot.building.forEach((p, i) => {
        if (i) shape.lineTo(p.x / meters, p.y / meters)
        else shape.moveTo(p.x / meters, p.y / meters)
      })
      shape.closePath()
    } else shape.rect(x, y, size, size)
    const occupied = (plot.residents ?? 0) > 0,
      t = urbanPlotDensity(plot),
      fabric = coarseFabric(plot)
    ctx.fillStyle = occupied
      ? plot.building
        ? ROOFS[hashSeed(plot.id) % ROOFS.length]
        : `rgb(${Math.round(227 - t * 129)}, ${Math.round(207 - t * 132)}, ${Math.round(159 - t * 98)})`
      : '#8f9285'
    ctx.globalAlpha = layer === 'terrain' ? 0.95 : 0.65
    if (plot.developed && !fabric && layer !== 'population') {
      ctx.fill(shape)
    }
    ctx.globalAlpha = 1
    // Coarse fabric has no square to outline: its edge is the drawn envelope.
    if (!fabric && size * scale >= 5 && layer !== 'population') {
      ctx.lineWidth = 0.8 / scale
      ctx.strokeStyle = occupied ? '#493e2fbb' : '#4b594d'
      ctx.setLineDash(occupied ? [] : [2 / scale, 2 / scale])
      ctx.stroke(shape)
      if (plot.building && occupied && size * scale >= 12) {
        const [a, b, c, d] = plot.building
        ctx.beginPath()
        ctx.moveTo((a.x + d.x) / 2 / meters, (a.y + d.y) / 2 / meters)
        ctx.lineTo((b.x + c.x) / 2 / meters, (b.y + c.y) / 2 / meters)
        ctx.strokeStyle = '#efd8ac99'
        ctx.lineWidth = 0.7 / scale
        ctx.stroke()
      }
    }
    if (plot.construction! > 0) {
      ctx.lineWidth = 1.4 / scale
      ctx.strokeStyle = '#f1ca79'
      ctx.setLineDash([3 / scale, 2 / scale])
      ctx.stroke(shape)
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(x, y + size)
      ctx.lineTo(x + size, y)
      ctx.stroke()
    }
    ctx.setLineDash([])
  }
  ctx.restore()
}
