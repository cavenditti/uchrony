import { landscapeRasters } from './landscape-raster'
import { riverCurves, riverPaths } from './rivers'
import { spatialState, districtDensityScale } from '../sim/spatial'
import { HEX, neighbors } from '../sim/hex'
import { clamp, type World, type Layer } from '../sim/types'
import { buildGeometry, type MapGeometry, type Ring } from './geometry'
import { dominantIdentity, identityAxis, identityColor } from './identity'

export const terrainColors = {
  plains: '#a6b77c',
  forest: '#66845b',
  hills: '#93966c',
  mountains: '#a6a89a',
  desert: '#d7bd87',
  tundra: '#ced5c8',
  water: '#235568',
}
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
  rivers: ReturnType<typeof riverPaths>
  riverCurves: ReturnType<typeof riverCurves>
  seaLabels: { x: number; y: number; name: string }[]
}

const districtCache = new WeakMap<
  World['cells'],
  { signature: string; paths: Path2D[]; edges: MapGeometry['edges'] }
>()
function districtAtlas(world: World) {
  const spatial = spatialState(world)
  const signature = `${world.localEconomy?.revision ?? ''}|${spatial.districts.map((d) => d.id).join('|')}`
  let cached = districtCache.get(world.cells)
  if (!cached || cached.signature !== signature) {
    const owners = new Int32Array(world.cells.length).fill(-1)
    spatial.districts.forEach((d, i) =>
      d.cells.forEach((id) => {
        owners[id] = i
      }),
    )
    const geometry = buildGeometry(
      world.cells.map((c) => ({ ...c, region: owners[c.id] })),
      world.width,
      world.height,
      spatial.districts.length,
    )
    cached = { signature, paths: geometry.provinces.map((rings) => pathFor(rings)), edges: geometry.edges }
    districtCache.set(world.cells, cached)
  }
  return cached
}

export function buildAtlas(world: World): AtlasCache {
  const { cells, width, height } = world
  const geometry = buildGeometry(cells, width, height, world.regions.length)
  const worldWidth = Math.ceil(width * Math.sqrt(3) * HEX),
    worldHeight = Math.ceil(height * HEX * 1.5),
    resolution = Math.min(1, 2400 / Math.max(worldWidth, worldHeight)),
    w = Math.ceil(worldWidth * resolution),
    h = Math.ceil(worldHeight * resolution)
  const { terrain, relief, ocean } = landscapeRasters(world, w, h, worldWidth, worldHeight)
  const curves = riverCurves(world)
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
    riverCurves: curves,
    rivers: riverPaths(curves),
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
  relief = false,
) {
  ctx.drawImage(cache.ocean, 0, 0, cache.worldWidth, cache.worldHeight)
  ctx.save()
  ctx.clip(cache.land, 'evenodd')
  ctx.drawImage(cache.terrain, 0, 0, cache.worldWidth, cache.worldHeight)
  // The raster supplies water and smoothly blended biomes; ownership remains exact province geometry.
  if (['political', 'trade', 'military'].includes(layer)) {
    ctx.globalAlpha = relief ? 0.46 : 0.84
    for (const n of world.nations) {
      const shape = new Path2D()
      for (const r of world.regions) if (r.nation === n.id) shape.addPath(cache.provinces[r.id])
      ctx.fillStyle = n.color
      ctx.fill(shape)
    }
  } else if (layer === 'population') {
    const spatial = spatialState(world),
      districts = districtAtlas(world)
    const density = districtDensityScale(world)
    ctx.globalAlpha = 1
    spatial.districts.forEach((d, i) => {
      const t = density.intensity(d.population / d.cells.length)
      ctx.fillStyle = `rgb(${199 - t * 141},${209 - t * 91},${164 - t * 67})`
      ctx.fill(districts.paths[i], 'evenodd')
    })
  } else if (world.localEconomy && (layer === 'food' || layer === 'prosperity')) {
    const spatial = spatialState(world),
      districts = districtAtlas(world)
    ctx.globalAlpha = 1
    spatial.districts.forEach((d, i) => {
      const unit = world.localEconomy!.units[Number(d.id.split(':')[1])]
      const t = clamp(layer === 'food' ? unit.foodCoverage : unit.happiness)
      ctx.fillStyle =
        layer === 'food'
          ? `rgb(${191 - t * 59},${92 + t * 82},${80 + t * 48})`
          : `rgb(${191 - t * 81},${122 + t * 56},${105 + t * 27})`
      ctx.fill(districts.paths[i], 'evenodd')
    })
  } else if (layer !== 'terrain')
    for (const r of world.regions) {
      let fill = world.nations[r.nation].color
      const axis = identityAxis(layer)
      if (axis) fill = identityColor(dominantIdentity(r, axis))
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
  if (!relief) ctx.drawImage(cache.relief, 0, 0, cache.worldWidth, cache.worldHeight)
  ctx.globalAlpha = 1
  if (world.localEconomy && ['terrain', 'political', 'trade'].includes(layer)) {
    ctx.fillStyle = '#a89b83'
    for (const city of world.localEconomy.cities)
      if (city.absorbedBy === undefined)
        for (const id of city.cells) {
          const cell = world.cells[id]
          ctx.globalAlpha = 0.18 + Math.min(0.3, (world.localEconomy.built[id] ?? 0) * 0.3)
          ctx.beginPath()
          for (let k = 0; k < 6; k++) {
            const angle = ((k * 60 - 30) * Math.PI) / 180,
              x = cell.x + HEX * Math.cos(angle),
              y = cell.y + HEX * Math.sin(angle)
            if (k === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          }
          ctx.closePath()
          ctx.fill()
        }
    ctx.globalAlpha = 1
  }
  // Curved centerlines share confluence positions and are cached with immutable geography.
  const minimumFlow = scale >= 0.7 ? 0 : 12 / Math.max(0.08, scale)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (let pass = 0; !relief && pass < 2; pass++) {
    const bank = pass === 0
    ctx.strokeStyle = bank ? '#263e366b' : layer === 'terrain' ? '#438d9d' : '#457a88bb'
    for (const river of cache.rivers) {
      if (river.flow < minimumFlow) continue
      const width = Math.max(0.5 / scale, Math.min(6, 0.35 + Math.sqrt(river.flow) * 0.13))
      ctx.lineWidth = width + (bank ? 0.8 : 0)
      ctx.stroke(river.path)
    }
  }
  // Adaptive detail is clipped to real land; the quadtree itself is not a square overlay.
  if (layer !== 'terrain' && scale > 2.2) {
    ctx.beginPath()
    for (const e of districtAtlas(world).edges) {
      ctx.moveTo(e.a.x, e.a.y)
      ctx.lineTo(e.b.x, e.b.y)
    }
    ctx.strokeStyle = '#263c342b'
    ctx.lineWidth = 0.4 / scale
    ctx.stroke()
  }
  // Province divisions reveal themselves as the observer zooms in.
  if (layer !== 'terrain' && scale > 0.7) {
    ctx.beginPath()
    for (const e of cache.geometry.edges) {
      ctx.moveTo(e.a.x, e.a.y)
      ctx.lineTo(e.b.x, e.b.y)
    }
    ctx.strokeStyle = '#263c3440'
    ctx.lineWidth = 0.55 / scale
    ctx.stroke()
  }
  if (layer !== 'terrain') {
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
  }
  ctx.restore()
  // A narrow wet margin and pale shore, without a heavy cartographic coastline.
  ctx.strokeStyle = '#74aea14d'
  ctx.lineWidth = 3.2
  ctx.stroke(cache.land)
  ctx.strokeStyle = '#cecc9d99'
  ctx.lineWidth = 1.25
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
  project?: (x: number, y: number) => { x: number; y: number },
) {
  const placed: { x: number; y: number; w: number; h: number }[] = []
  const place = (text: string, x: number, y: number, font: number, kind: 'state' | 'city' | 'sea') => {
    if (project) ({ x, y } = project(x, y))
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
    ctx.strokeStyle = kind === 'sea' ? '#173640a0' : layer === 'terrain' ? '#182c24b3' : '#e9e5caa6'
    ctx.lineWidth = 1.8 / scale
    ctx.strokeText(text, x, y)
    ctx.fillStyle =
      kind === 'sea'
        ? '#b3ccc8ad'
        : layer === 'terrain'
          ? '#e7e5cd'
          : kind === 'state'
            ? '#293c32'
            : '#233b35'
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
      if (layer === 'terrain' && n.id !== selected && total * scale * scale < 8) continue
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
  const settlements = [...spatialState(world).settlements].sort(
    (a, b) => Number(b.capital) - Number(a.capital) || b.population - a.population,
  )
  for (const settlement of settlements) {
    const { capital, kind } = settlement,
      c = world.cells[settlement.cell]
    if (
      layer === 'terrain' &&
      scale < 0.65 &&
      world.regions[settlement.region].nation !== selected &&
      settlement.population < 50000
    )
      continue
    if (!capital && scale < (kind === 'city' ? 0.7 : kind === 'town' ? 1.4 : 3)) continue
    const radius = (capital ? 2.8 : kind === 'city' ? 2.4 : kind === 'town' ? 1.7 : 1) / scale
    ctx.beginPath()
    const dot = project ? project(c.x, c.y) : c
    ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2)
    ctx.fillStyle = '#293d36'
    ctx.fill()
    if (capital) {
      ctx.strokeStyle = '#e9e3c7'
      ctx.lineWidth = 1 / scale
      ctx.stroke()
    }
    place(settlement.name, c.x, c.y + 12 / scale, capital || kind === 'city' ? 11 : 10, 'city')
  }
  for (const label of cache.seaLabels) place(label.name, label.x, label.y, 13, 'sea')
}
