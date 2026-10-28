import {
  visibleMapLeaves,
  visiblePopulationCells,
  visibleUrbanPlots,
  urbanPlotDensity,
  type MapWindow,
} from './quadtree'
import { METERS_PER_MAP_UNIT } from '../sim/physical-space'
import { CELL_METERS } from '../sim/grid'
import type { World, Layer } from '../sim/types'
import { drawGroundRoads } from './ground-roads'
import { hashSeed } from '../sim/random'

/** Actual spatial leaves and persistent occupied lots. Building footprints are
 * simulation-owned geometry; zoom only changes how much detail is drawn. */
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
    layer === 'population' ? visiblePopulationCells(world, window, scale) : visibleMapLeaves(world, window)
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
  for (const plot of visibleUrbanPlots(world, window)) {
    const p = plot.parcel,
      x = p.x / meters,
      y = p.y / meters,
      size = p.size / meters
    if (size * scale < 0.4) continue
    const shape = new Path2D()
    if (plot.building) {
      plot.building.forEach((p, i) => {
        if (i) shape.lineTo(p.x / meters, p.y / meters)
        else shape.moveTo(p.x / meters, p.y / meters)
      })
      shape.closePath()
    } else shape.rect(x, y, size, size)
    const occupied = (plot.residents ?? 0) > 0,
      t = urbanPlotDensity(plot)
    const pigment = hashSeed(plot.id) % 5
    const roofs = ['#956f50', '#8c6251', '#aaa38b', '#797c6d', '#b19570']
    ctx.fillStyle = occupied
      ? plot.building
        ? roofs[pigment]
        : `rgb(${Math.round(227 - t * 129)}, ${Math.round(207 - t * 132)}, ${Math.round(159 - t * 98)})`
      : '#8f9285'
    ctx.globalAlpha = layer === 'terrain' ? 0.95 : 0.65
    if (plot.developed && layer !== 'population') {
      ctx.fill(shape)
    }
    ctx.globalAlpha = 1
    if (size * scale >= 5 && layer !== 'population') {
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
