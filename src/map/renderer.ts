import { HEX, neighbors } from '../sim/hex'
import { clamp, population, type World, type Layer } from '../sim/types'
import { buildGeometry, type MapGeometry, type Ring } from './geometry'
import { dominantIdentity, identityAxis, identityColor } from './identity'

export const terrainColors = {
  plains: '#b8bd91',
  forest: '#7c9b78',
  hills: '#a6a17e',
  mountains: '#b9b5a6',
  desert: '#d1bd8d',
  tundra: '#c3cbbd',
  water: '#304f55',
}
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
export const pathFor = (rings: Ring[], smooth = false) => {
  const path = new Path2D()
  for (const ring of rings) {
    if (!ring.length) continue
    if (smooth) {
      const last = ring[ring.length - 1]
      path.moveTo((last.x + ring[0].x) / 2, (last.y + ring[0].y) / 2)
      ring.forEach((p, i) => {
        const next = ring[(i + 1) % ring.length]
        path.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2)
      })
    } else {
      path.moveTo(ring[0].x, ring[0].y)
      ring.slice(1).forEach((p) => path.lineTo(p.x, p.y))
    }
    path.closePath()
  }
  return path
}
export interface AtlasCache {
  geometry: MapGeometry
  land: Path2D
  provinces: Path2D[]
  ocean: HTMLCanvasElement
  terrain: HTMLCanvasElement
  relief: HTMLCanvasElement
  worldWidth: number
  worldHeight: number
  seaLabels: { x: number; y: number; name: string }[]
}

export function buildAtlas(world: World): AtlasCache {
  const { cells, width, height } = world
  const geometry = buildGeometry(cells, width, height, world.regions.length)
  const worldWidth = Math.ceil(width * Math.sqrt(3) * HEX),
    worldHeight = Math.ceil(height * HEX * 1.5),
    resolution = Math.min(1, 2400 / Math.max(worldWidth, worldHeight)),
    w = Math.ceil(worldWidth * resolution),
    h = Math.ceil(worldHeight * resolution)
  const makeCanvas = () => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }
  const terrain = makeCanvas(),
    relief = makeCanvas(),
    ocean = makeCanvas()
  const terrainCtx = terrain.getContext('2d')!,
    reliefCtx = relief.getContext('2d')!
  const water = terrainCtx.createImageData(w, h)
  const pixels = terrainCtx.createImageData(w, h),
    shades = reliefCtx.createImageData(w, h)
  const colors = cells.map((c) => {
    if (c.terrain === 'water') {
      const shelf = clamp((c.elevation + 0.22) / 0.315)
      return [36 + shelf * 24, 63 + shelf * 32, 73 + shelf * 29, 0, c.elevation]
    }
    const west = cells[c.id % width > 0 ? c.id - 1 : c.id].elevation
    const east = cells[c.id % width < width - 1 ? c.id + 1 : c.id].elevation
    const north = cells[c.id >= width ? c.id - width : c.id].elevation
    const south = cells[c.id + width < cells.length ? c.id + width : c.id].elevation
    const shade = clamp((west - east) * 2.8 + (north - south) * 2, -0.42, 0.38)
    return [...rgb(terrainColors[c.terrain]), shade, c.elevation]
  })
  // Interpolate the simulation field, so relief is continuous instead of a mosaic of flat hexes.
  for (let y = 0; y < h; y++) {
    const row = Math.min(height - 1, y / resolution / (HEX * 1.5)),
      r0 = Math.floor(row),
      r1 = Math.min(height - 1, r0 + 1),
      fy = row - r0
    for (let x = 0; x < w; x++) {
      const samples = [r0, r1].map((r) => {
        const col = clamp(x / resolution / (Math.sqrt(3) * HEX) - (r % 2) / 2, 0, width - 1)
        const q = Math.floor(col),
          f = col - q,
          a = colors[r * width + q],
          b = colors[r * width + Math.min(width - 1, q + 1)]
        return a.map((v, i) => v + (b[i] - v) * f)
      })
      const value = samples[0].map((v, i) => v + (samples[1][i] - v) * fy),
        index = (y * w + x) * 4
      for (let k = 0; k < 3; k++) {
        pixels.data[index + k] = value[k]
        shades.data[index + k] = value[3] > 0 ? 255 : 0
      }
      const shelf =
        clamp((value[4] + 0.22) / 0.315) *
        clamp(Math.min(x / (w * 0.06), y / (h * 0.08), (w - 1 - x) / (w * 0.06), (h - 1 - y) / (h * 0.08)))
      water.data[index] = 36 + shelf * 24
      water.data[index + 1] = 63 + shelf * 32
      water.data[index + 2] = 73 + shelf * 29
      water.data[index + 3] = 255
      pixels.data[index + 3] = 255
      shades.data[index + 3] = Math.abs(value[3]) * 255
    }
  }
  ocean.getContext('2d')!.putImageData(water, 0, 0)
  terrainCtx.putImageData(pixels, 0, 0)
  reliefCtx.putImageData(shades, 0, 0)
  // Ocean labels go in open water, measured by distance from any land or map edge.
  const distance = new Float64Array(cells.length).fill(Infinity),
    queue: number[] = []
  for (const c of cells)
    if (c.terrain !== 'water' || c.q === 0 || c.r === 0 || c.q === width - 1 || c.r === height - 1) {
      distance[c.id] = 0
      queue.push(c.id)
    }
  for (let i = 0; i < queue.length; i++)
    for (const n of neighbors(queue[i], width, height))
      if (distance[n] === Infinity) {
        distance[n] = distance[queue[i]] + 1
        queue.push(n)
      }
  const candidates = cells
    .filter((c) => c.terrain === 'water' && distance[c.id] >= 4)
    .sort((a, b) => distance[b.id] - distance[a.id])
  const seaLabels: AtlasCache['seaLabels'] = []
  for (const c of candidates) {
    if (seaLabels.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < worldWidth * 0.3)) continue
    seaLabels.push({
      x: c.x,
      y: c.y,
      name:
        c.x < worldWidth * 0.35
          ? 'Western Ocean'
          : c.x > worldWidth * 0.65
            ? 'Eastern Ocean'
            : c.y > worldHeight * 0.6
              ? 'Southern Sea'
              : 'Northern Sea',
    })
    if (seaLabels.length === 3) break
  }
  return {
    geometry,
    land: pathFor(geometry.coast, true),
    provinces: geometry.provinces.map((r) => pathFor(r)),
    ocean,
    terrain,
    relief,
    seaLabels,
    worldWidth,
    worldHeight,
  }
}

export function drawAtlas(
  ctx: CanvasRenderingContext2D,
  cache: AtlasCache,
  world: World,
  layer: Layer,
  scale: number,
) {
  ctx.drawImage(cache.ocean, 0, 0, cache.worldWidth, cache.worldHeight)
  ctx.save()
  ctx.clip(cache.land, 'evenodd')
  ctx.drawImage(cache.terrain, 0, 0, cache.worldWidth, cache.worldHeight)
  // The raster supplies water and smoothly blended biomes; ownership remains exact province geometry.
  const maxPop = Math.max(1, ...world.regions.map((r) => population(r) / r.cells.length))
  if (['political', 'trade', 'military'].includes(layer)) {
    ctx.globalAlpha = 0.84
    for (const n of world.nations) {
      const shape = new Path2D()
      for (const r of world.regions) if (r.nation === n.id) shape.addPath(cache.provinces[r.id])
      ctx.fillStyle = n.color
      ctx.fill(shape)
    }
  } else if (layer !== 'terrain')
    for (const r of world.regions) {
      let fill = world.nations[r.nation].color
      const axis = identityAxis(layer)
      if (axis) fill = identityColor(dominantIdentity(r, axis))
      if (layer === 'population') {
        const t = Math.sqrt(population(r) / r.cells.length / maxPop)
        fill = `rgb(${199 - t * 141},${209 - t * 91},${164 - t * 67})`
      }
      if (layer === 'prosperity') {
        const t = clamp(r.happiness)
        fill = `rgb(${191 - t * 81},${122 + t * 56},${105 + t * 27})`
      }
      if (layer === 'food') {
        const t = clamp(r.foodCoverage)
        fill = `rgb(${191 - t * 59},${92 + t * 82},${80 + t * 48})`
      }
      ctx.globalAlpha = ['political', 'trade', 'military'].includes(layer) ? 0.84 : 1
      ctx.fillStyle = fill
      ctx.fill(cache.provinces[r.id], 'evenodd')
    }
  ctx.globalAlpha = ['population', 'food', 'prosperity', 'culture', 'language', 'belief'].includes(layer)
    ? 0.28
    : 0.85
  ctx.drawImage(cache.relief, 0, 0, cache.worldWidth, cache.worldHeight)
  ctx.globalAlpha = 1
  // Actual drainage edges: adjacent wet cells never create spurious cross-connections.
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const c of world.cells)
    if (
      c.river &&
      c.terrain !== 'water' &&
      (scale >= 0.7 || (c.riverFlow ?? 0) >= 12 / Math.max(0.08, scale))
    ) {
      const targets =
        c.downstream === undefined
          ? neighbors(c.id, world.width, world.height).filter(
              (id) => world.cells[id].river && world.cells[id].elevation < c.elevation,
            )
          : [c.downstream]
      for (const id of targets) {
        const n = world.cells[id]
        ctx.beginPath()
        ctx.moveTo(c.x, c.y)
        ctx.lineTo(n.x, n.y)
        ctx.strokeStyle = layer === 'terrain' ? '#477e8bbf' : '#456e7899'
        ctx.lineWidth = Math.max(0.75 / scale, Math.min(2.8, Math.sqrt(c.riverFlow ?? 14) * 0.18))
        ctx.stroke()
      }
    }
  // Province divisions reveal themselves as the observer zooms in.
  if (scale > 0.7) {
    ctx.beginPath()
    for (const e of cache.geometry.edges) {
      ctx.moveTo(e.a.x, e.a.y)
      ctx.lineTo(e.b.x, e.b.y)
    }
    ctx.strokeStyle = '#263c3440'
    ctx.lineWidth = 0.55 / scale
    ctx.stroke()
  }
  ctx.beginPath()
  for (const e of cache.geometry.edges)
    if (world.regions[e.left].nation !== world.regions[e.right].nation) {
      ctx.moveTo(e.a.x, e.a.y)
      ctx.lineTo(e.b.x, e.b.y)
    }
  ctx.strokeStyle = '#e1dfbf8c'
  ctx.lineWidth = 2.1 / scale
  ctx.stroke()
  ctx.strokeStyle = '#35473bbf'
  ctx.lineWidth = 0.8 / scale
  ctx.stroke()
  ctx.restore()
  // Shore contours follow the same smoothed land mask used for the fill.
  ctx.strokeStyle = '#91b0ab30'
  ctx.lineWidth = 7
  ctx.stroke(cache.land)
  ctx.strokeStyle = '#d6d8b77a'
  ctx.lineWidth = 2
  ctx.stroke(cache.land)
  ctx.strokeStyle = '#223f42'
  ctx.lineWidth = 0.85
  ctx.stroke(cache.land)
}

export function drawPlaceLabels(
  ctx: CanvasRenderingContext2D,
  cache: AtlasCache,
  world: World,
  layer: Layer,
  scale: number,
  view: { x: number; y: number; w: number; h: number },
  selected: number,
) {
  const placed: { x: number; y: number; w: number; h: number }[] = []
  const place = (text: string, x: number, y: number, font: number, kind: 'state' | 'city' | 'sea') => {
    const sx = x * scale + view.x,
      sy = y * scale + view.y
    ctx.font = `${kind === 'sea' ? 'italic' : kind === 'state' ? '500' : '400'} ${font / scale}px Alegreya, Georgia, serif`
    const w = ctx.measureText(text).width * scale
    const box = { x: sx - w / 2 - 5, y: sy - font - 4, w: w + 10, h: font + 9 }
    if (box.x < 8 || box.x + box.w > view.w - 8 || box.y < 85 || box.y + box.h > view.h - 100) return false
    if (
      placed.some((p) => box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y)
    )
      return false
    placed.push(box)
    ctx.textAlign = 'center'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = kind === 'sea' ? '#304e5470' : '#e9e5caa6'
    ctx.lineWidth = 1.8 / scale
    ctx.strokeText(text, x, y)
    ctx.fillStyle = kind === 'sea' ? '#c7d5ce99' : kind === 'state' ? '#293c32' : '#233b35'
    ctx.fillText(text, x, y)
    return true
  }
  if (['political', 'terrain', 'military'].includes(layer)) {
    const nations = [...world.nations].sort(
      (a, b) => (b.id === selected ? 1 : 0) - (a.id === selected ? 1 : 0) || b.population - a.population,
    )
    for (const n of nations) {
      const regions = world.regions.filter((r) => r.nation === n.id)
      if (!regions.length) continue
      const total = regions.reduce((s, r) => s + r.cells.length, 0)
      const cx = regions.reduce((s, r) => s + world.cells[r.center].x * r.cells.length, 0) / total
      const cy = regions.reduce((s, r) => s + world.cells[r.center].y * r.cells.length, 0) / total
      const candidates = [...regions].sort(
        (a, b) =>
          Math.hypot(world.cells[a.center].x - cx, world.cells[a.center].y - cy) -
          Math.hypot(world.cells[b.center].x - cx, world.cells[b.center].y - cy),
      )
      const font = clamp(10 + Math.sqrt(total) * scale * 0.24, 11, 22)
      for (const r of candidates.slice(0, 8)) {
        const c = world.cells[r.center]
        if (place(n.shortName.toUpperCase().split('').join(' '), c.x, c.y - 12 / scale, font, 'state')) break
      }
    }
  }
  const regions = [...world.regions].sort(
    (a, b) =>
      (world.nations[b.nation].capital === b.id ? 1 : 0) - (world.nations[a.nation].capital === a.id ? 1 : 0),
  )
  for (const r of regions) {
    const capital = world.nations[r.nation].capital === r.id,
      c = world.cells[r.center]
    if (!capital && scale < 1.15) continue
    const radius = (capital ? 2.5 : 1.3) / scale
    ctx.beginPath()
    ctx.arc(c.x, c.y, radius, 0, Math.PI * 2)
    ctx.fillStyle = '#293d36'
    ctx.fill()
    if (capital) {
      ctx.strokeStyle = '#e9e3c7'
      ctx.lineWidth = 1 / scale
      ctx.stroke()
    }
    place(r.name, c.x, c.y + 12 / scale, capital ? 11 : 10, 'city')
  }
  for (const label of cache.seaLabels) place(label.name, label.x, label.y, 13, 'sea')
}
