import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  Plus,
  Minus,
  Maximize2,
  MapPin,
  Layers3,
  Info,
  X,
  Users,
  Route,
  Swords,
  Handshake,
  ArrowUpRight,
  ScanSearch,
} from 'lucide-react'
import { HEX } from '../sim/hex'
import { contains, zoomAt } from '../map/geometry'
import { buildAtlas, drawAtlas, drawPlaceLabels, terrainColors } from '../map/renderer'
import { freightOverlay, drawFreight } from '../map/trade'
import { population, type World, type Layer } from '../sim/types'
import { dominantIdentity, identityAxis, identityColor } from '../map/identity'
import { identityDistribution } from '../sim/population'
import { drawWarfare } from '../map/warfare'
import { compact, type Tab } from './Inspector'

interface Props {
  world: World
  mapKey: string
  layer: Layer
  nation: number
  region: number | null
  showRoutes: boolean
  showArmies: boolean
  running: boolean
  focus: { region: number; key: number; nation?: number } | null
  onSelect: (region: number) => void
  onLayer: (layer: Layer) => void
  onInspect: (region: number, section: Tab) => void
  onClear: () => void
  onToggleRoutes: () => void
  onToggleArmies: () => void
  orderMode: boolean
  showContext: boolean
}
const layers: { id: Layer; name: string }[] = [
  { id: 'political', name: 'Political' },
  { id: 'terrain', name: 'Terrain' },
  { id: 'population', name: 'Population' },
  { id: 'culture', name: 'Cultural communities' },
  { id: 'language', name: 'Languages' },
  { id: 'belief', name: 'Beliefs' },
  { id: 'prosperity', name: 'Contentment' },
  { id: 'food', name: 'Food security' },
  { id: 'trade', name: 'Trade' },
  { id: 'military', name: 'Military' },
]
export function WorldMap({
  world,
  mapKey,
  layer,
  nation,
  region,
  showRoutes,
  showArmies,
  running,
  focus,
  onSelect,
  onLayer,
  onInspect,
  onClear,
  onToggleRoutes,
  onToggleArmies,
  orderMode,
  showContext,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null),
    holderRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLCanvasElement | null>(null),
    frame = useRef(0)
  const [size, setSize] = useState({ w: 900, h: 680 }),
    [view, setView] = useState({ zoom: 1, x: 0, y: 0 })
  const [hover, setHover] = useState<{ id: number; x: number; y: number } | null>(null)
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null)
  const [layerMenu, setLayerMenu] = useState(false),
    [legendOpen, setLegendOpen] = useState(false),
    [picked, setPicked] = useState<{ id: number; x: number; y: number } | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ distance: number; center: { x: number; y: number }; view: typeof view } | null>(null)
  useEffect(() => {
    setPicked(null)
    setHover(null)
  }, [mapKey])
  useEffect(() => {
    if (!showContext || orderMode || region === null) setPicked(null)
  }, [showContext, orderMode, region])
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (holderRef.current && !holderRef.current.contains(event.target as Node)) {
        setLayerMenu(false)
        setLegendOpen(false)
        setPicked(null)
      }
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [])
  const axis = identityAxis(layer)
  const dominant = axis ? new Set(world.regions.map((r) => dominantIdentity(r, axis))) : new Set<number>()
  const identityLegend = axis
    ? identityDistribution(
        world.regions.flatMap((r) => r.communities ?? []),
        axis,
      )
        .filter((entry) => dominant.has(entry.id))
        .slice(0, 6)
    : []
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
    const c = world.cells[world.regions[focus.region].center]
    // Focus within the map area left visible beside a dossier (or above its
    // mobile sheet), rather than hiding the selected place behind the panel.
    const narrow = size.w <= 760,
      area = {
        x: 12,
        y: 64,
        w: narrow ? size.w - 24 : Math.max(size.w * 0.5, size.w - 400),
        h: narrow ? Math.max(100, size.h * 0.27 - 70) : size.h - 160,
      }
    let cx = c.x,
      cy = c.y,
      zoom = Math.max(2.2, world.width / 50)
    if (focus.nation !== undefined) {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity
      for (const r of world.regions)
        if (r.nation === focus.nation)
          for (const id of r.cells) {
            const cell = world.cells[id]
            minX = Math.min(minX, cell.x)
            maxX = Math.max(maxX, cell.x)
            minY = Math.min(minY, cell.y)
            maxY = Math.max(maxY, cell.y)
          }
      if (Number.isFinite(minX)) {
        cx = (minX + maxX) / 2
        cy = (minY + maxY) / 2
        zoom = Math.max(
          1,
          Math.min(
            12,
            Math.min(area.w / Math.max(30, maxX - minX), area.h / Math.max(30, maxY - minY)) / fit / 1.25,
          ),
        )
      }
    }
    setView({
      zoom,
      x: (mapW / 2 - cx) * fit * zoom + area.x + area.w / 2 - size.w / 2,
      y: (mapH / 2 - cy) * fit * zoom + area.y + area.h / 2 - size.h / 2,
    })
    // Focus is an explicit command, not a camera reset on each simulation tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])

  useEffect(() => {
    const base = document.createElement('canvas')
    // Cache the visible viewport, never a giant full-world bitmap. Province
    // geometry is repainted at display resolution when the camera changes.
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    base.width = Math.ceil(size.w * dpr)
    base.height = Math.ceil(size.h * dpr)
    const ctx = base.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.translate(offsetX, offsetY)
    ctx.scale(scale, scale)
    drawAtlas(ctx, atlas, world, layer, scale)
    baseRef.current = base
  }, [world, layer, size.w, size.h, offsetX, offsetY, atlas, scale])

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
      if (baseRef.current) ctx.drawImage(baseRef.current, 0, 0, size.w, size.h)
      ctx.save()
      ctx.translate(offsetX, offsetY)
      ctx.scale(scale, scale)
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
      if (showArmies || layer === 'military') drawWarfare(ctx, world, nation)
      if (showArmies || layer === 'military')
        for (const a of world.armies.filter((a) => a.operations?.embarkedOn == null)) {
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
            ctx.strokeStyle = '#a2463bbb'
            ctx.lineWidth = 1.3
            ctx.setLineDash([4, 4])
            ctx.beginPath()
            ctx.moveTo(c.x, c.y)
            for (const id of a.operations?.march ?? []) ctx.lineTo(world.cells[id].x, world.cells[id].y)
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
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === '+' || e.key === '=') {
            e.preventDefault()
            zoom(1.25)
          }
          if (e.key === '-') {
            e.preventDefault()
            zoom(0.8)
          }
          if (e.key === 'Home') {
            e.preventDefault()
            reset()
          }
          if (e.key.startsWith('Arrow')) {
            e.preventDefault()
            setView((v) => ({
              ...v,
              x: v.x + (e.key === 'ArrowLeft' ? 60 : e.key === 'ArrowRight' ? -60 : 0),
              y: v.y + (e.key === 'ArrowUp' ? 60 : e.key === 'ArrowDown' ? -60 : 0),
            }))
          }
          if (e.key === 'Enter' && region !== null) onInspect(region, 'atlas')
          if (e.key === 'Escape') {
            setPicked(null)
            setLayerMenu(false)
            setLegendOpen(false)
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          const found = locate(e.clientX, e.clientY)
          if (found && !orderMode) {
            onSelect(found.id)
            setPicked(found)
            setHover(null)
          }
        }}
        onDoubleClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          setPicked(null)
          zoom(1.6, { x: e.clientX - rect.left, y: e.clientY - rect.top })
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.currentTarget.focus({ preventScroll: true })
          e.currentTarget.setPointerCapture(e.pointerId)
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()],
              rect = e.currentTarget.getBoundingClientRect()
            pinch.current = {
              distance: Math.hypot(a.x - b.x, a.y - b.y),
              center: { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top },
              view,
            }
            drag.current = null
            setPicked(null)
            return
          }
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }
          setHover(null)
        }}
        onPointerMove={(e) => {
          if (pointers.current.has(e.pointerId))
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          if (pinch.current && pointers.current.size >= 2) {
            const [a, b] = [...pointers.current.values()],
              rect = e.currentTarget.getBoundingClientRect(),
              start = pinch.current,
              center = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top },
              next = zoomAt(
                start.view,
                Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, start.distance),
                start.center,
                size,
              )
            setView({ ...next, x: next.x + center.x - start.center.x, y: next.y + center.y - start.center.y })
            return
          }
          if (drag.current) {
            const dx = e.clientX - drag.current.x,
              dy = e.clientY - drag.current.y
            if (Math.hypot(dx, dy) > 4) {
              drag.current.moved = true
              setPicked(null)
            }
            setView((v) => ({ ...v, x: drag.current!.vx + dx, y: drag.current!.vy + dy }))
          } else setHover(locate(e.clientX, e.clientY))
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId)
          if (pinch.current) {
            if (!pointers.current.size) pinch.current = null
            drag.current = null
            return
          }
          if (drag.current && !drag.current.moved) {
            const found = locate(e.clientX, e.clientY)
            if (found) {
              onSelect(found.id)
              if (!orderMode && showContext) setPicked(found)
            } else {
              setPicked(null)
              onClear()
            }
          }
          drag.current = null
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId)
          pinch.current = null
          drag.current = null
        }}
        onPointerLeave={() => setHover(null)}
      />
      <h1 className="visually-hidden">The known world</h1>
      <div className="layer-picker">
        <button
          className="map-button layer-button"
          aria-expanded={layerMenu}
          aria-label={`Map layers: ${layers.find((l) => l.id === layer)?.name}`}
          title="Map layers (L)"
          onClick={() => setLayerMenu(!layerMenu)}
        >
          <Layers3 size={15} />
          <span className="map-layer-name">{layers.find((l) => l.id === layer)?.name}</span>
          <span className="shortcut">L</span>
        </button>
        {layerMenu && (
          <div className="layer-menu" aria-label="Map layers and overlays">
            <div className="map-menu-heading">
              Map layers
              <button
                className="icon-button"
                aria-label="Close map layers"
                onClick={() => setLayerMenu(false)}
              >
                <X size={15} />
              </button>
            </div>
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
            <div className="layer-overlays">
              <button aria-pressed={showRoutes} onClick={onToggleRoutes}>
                <Route size={15} />
                Trade routes{showRoutes && <Check size={13} />}
              </button>
              <button aria-pressed={showArmies} onClick={onToggleArmies}>
                <Swords size={15} />
                Armies & fleets{showArmies && <Check size={13} />}
              </button>
            </div>
          </div>
        )}
      </div>
      <button
        className="map-key-toggle"
        aria-expanded={legendOpen}
        aria-controls="map-key"
        onClick={() => setLegendOpen((v) => !v)}
      >
        <Info size={14} />
        Map key
      </button>
      {legendOpen && (
        <div id="map-key" className={`map-legend ${layer !== 'political' ? 'thematic-legend' : ''}`}>
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
          ) : axis ? (
            <div className="identity-map-legend">
              <span>Largest community in each province · populations are mixed</span>
              <div>
                {identityLegend.map((entry) => (
                  <span key={entry.id}>
                    <i style={{ background: identityColor(entry.id) }} />
                    {world.demography?.identities[entry.id]?.name}
                  </span>
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
              <span>Army border and hull color identify the state</span>
              <span>Mint dashes: last supply deliveries · ships show fleet size</span>
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
      )}
      <div className="map-scale">
        <span />
        <small>{Math.round(((65 / scale) * 4) / 10) * 10} km</small>
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
      {picked && showContext && !orderMode && world.regions[picked.id] && (
        <div
          className="place-context"
          role="region"
          aria-label="Selected province actions"
          style={{
            left: Math.max(12, Math.min(picked.x + 14, size.w - 290)),
            top: Math.max(70, Math.min(picked.y + 14, size.h - 350)),
          }}
        >
          <div className="place-context-heading">
            <MapPin size={16} />
            <h2>{world.regions[picked.id].name}</h2>
            <button
              className="icon-button"
              aria-label="Dismiss province actions"
              onClick={() => setPicked(null)}
            >
              <X size={16} />
            </button>
          </div>
          <button className="place-owner" onClick={() => onInspect(picked.id, 'diplomacy')}>
            {world.nations[world.regions[picked.id].nation].name}
            <ArrowUpRight size={13} />
          </button>
          <p>
            {compact(population(world.regions[picked.id]))} people <span>·</span>{' '}
            {world.regions[picked.id].terrain}
          </p>
          <div className="place-quick-actions">
            {(
              [
                { id: 'population', label: 'People', icon: Users },
                { id: 'economy', label: 'Trade', icon: Route },
                { id: 'military', label: 'Forces', icon: Swords },
                { id: 'diplomacy', label: 'Diplomacy', icon: Handshake },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => onInspect(picked.id, id)}>
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
          <div className="place-context-footer">
            <button className="text-button" onClick={() => onInspect(picked.id, 'atlas')}>
              Open dossier
              <ArrowUpRight size={14} />
            </button>
            <button
              className="icon-button"
              aria-label="Focus selected province"
              title="Focus this province"
              onClick={() => {
                const c = world.cells[world.regions[picked.id].center],
                  zoom = Math.max(3, world.width / 45)
                setView({ zoom, x: (mapW / 2 - c.x) * fit * zoom, y: (mapH / 2 - c.y) * fit * zoom })
                setPicked(null)
              }}
            >
              <ScanSearch size={17} />
            </button>
          </div>
        </div>
      )}
      {hover && !picked && !drag.current && (
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
