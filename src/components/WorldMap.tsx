import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Plus, Minus, Maximize2, MapPin, Layers3, Navigation } from 'lucide-react'
import { HEX, neighbors } from '../sim/generate'
import { population, type World, type Layer, type Cell } from '../sim/types'

interface Props {
  world: World
  layer: Layer
  nation: number
  region: number | null
  showRoutes: boolean
  showArmies: boolean
  running: boolean
  focus: { region: number; key: number } | null
  onSelect: (region: number) => void
  onLayer: (layer: Layer) => void
}
const terrainColors = {
  plains: '#b7bd8b',
  forest: '#819c75',
  hills: '#a8a282',
  mountains: '#b9b4a5',
  desert: '#cabe92',
  tundra: '#bcc8bb',
  water: '#304f55',
}
const layers: { id: Layer; name: string }[] = [
  { id: 'political', name: 'Political' },
  { id: 'terrain', name: 'Terrain' },
  { id: 'population', name: 'Population' },
  { id: 'prosperity', name: 'Contentment' },
  { id: 'food', name: 'Food security' },
  { id: 'trade', name: 'Trade' },
  { id: 'military', name: 'Military' },
]
const hexVertices = Array.from({ length: 6 }, (_, i) => {
  const a = ((i * 60 - 90) * Math.PI) / 180
  return [Math.cos(a), Math.sin(a)]
})
const edgeIndex = [4, 1, 5, 0, 3, 2]

function color(hex: string, light: number): string {
  const num = parseInt(hex.slice(1), 16),
    r = num >> 16,
    g = (num >> 8) & 255,
    b = num & 255
  return `rgb(${Math.round(Math.min(255, Math.max(0, r + light)))},${Math.round(Math.min(255, Math.max(0, g + light)))},${Math.round(Math.min(255, Math.max(0, b + light)))})`
}
function hexagon(ctx: CanvasRenderingContext2D, c: Cell, extra = 0) {
  ctx.beginPath()
  hexVertices.forEach(([vx, vy], i) => {
    const x = c.x + vx * (HEX + extra),
      y = c.y + vy * (HEX + extra)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.closePath()
}
function boundary(ctx: CanvasRenderingContext2D, c: Cell, edge: number) {
  const v1 = hexVertices[edge],
    v2 = hexVertices[(edge + 1) % 6]
  ctx.moveTo(c.x + v1[0] * HEX, c.y + v1[1] * HEX)
  ctx.lineTo(c.x + v2[0] * HEX, c.y + v2[1] * HEX)
}

export function WorldMap({
  world,
  layer,
  nation,
  region,
  showRoutes,
  showArmies,
  running,
  focus,
  onSelect,
  onLayer,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null),
    holderRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLCanvasElement | null>(null),
    frame = useRef(0)
  const [size, setSize] = useState({ w: 900, h: 680 }),
    [view, setView] = useState({ zoom: 1, x: 0, y: 0 })
  const [hover, setHover] = useState<{ id: number; x: number; y: number } | null>(null)
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null)
  const [layerMenu, setLayerMenu] = useState(false)
  const maxPopulationDensity = Math.max(...world.regions.map((r) => population(r) / r.cells.length))
  const quantitativeLegend =
    layer === 'population'
      ? {
          label: 'People per hex · square-root scale',
          colors: '#c7d1a4, #3a7661',
          ticks: [0, maxPopulationDensity / 4, maxPopulationDensity].map((n) =>
            Math.round(n).toLocaleString(),
          ),
        }
      : layer === 'prosperity'
        ? { label: 'Public contentment', colors: '#bf7a69, #6eb284', ticks: ['0%', '50%', '100%'] }
        : layer === 'food'
          ? { label: 'Food needs met', colors: '#bf5c50, #84ae80', ticks: ['0%', '50%', '100%'] }
          : null
  const mapW = world.width * Math.sqrt(3) * HEX,
    mapH = world.height * HEX * 1.5
  const fit = Math.min(size.w / mapW, size.h / mapH) * 0.98
  const scale = fit * view.zoom,
    offsetX = (size.w - mapW * scale) / 2 + view.x,
    offsetY = (size.h - mapH * scale) / 2 + view.y
  const transforms = useRef({ scale, offsetX, offsetY })
  transforms.current = { scale, offsetX, offsetY }
  const reset = useCallback(() => setView({ zoom: 1, x: 0, y: 0 }), [])

  useEffect(() => {
    const holder = holderRef.current
    if (!holder) return
    const observer = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      setSize({ w: r.width, h: r.height })
    })
    observer.observe(holder)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    reset()
  }, [world.seed, reset])
  useEffect(() => {
    if (!focus || !world.regions[focus.region]) return
    const c = world.cells[world.regions[focus.region].center],
      zoom = 2.2
    setView({ zoom, x: (mapW / 2 - c.x) * fit * zoom, y: (mapH / 2 - c.y) * fit * zoom })
    // Focus is an explicit command, not a camera reset on each simulation tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])

  useEffect(() => {
    const base = document.createElement('canvas')
    base.width = Math.ceil(mapW + 20)
    base.height = Math.ceil(mapH + 20)
    const ctx = base.getContext('2d')!
    ctx.fillStyle = '#304e54'
    ctx.fillRect(0, 0, base.width, base.height)
    const maxPop = Math.max(...world.regions.map((r) => population(r) / r.cells.length))
    for (const c of world.cells) {
      let fill: string
      if (c.terrain === 'water') {
        const shore = Math.max(0, Math.min(1, (c.elevation + 0.13) / 0.225))
        fill = `rgb(${Math.round(43 + shore * 20)},${Math.round(72 + shore * 23)},${Math.round(80 + shore * 17)})`
      } else {
        const r = world.regions[c.region],
          n = world.nations[r.nation]
        const shade = (c.elevation - 0.28) * 27 + (c.moisture - 0.5) * 9
        if (layer === 'terrain') fill = color(terrainColors[c.terrain], shade)
        else if (layer === 'population') {
          const t = Math.sqrt(population(r) / r.cells.length / maxPop)
          fill = `rgb(${Math.round(199 - t * 141)},${Math.round(209 - t * 91)},${Math.round(164 - t * 67)})`
        } else if (layer === 'prosperity') {
          const t = r.happiness
          fill = `rgb(${Math.round(191 - t * 81)},${Math.round(122 + t * 56)},${Math.round(105 + t * 27)})`
        } else if (layer === 'food') {
          const t = r.foodCoverage
          fill = `rgb(${Math.round(191 - t * 59)},${Math.round(92 + t * 82)},${Math.round(80 + t * 48)})`
        } else
          fill = color(n.color, shade - (c.terrain === 'forest' ? 10 : c.terrain === 'mountains' ? 13 : 0))
      }
      ctx.fillStyle = fill
      hexagon(ctx, c, 0.25)
      ctx.fill()
    }
    // Thin internal divisions and coast edges expose the actual simulation geography.
    const coast = new Path2D(),
      borders = new Path2D(),
      provinceLines = new Path2D()
    for (const c of world.cells)
      if (c.terrain !== 'water') {
        const ids = neighbors(c.id, world.width, world.height)
        ids.forEach((id, j) => {
          const other = world.cells[id],
            edge = edgeIndex[j]
          const a = hexVertices[edge],
            b = hexVertices[(edge + 1) % 6]
          const path =
            other.terrain === 'water'
              ? coast
              : world.regions[other.region]?.nation !== world.regions[c.region].nation
                ? borders
                : other.region !== c.region
                  ? provinceLines
                  : null
          if (path) {
            path.moveTo(c.x + a[0] * HEX, c.y + a[1] * HEX)
            path.lineTo(c.x + b[0] * HEX, c.y + b[1] * HEX)
          }
        })
        if (c.river) {
          ctx.strokeStyle = '#4b8588'
          ctx.lineWidth = 1.3
          ctx.beginPath()
          for (const id of ids)
            if (world.cells[id].river || world.cells[id].terrain === 'water') {
              ctx.moveTo(c.x, c.y)
              ctx.lineTo(world.cells[id].x, world.cells[id].y)
            }
          ctx.stroke()
        }
        if ((c.id * 17) % 7 === 0 && ['mountains', 'hills', 'forest'].includes(c.terrain)) {
          ctx.strokeStyle = c.terrain === 'forest' ? '#38513f55' : '#4e51486b'
          ctx.lineWidth = 0.75
          ctx.beginPath()
          if (c.terrain === 'forest') {
            ctx.moveTo(c.x - 2, c.y + 2)
            ctx.lineTo(c.x, c.y - 2.5)
            ctx.lineTo(c.x + 2, c.y + 2)
            ctx.moveTo(c.x, c.y - 1)
            ctx.lineTo(c.x, c.y + 3)
          } else {
            ctx.moveTo(c.x - 4, c.y + 2)
            ctx.lineTo(c.x, c.y - (c.terrain === 'mountains' ? 5 : 2))
            ctx.lineTo(c.x + 4, c.y + 2)
            ctx.moveTo(c.x, c.y - 5)
            ctx.lineTo(c.x + 1, c.y + 1)
          }
          ctx.stroke()
        }
      }
    ctx.strokeStyle = '#34493928'
    ctx.lineWidth = 0.65
    ctx.stroke(provinceLines)
    ctx.strokeStyle = '#243b38a0'
    ctx.lineWidth = 1.6
    ctx.stroke(borders)
    ctx.strokeStyle = '#d3d7b94d'
    ctx.lineWidth = 5
    ctx.stroke(coast)
    ctx.strokeStyle = '#1c3d3e'
    ctx.lineWidth = 1.4
    ctx.stroke(coast)
    // Geographic graticule sits behind interface overlays and scales with the atlas.
    ctx.strokeStyle = '#d7e3da0b'
    ctx.lineWidth = 0.7
    for (let x = 0; x < mapW; x += 170) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, mapH)
      ctx.stroke()
    }
    for (let y = 0; y < mapH; y += 126) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(mapW, y)
      ctx.stroke()
    }
    baseRef.current = base
  }, [world, layer, mapW, mapH])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = size.w * dpr
    canvas.height = size.h * dpr
    const ctx = canvas.getContext('2d')!
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const draw = (time: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, size.w, size.h)
      ctx.fillStyle = '#304e54'
      ctx.fillRect(0, 0, size.w, size.h)
      ctx.save()
      ctx.translate(offsetX, offsetY)
      ctx.scale(scale, scale)
      if (baseRef.current) ctx.drawImage(baseRef.current, 0, 0)
      if (showRoutes || layer === 'trade') {
        const visible = [...world.routes].sort((a, b) => b.volume - a.volume).slice(0, 100)
        for (const [index, route] of visible.entries()) {
          const points = route.path.map((id) => world.cells[world.regions[id].center])
          if (points.length < 2) continue
          ctx.strokeStyle = route.sea ? '#e8d3a599' : '#64503480'
          ctx.lineWidth = Math.max(0.8, Math.min(2.3, route.volume / 800))
          ctx.setLineDash(route.sea ? [4, 5] : [])
          ctx.beginPath()
          points.forEach((p, i) => {
            if (i === 0) ctx.moveTo(p.x, p.y)
            else ctx.lineTo(p.x, p.y)
          })
          ctx.stroke()
          ctx.setLineDash([])
          const phase = ((running && !reduced ? time / 2400 : 0.4) + index * 0.137) % 1,
            progress = phase * (points.length - 1)
          const i = Math.min(points.length - 2, Math.floor(progress)),
            t = progress - i
          ctx.fillStyle = route.sea ? '#f4dfa8' : '#f5ebd1'
          ctx.beginPath()
          ctx.arc(
            points[i].x + (points[i + 1].x - points[i].x) * t,
            points[i].y + (points[i + 1].y - points[i].y) * t,
            1.6 / Math.sqrt(scale),
            0,
            Math.PI * 2,
          )
          ctx.fill()
        }
      }
      ctx.beginPath()
      for (const c of world.cells)
        if (
          c.region >= 0 &&
          (region !== null ? c.region === region : world.regions[c.region].nation === nation)
        ) {
          neighbors(c.id, world.width, world.height).forEach((id, j) => {
            const o = world.cells[id]
            if (
              o.terrain === 'water' ||
              (region !== null ? o.region !== region : world.regions[o.region]?.nation !== nation)
            )
              boundary(ctx, c, edgeIndex[j])
          })
        }
      ctx.strokeStyle = '#f4e8bd'
      ctx.lineWidth = 2.4 / Math.sqrt(scale)
      ctx.stroke()
      if (hover && hover.id !== region) {
        ctx.fillStyle = '#f5efd72b'
        for (const id of world.regions[hover.id].cells) {
          hexagon(ctx, world.cells[id])
          ctx.fill()
        }
      }
      for (const r of world.regions) {
        const capital = world.nations[r.nation].capital === r.id
        if (!capital && scale < 0.8 && r.id % 3 !== 0) continue
        const c = world.cells[r.center],
          radius = capital ? 3.1 : 1.1
        ctx.fillStyle = '#273a32'
        ctx.strokeStyle = '#f1e9cd'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(c.x, c.y, radius / Math.sqrt(scale), 0, Math.PI * 2)
        ctx.fill()
        if (capital) {
          ctx.stroke()
          ctx.beginPath()
          ctx.arc(c.x, c.y, 5.2 / Math.sqrt(scale), 0, Math.PI * 2)
          ctx.strokeStyle = '#233b35'
          ctx.lineWidth = 0.65
          ctx.stroke()
        }
        if (capital || scale > 1.4) {
          ctx.font = `${capital ? 10 : 8.5}px 'Alegreya', Georgia, serif`
          ctx.textAlign = 'left'
          ctx.fillStyle = '#263b32'
          ctx.fillText(r.name, c.x + 7, c.y + 3)
        }
      }
      if (layer === 'political' || layer === 'terrain' || layer === 'military') {
        for (const n of world.nations) {
          const regions = world.regions.filter((r) => r.nation === n.id)
          if (!regions.length) continue
          const centerX = regions.reduce((s, r) => s + world.cells[r.center].x, 0) / regions.length
          const centerY = regions.reduce((s, r) => s + world.cells[r.center].y, 0) / regions.length
          const anchor = regions.reduce((best, r) =>
            Math.hypot(world.cells[r.center].x - centerX, world.cells[r.center].y - centerY) <
            Math.hypot(world.cells[best.center].x - centerX, world.cells[best.center].y - centerY)
              ? r
              : best,
          )
          const c = world.cells[anchor.center]
          ctx.font = `500 ${Math.min(21, 12 + regions.length * 0.23)}px 'Alegreya', Georgia, serif`
          ctx.textAlign = 'center'
          ctx.strokeStyle = '#e7e3c777'
          ctx.lineWidth = 2.8
          ctx.lineJoin = 'round'
          const text = n.shortName.toUpperCase().split('').join(' ')
          ctx.strokeText(text, c.x, c.y - 19)
          ctx.fillStyle = '#283b32'
          ctx.fillText(text, c.x, c.y - 19)
        }
      }
      if (showArmies || layer === 'military')
        for (const a of world.armies) {
          const c = world.cells[world.regions[a.region].center]
          const x = c.x - 12,
            y = c.y + 14
          ctx.fillStyle = '#24343a'
          ctx.strokeStyle = world.nations[a.nation].color
          ctx.lineWidth = 1.5
          ctx.fillRect(x - 10, y - 7, 30, 15)
          ctx.strokeRect(x - 10, y - 7, 30, 15)
          ctx.font = '8px system-ui'
          ctx.textAlign = 'center'
          ctx.fillStyle = '#f0e9d8'
          ctx.fillText(`${(a.soldiers / 1000).toFixed(1)}k`, x + 5, y + 3)
          if (a.target !== null) {
            const t = world.cells[world.regions[a.target].center]
            ctx.strokeStyle = '#a2463bbb'
            ctx.lineWidth = 1.3
            ctx.setLineDash([4, 4])
            ctx.beginPath()
            ctx.moveTo(c.x, c.y)
            ctx.lineTo(t.x, t.y)
            ctx.stroke()
            ctx.setLineDash([])
          }
        }
      ctx.font = 'italic 15px Alegreya, Georgia, serif'
      ctx.fillStyle = '#c8d4ce88'
      ctx.textAlign = 'center'
      ctx.fillText('The Still Sea', mapW * 0.25, mapH * 0.88)
      ctx.fillText('Eastern Reaches', mapW * 0.86, mapH * 0.2)
      ctx.restore()
      if (running && !reduced && (showRoutes || layer === 'trade'))
        frame.current = requestAnimationFrame(draw)
    }
    frame.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame.current)
  }, [
    world,
    layer,
    nation,
    region,
    showRoutes,
    showArmies,
    running,
    size,
    scale,
    offsetX,
    offsetY,
    hover,
    mapW,
    mapH,
  ])

  const locate = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect(),
      { scale, offsetX, offsetY } = transforms.current
    const x = (clientX - rect.left - offsetX) / scale,
      y = (clientY - rect.top - offsetY) / scale
    const row = Math.round(y / (HEX * 1.5)),
      col = Math.round(x / (Math.sqrt(3) * HEX) - (row % 2) / 2)
    if (row < 0 || col < 0 || row >= world.height || col >= world.width) return null
    const c = world.cells[row * world.width + col]
    return c?.region >= 0 ? { id: c.region, x: clientX - rect.left, y: clientY - rect.top } : null
  }
  const zoom = (factor: number) =>
    setView((v) => ({ ...v, zoom: Math.max(0.65, Math.min(5, v.zoom * factor)) }))
  useEffect(() => {
    const canvas = canvasRef.current!
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      zoom(e.deltaY > 0 ? 0.91 : 1.1)
    }
    canvas.addEventListener('wheel', handler, { passive: false })
    return () => canvas.removeEventListener('wheel', handler)
  }, [])

  return (
    <div className="map-canvas-wrap" data-layer={layer} ref={holderRef}>
      <canvas
        ref={canvasRef}
        className="world-canvas"
        aria-label="Interactive generated world map. Drag to pan, scroll to zoom. Select a state from the list for keyboard access."
        role="img"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }
          setHover(null)
        }}
        onPointerMove={(e) => {
          if (drag.current) {
            const dx = e.clientX - drag.current.x,
              dy = e.clientY - drag.current.y
            if (Math.hypot(dx, dy) > 4) drag.current.moved = true
            setView((v) => ({ ...v, x: drag.current!.vx + dx, y: drag.current!.vy + dy }))
          } else setHover(locate(e.clientX, e.clientY))
        }}
        onPointerUp={(e) => {
          if (drag.current && !drag.current.moved) {
            const found = locate(e.clientX, e.clientY)
            if (found) onSelect(found.id)
          }
          drag.current = null
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
        onPointerLeave={() => setHover(null)}
      />
      <div className="map-title">
        <h1>The known world</h1>
        <span>
          {world.regions.length} provinces · {world.nations.filter((n) => n.population > 0).length} sovereign
          states
        </span>
      </div>
      <div className="layer-picker">
        <button
          className="map-button layer-button"
          aria-expanded={layerMenu}
          onClick={() => setLayerMenu(!layerMenu)}
        >
          <Layers3 size={15} />
          {layers.find((l) => l.id === layer)?.name}
          <span className="shortcut">L</span>
        </button>
        {layerMenu && (
          <div className="layer-menu">
            {layers.map((l) => (
              <button
                key={l.id}
                className={layer === l.id ? 'selected' : ''}
                onClick={() => {
                  onLayer(l.id)
                  setLayerMenu(false)
                }}
              >
                {l.name}
                {l.id === layer && <Check size={13} aria-hidden="true" />}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className={`map-legend ${layer !== 'political' ? 'thematic-legend' : ''}`}>
        {quantitativeLegend ? (
          <div className="quantitative-legend">
            <span>{quantitativeLegend.label}</span>
            <div
              className="legend-ramp"
              style={{ background: `linear-gradient(to right, ${quantitativeLegend.colors})` }}
            />
            <div className="legend-ticks">
              {quantitativeLegend.ticks.map((tick, i) => (
                <span key={i}>{tick}</span>
              ))}
            </div>
          </div>
        ) : layer === 'terrain' ? (
          <div className="terrain-legend">
            {Object.entries(terrainColors)
              .filter(([name]) => name !== 'water')
              .map(([name, fill]) => (
                <span key={name}>
                  <i style={{ background: fill }} />
                  {name}
                </span>
              ))}
          </div>
        ) : layer === 'trade' ? (
          <div className="symbol-legend">
            <span>
              <i className="legend-route" />
              Land freight <i className="legend-route sea" />
              Sea freight
            </span>
            <span>Wider strokes = more goods · territorial colors</span>
          </div>
        ) : layer === 'military' ? (
          <div className="symbol-legend">
            <span>
              <i className="legend-army">1.0k</i>Troops <i className="legend-order" />
              March order
            </span>
            <span>Army border and land color identify the state</span>
          </div>
        ) : (
          <>
            <span className="legend-line" />
            Sovereign borders
            <span className="legend-capital" />
            Capital
          </>
        )}
      </div>
      <div className="map-scale">
        <span />
        <small>{Math.round(((65 / scale) * 4) / 10) * 10} km</small>
      </div>
      <div className="map-compass">
        <Navigation size={24} strokeWidth={1} />
        <span>N</span>
      </div>
      <div className="zoom-controls">
        <button aria-label="Zoom in" title="Zoom in" onClick={() => zoom(1.25)}>
          <Plus size={17} />
        </button>
        <button aria-label="Zoom out" title="Zoom out" onClick={() => zoom(0.8)}>
          <Minus size={17} />
        </button>
        <button aria-label="Fit world to map" title="Fit world" onClick={reset}>
          <Maximize2 size={15} />
        </button>
      </div>
      {hover && !drag.current && (
        <div
          className="map-tooltip"
          style={{ left: Math.min(hover.x + 15, size.w - 205), top: Math.min(hover.y + 15, size.h - 88) }}
        >
          <strong>
            <MapPin size={12} />
            {world.regions[hover.id].name}
          </strong>
          <span>{world.nations[world.regions[hover.id].nation].name}</span>
          <small>
            {population(world.regions[hover.id]).toLocaleString()} people · {world.regions[hover.id].terrain}
          </small>
        </div>
      )}
    </div>
  )
}
