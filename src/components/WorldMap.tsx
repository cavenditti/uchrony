import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Plus, Minus, Maximize2, MapPin, Layers3, Navigation } from 'lucide-react'
import { HEX } from '../sim/hex'
import { geographyKey, contains, zoomAt } from '../map/geometry'
import { buildAtlas, drawAtlas, drawPlaceLabels, terrainColors } from '../map/renderer'
import { freightOverlay, drawFreight } from '../map/trade'
import { population, type World, type Layer } from '../sim/types'

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
const layers: { id: Layer; name: string }[] = [
  { id: 'political', name: 'Political' },
  { id: 'terrain', name: 'Terrain' },
  { id: 'population', name: 'Population' },
  { id: 'prosperity', name: 'Contentment' },
  { id: 'food', name: 'Food security' },
  { id: 'trade', name: 'Trade' },
  { id: 'military', name: 'Military' },
]
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
  const freight = useMemo(() => freightOverlay(world, nation, region), [world, nation, region])
  const mapKey = geographyKey(world.cells)
  const atlas = useMemo(() => buildAtlas(world), [mapKey])
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
  }, [mapKey, reset])
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
    base.width = Math.ceil(mapW * 2)
    base.height = Math.ceil(mapH * 2)
    const ctx = base.getContext('2d')!
    ctx.scale(2, 2)
    drawAtlas(ctx, atlas, world, layer, scale)
    baseRef.current = base
  }, [world, layer, mapW, mapH, atlas, scale])

  const [fontReady, setFontReady] = useState(false)
  useEffect(() => {
    let active = true
    document.fonts.ready.then(() => {
      if (active) setFontReady(true)
    })
    return () => {
      active = false
    }
  }, [])

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
      ctx.fillStyle = '#243f49'
      ctx.fillRect(0, 0, size.w, size.h)
      ctx.save()
      ctx.translate(offsetX, offsetY)
      ctx.scale(scale, scale)
      if (baseRef.current) ctx.drawImage(baseRef.current, 0, 0, mapW, mapH)
      if (showRoutes || layer === 'trade')
        drawFreight(ctx, world, freight, scale, time, layer === 'trade', running && !reduced)
      ctx.save()
      ctx.clip(atlas.land, 'evenodd')
      ctx.strokeStyle = '#f4e8bd'
      ctx.lineWidth = 1.7 / scale
      if (region !== null) {
        ctx.stroke(atlas.provinces[region])
      } else {
        ctx.beginPath()
        for (const e of atlas.geometry.edges) {
          const left = world.regions[e.left].nation === nation
          const right = world.regions[e.right].nation === nation
          if (left !== right) {
            ctx.moveTo(e.a.x, e.a.y)
            ctx.lineTo(e.b.x, e.b.y)
          }
        }
        for (const e of atlas.geometry.shores)
          if (world.regions[e.left].nation === nation) {
            ctx.moveTo(e.a.x, e.a.y)
            ctx.lineTo(e.b.x, e.b.y)
          }
        ctx.stroke()
      }
      if (hover && hover.id !== region) {
        ctx.fillStyle = '#f5efd72b'
        ctx.fill(atlas.provinces[hover.id], 'evenodd')
      }
      ctx.restore()
      drawPlaceLabels(
        ctx,
        atlas,
        world,
        layer,
        scale,
        { x: offsetX, y: offsetY, w: size.w, h: size.h },
        nation,
      )
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
    atlas,
    fontReady,
    freight,
  ])

  const locate = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect(),
      { scale, offsetX, offsetY } = transforms.current
    const x = (clientX - rect.left - offsetX) / scale,
      y = (clientY - rect.top - offsetY) / scale
    // Hit-test the rendered province polygons, including islands and holes.
    for (let id = 0; id < atlas.geometry.provinces.length; id++) {
      const b = atlas.geometry.bounds[id]
      if (
        x >= b.minX &&
        x <= b.maxX &&
        y >= b.minY &&
        y <= b.maxY &&
        contains(atlas.geometry.provinces[id], x, y)
      )
        return { id, x: clientX - rect.left, y: clientY - rect.top }
    }
    return null
  }
  const zoom = (factor: number, point = { x: size.w / 2, y: size.h / 2 }) =>
    setView((v) => zoomAt(v, factor, point, size))
  useEffect(() => {
    const canvas = canvasRef.current!
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      zoom(e.deltaY > 0 ? 0.91 : 1.1, { x: e.clientX - rect.left, y: e.clientY - rect.top })
    }
    canvas.addEventListener('wheel', handler, { passive: false })
    return () => canvas.removeEventListener('wheel', handler)
  }, [size])

  return (
    <div className="map-canvas-wrap" data-layer={layer} ref={holderRef}>
      <canvas
        ref={canvasRef}
        className="world-canvas"
        aria-label="Interactive generated world map. Drag to pan, scroll to zoom. Select a state from the list for keyboard access."
        role="img"
        onDoubleClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          zoom(1.6, { x: e.clientX - rect.left, y: e.clientY - rect.top })
        }}
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
              Road <i className="legend-route sea" />
              Shipping <i className="legend-harbor" />
              Harbor
            </span>
            <span>Width = monthly tonnage · shared corridors</span>
            <span>
              Highlighted: {region === null ? world.nations[nation].shortName : world.regions[region].name}{' '}
              imports &amp; exports
            </span>
            {freight.legacy && <span>Advance one month to refresh saved routes.</span>}
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
