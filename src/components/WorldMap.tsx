import { METERS_PER_MAP_UNIT } from '../sim/physical-space'
import type { SpatialBounds } from '../sim/adaptive-types'
import { districtDensityScale, spatialState, type Settlement } from '../sim/spatial'
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
  Mountain,
  Map as MapIcon,
  Orbit,
} from 'lucide-react'
import type { ReliefMap } from '../map/relief'
import { terrainHeight } from '../map/relief-field'
import { resizeCanvas } from '../map/render-budget'
import { HEX } from '../sim/hex'
import { contains, zoomAt } from '../map/geometry'
import { buildAtlas, drawAtlas, drawPlaceLabels, terrainColors } from '../map/renderer'
import { freightOverlay, drawFreight } from '../map/trade'
import { population, type World, type Layer } from '../sim/types'
import { dominantIdentity, identityAxis, identityColor } from '../map/identity'
import { censusOf, mergeCensuses, censusDistribution } from '../sim/view-snapshot'
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
  focus: { region: number; key: number; nation?: number; settlement?: string } | null
  onInspectDaily?: (cell: number) => void
  onInspectArea?: (bounds: SpatialBounds) => void
  onInspectionViewport?: (bounds: SpatialBounds) => void
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
  onInspectDaily,
  onInspectArea,
  onInspectionViewport,
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
  const reliefCanvasRef = useRef<HTMLCanvasElement>(null)
  const reliefRef = useRef<ReliefMap | null>(null)
  const [presentation, setPresentation] = useState<'relief' | 'atlas'>('relief')
  const [tilt, setTilt] = useState(true)
  const [reliefReady, setReliefReady] = useState<string | null>(null)
  const [reliefError, setReliefError] = useState(false)
  const [motionAllowed, setMotionAllowed] = useState(
    () => !document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setMotionAllowed(!document.hidden && !media.matches)
    media.addEventListener('change', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      media.removeEventListener('change', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  const isRelief = presentation === 'relief' && reliefReady === mapKey
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
  const identityLegend = useMemo(() => {
    if (!axis) return []
    const dominant = new Set(world.regions.map((r) => dominantIdentity(r, axis)))
    return censusDistribution(mergeCensuses(world.regions.map((r) => censusOf(r, world.month))), axis)
      .filter((entry) => dominant.has(entry.id))
      .slice(0, 6)
  }, [world, axis])
  const populationScale = useMemo(() => districtDensityScale(world), [world])
  const quantitativeLegend =
    layer === 'population'
      ? {
          label: 'District people / cell · log scale',
          colors: '#c7d1a4, #3a7661',
          ticks: [0, populationScale.midpoint, populationScale.maximum].map((n) =>
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
  const verticalFactor = isRelief && tilt ? Math.sin(Math.PI * 0.29) : 1
  const fit = Math.min(size.w / mapW, size.h / (mapH * verticalFactor)) * 0.94
  const scale = fit * view.zoom,
    offsetX = (size.w - mapW * scale) / 2 + view.x,
    offsetY = (size.h - mapH * scale) / 2 + view.y
  // Content revisions exclude camera-only changes. ReliefMap separately refreshes
  // its visible-area texture when a pan, tilt or zoom needs new coverage.
  const overlayRevision = useMemo(
    () => ({}),
    [world, layer, nation, region, showRoutes, showArmies, running, scale, hover?.id, atlas],
  )
  const transforms = useRef({ scale, offsetX, offsetY })
  transforms.current = { scale, offsetX, offsetY }
  const resizeMetrics = useRef({ fit, mapW, mapH, verticalFactor })
  resizeMetrics.current = { fit, mapW, mapH, verticalFactor }
  const reset = useCallback(() => setView({ zoom: 1, x: 0, y: 0 }), [])
  const inspectionViewport = useRef(onInspectionViewport)
  inspectionViewport.current = onInspectionViewport
  const inspecting = !!onInspectionViewport
  const inspectionBounds = () => {
    const center = isRelief ? reliefRef.current?.locate(size.w / 2, size.h / 2) : undefined
    const meters = world.adaptive?.metersPerMapUnit ?? METERS_PER_MAP_UNIT
    const x = (center?.x ?? mapW / 2 - view.x / scale) * meters
    const y = (center?.y ?? mapH / 2 - view.y / (scale * verticalFactor)) * meters
    const span = Math.min(12000, Math.max(500, Math.min(size.w, size.h) / scale * meters))
    return { x: x - span / 2, y: y - span / 2, size: span }
  }
  useEffect(() => {
    if (!inspecting) return
    const timer = setTimeout(() => {
      inspectionViewport.current?.(inspectionBounds())
    }, 250)
    return () => clearTimeout(timer)
  }, [inspecting, view, size, scale, isRelief, verticalFactor, mapKey])

  useEffect(() => {
    const holder = holderRef.current
    if (!holder) return
    const observer = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      // Hidden panels can briefly report zero size. Preserve both the last
      // usable canvas and the geographic center across genuine resizes.
      if (r.width < 1 || r.height < 1) return
      const previous = resizeMetrics.current
      const nextFit =
        Math.min(r.width / previous.mapW, r.height / (previous.mapH * previous.verticalFactor)) * 0.94
      const ratio = nextFit / previous.fit
      resizeMetrics.current = { ...previous, fit: nextFit }
      setView((v) => ({ ...v, x: v.x * ratio, y: v.y * ratio }))
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
    if (focus.settlement) {
      const city = spatialState(world).settlements.find((s) => s.id === focus.settlement)
      if (city) {
        exploreCity(city)
        return
      }
    }
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
      y: (mapH / 2 - cy) * fit * zoom * verticalFactor + area.y + area.h / 2 - size.h / 2,
    })
    // Focus is an explicit command, not a camera reset on each simulation tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])

  useEffect(() => {
    let active = true
    setReliefReady(null)
    setReliefError(false)
    const canvas = reliefCanvasRef.current!
    const lost = (event: Event) => {
      event.preventDefault()
      setReliefReady(null)
      setReliefError(true)
      setPresentation('atlas')
    }
    canvas.addEventListener('webglcontextlost', lost)
    void import('../map/relief')
      .then(({ ReliefMap }) => {
        if (!active) return
        try {
          reliefRef.current = new ReliefMap(canvas, world, atlas)
          setReliefReady(mapKey)
        } catch (error) {
          console.warn('3D map unavailable; using the atlas.', error)
          setReliefError(true)
          setPresentation('atlas')
        }
      })
      .catch(() => {
        if (active) {
          setReliefError(true)
          setPresentation('atlas')
        }
      })
    return () => {
      active = false
      canvas.removeEventListener('webglcontextlost', lost)
      reliefRef.current?.dispose()
      reliefRef.current = null
    }
  }, [atlas])

  useEffect(() => {
    if (!isRelief || !reliefRef.current) return
    reliefRef.current.setCamera({ w: size.w, h: size.h, scale, x: view.x, y: view.y, tilt })
  }, [isRelief, size, scale, view.x, view.y, tilt])

  useEffect(() => {
    if (isRelief) reliefRef.current?.paint(world, layer, scale)
  }, [world, layer, scale, isRelief])

  useEffect(() => {
    if (isRelief) {
      // Release the full viewport bitmap retained from the loading fallback.
      if (baseRef.current) {
        resizeCanvas(baseRef.current, 1, 1)
        baseRef.current = null
      }
      return
    }
    const base = baseRef.current ?? document.createElement('canvas')
    // Cache the visible viewport, never a giant full-world bitmap. Province
    // geometry is repainted at display resolution when the camera changes.
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    resizeCanvas(base, size.w * dpr, size.h * dpr)
    const ctx = base.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)
    ctx.translate(offsetX, offsetY)
    ctx.scale(scale, scale)
    drawAtlas(ctx, atlas, world, layer, scale)
    baseRef.current = base
  }, [world, layer, size.w, size.h, offsetX, offsetY, atlas, scale, isRelief])

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
    resizeCanvas(canvas, size.w * dpr, size.h * dpr)
    const ctx = canvas.getContext('2d')!
    const reduced = !motionAllowed
    const moving = running && motionAllowed
    const freightMoving = moving && (showRoutes || layer === 'trade') && world.routes.length > 0
    let lastAnimatedFrame = -Infinity
    let painted = false
    const draw = (time: number) => {
      if (isRelief && !reliefRef.current) return
      if (document.hidden) {
        reliefRef.current?.pauseMotion()
        return
      }
      // Scenery and freight share a 30 fps ceiling. Camera/content changes still
      // paint immediately; scenery-only frames retain the 2D labels and overlay.
      if (time - lastAnimatedFrame < 1000 / 30) {
        frame.current = requestAnimationFrame(draw)
        return
      }
      lastAnimatedFrame = time
      if (painted && isRelief && !freightMoving) {
        reliefRef.current!.render(time, moving)
        if (moving) frame.current = requestAnimationFrame(draw)
        return
      }
      painted = true
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, size.w, size.h)
      if (!isRelief) {
        ctx.fillStyle = '#163e4d'
        ctx.fillRect(0, 0, size.w, size.h)
        if (baseRef.current) ctx.drawImage(baseRef.current, 0, 0, size.w, size.h)
      }
      ctx.save()
      ctx.translate(offsetX, offsetY)
      ctx.scale(scale, scale)
      const drawOverlay = (ctx: CanvasRenderingContext2D) => {
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
        if (showArmies || layer === 'military') drawWarfare(ctx, world, nation, !(isRelief && scale >= 3))
        if (showArmies || layer === 'military')
          for (const a of world.armies.filter((a) => a.operations?.embarkedOn == null)) {
            const c = world.cells[world.regions[a.region].center]
            const x = c.x - 12,
              y = c.y + 14
            if (!(isRelief && scale >= 3)) {
              ctx.fillStyle = '#24343a'
              ctx.strokeStyle = world.nations[a.nation].color
              ctx.lineWidth = 1.5
              ctx.fillRect(x - 10, y - 7, 30, 15)
              ctx.strokeRect(x - 10, y - 7, 30, 15)
              ctx.font = '8px system-ui'
              ctx.textAlign = 'center'
              ctx.fillStyle = '#f0e9d8'
              ctx.fillText(`${(a.soldiers / 1000).toFixed(1)}k`, x + 5, y + 3)
            }
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
      }
      if (isRelief) {
        reliefRef.current!.paintOverlay(
          drawOverlay,
          time,
          overlayRevision,
          running && !reduced && (showRoutes || layer === 'trade'),
        )
        reliefRef.current!.render(time, moving)
      } else drawOverlay(ctx)
      drawPlaceLabels(
        ctx,
        atlas,
        world,
        layer,
        scale,
        { x: offsetX, y: offsetY, w: size.w, h: size.h },
        nation,
        isRelief
          ? (x, y) => {
              const p = reliefRef.current!.project(x, y)
              return { x: (p.x - offsetX) / scale, y: (p.y - offsetY) / scale }
            }
          : undefined,
      )
      ctx.restore()
      if (isRelief && scale >= 3 && (showArmies || layer === 'military')) {
        const badge = (cell: number, label: string, owner: number) => {
          const c = world.cells[cell],
            p = reliefRef.current!.project(c.x, c.y)
          if (p.x < -40 || p.x > size.w + 40 || p.y < -40 || p.y > size.h + 40) return
          ctx.fillStyle = '#24343a'
          ctx.strokeStyle = world.nations[owner].color
          ctx.lineWidth = 1.5
          ctx.fillRect(p.x + 14, p.y + 14, 78, 21)
          ctx.strokeRect(p.x + 14, p.y + 14, 78, 21)
          ctx.font = '11px system-ui'
          ctx.textAlign = 'center'
          ctx.fillStyle = '#f0e9d8'
          ctx.fillText(label, p.x + 53, p.y + 29)
        }
        for (const a of world.armies)
          if (a.operations?.embarkedOn == null)
            badge(world.regions[a.region].center, `Troops ${(a.soldiers / 1000).toFixed(1)}k`, a.nation)
        for (const f of world.warfare?.fleets ?? [])
          badge(f.cell, `Ships ${f.warships + f.transports}`, f.nation)
      }
      if (moving && (isRelief || freightMoving)) frame.current = requestAnimationFrame(draw)
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
    motionAllowed,
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
    overlayRevision,
    isRelief,
    tilt,
  ])

  const locate = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect(),
      { scale, offsetX, offsetY } = transforms.current
    const surface = isRelief
      ? reliefRef.current!.locate(clientX - rect.left, clientY - rect.top)
      : {
          x: (clientX - rect.left - offsetX) / scale,
          y: (clientY - rect.top - offsetY) / scale,
        }
    if (!surface) return null
    const { x, y } = surface
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
  const maxZoom = isRelief ? Math.max(32, 36 / fit) : 32
  const settlements = useMemo(() => spatialState(world).settlements, [world])
  const pickedCity = picked
    ? settlements.filter((s) => s.region === picked.id).sort((a, b) => b.population - a.population)[0]
    : undefined
  const cityScreen = (city: Settlement) => {
    const c = world.cells[city.cell],
      elevation = terrainHeight(world, c.x, c.y) + 2
    return {
      x: (c.x - mapW / 2) * scale + view.x + size.w / 2,
      y:
        (c.y - mapH / 2) * scale * verticalFactor -
        elevation * scale * (tilt ? Math.cos(Math.PI * 0.29) : 0) +
        view.y +
        size.h / 2,
    }
  }
  const closeCity =
    isRelief && scale >= 6
      ? settlements.reduce<Settlement | undefined>((best, s) => {
          const p = cityScreen(s)
          if (p.x < 0 || p.x > size.w || p.y < 80 || p.y > size.h - 70) return best
          if (!best) return s
          const b = cityScreen(best)
          return Math.hypot(p.x - size.w / 2, p.y - size.h / 2) <
            Math.hypot(b.x - size.w / 2, b.y - size.h / 2)
            ? s
            : best
        }, undefined)
      : undefined
  const exploreCity = (city: Settlement) => {
    const c = world.cells[city.cell],
      targetScale = Math.max(6, Math.min(24, (size.w - 50) / 34, (size.h - 140) / 26))
    const zoom = targetScale / fit,
      elevation = terrainHeight(world, c.x, c.y) + 2
    setView({
      zoom,
      x: (mapW / 2 - c.x) * targetScale,
      y:
        ((mapH / 2 - c.y) * verticalFactor + elevation * (tilt ? Math.cos(Math.PI * 0.29) : 0)) * targetScale,
    })
    setPicked(null)
  }
  const changePresentation = (mode: 'relief' | 'atlas', nextTilt = tilt) => {
    const center = isRelief ? reliefRef.current?.locate(size.w / 2, size.h / 2) : undefined
    const cx = center?.x ?? mapW / 2 - view.x / scale
    const cy = center?.y ?? mapH / 2 - view.y / (scale * verticalFactor)
    const angle = mode === 'relief' && nextTilt ? Math.PI * 0.29 : Math.PI / 2
    const nextFactor = Math.sin(angle),
      nextFit = Math.min(size.w / mapW, size.h / (mapH * nextFactor)) * 0.94
    const nextScale = mode === 'atlas' ? Math.min(scale, nextFit * 32) : scale
    const elevation = mode === 'relief' ? terrainHeight(world, cx, cy) : 0
    setView({
      zoom: nextScale / nextFit,
      x: (mapW / 2 - cx) * nextScale,
      y: ((mapH / 2 - cy) * nextFactor + elevation * Math.cos(angle)) * nextScale,
    })
    setPresentation(mode)
    setTilt(nextTilt)
    setPicked(null)
  }
  const zoom = (factor: number, point = { x: size.w / 2, y: size.h / 2 }) =>
    setView((v) => zoomAt(v, factor, point, size, maxZoom))
  useEffect(() => {
    const canvas = canvasRef.current!
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      zoom(e.deltaY > 0 ? 0.91 : 1.1, { x: e.clientX - rect.left, y: e.clientY - rect.top })
    }
    canvas.addEventListener('wheel', handler, { passive: false })
    return () => canvas.removeEventListener('wheel', handler)
  }, [size, maxZoom])

  return (
    <div
      className="map-canvas-wrap"
      data-layer={layer}
      data-presentation={isRelief ? 'relief' : 'atlas'}
      data-scenery-motion={isRelief && running && motionAllowed ? 'running' : 'still'}
      ref={holderRef}
    >
      <canvas ref={reliefCanvasRef} className="relief-canvas" aria-hidden="true" />
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
                maxZoom,
              )
            setView({ ...next, x: next.x + center.x - start.center.x, y: next.y + center.y - start.center.y })
            return
          }
          if (drag.current) {
            const { vx, vy } = drag.current,
              dx = e.clientX - drag.current.x,
              dy = e.clientY - drag.current.y
            if (Math.hypot(dx, dy) > 4) {
              drag.current.moved = true
              setPicked(null)
            }
            // A queued update may run after pointerup clears the drag ref.
            setView((v) => ({ ...v, x: vx + dx, y: vy + dy }))
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
        <small>{((65 / scale) * (world.adaptive?.metersPerMapUnit ?? METERS_PER_MAP_UNIT) / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km</small>
      </div>
      <div className="map-view-switch" role="group" aria-label="Map presentation">
        {world.adaptive && onInspectArea && (
          <button aria-label="Inspect daily life" title="Inspect this area's recorded homes, jobs and daily activity" onClick={() => onInspectArea(inspectionBounds())}>
            <ScanSearch size={15} /> Inspect
          </button>
        )}
        <button
          aria-pressed={presentation === 'relief'}
          disabled={reliefError || reliefReady !== mapKey}
          title={reliefError ? '3D graphics unavailable on this device' : 'Three-dimensional landscape'}
          onClick={() => changePresentation('relief')}
        >
          <Mountain size={15} /> 3D
        </button>
        <button
          aria-pressed={presentation === 'atlas'}
          title="Flat cartographic view"
          onClick={() => changePresentation('atlas')}
        >
          <MapIcon size={15} /> Atlas
        </button>
        {isRelief && (
          <button
            aria-label={tilt ? 'View from above' : 'Tilt the landscape'}
            aria-pressed={tilt}
            title={tilt ? 'View from above' : 'Tilt the landscape'}
            onClick={() => changePresentation('relief', !tilt)}
          >
            <Orbit size={16} />
          </button>
        )}
      </div>
      {reliefError && (
        <div className="map-render-note" role="status">
          3D unavailable · Atlas view active
        </div>
      )}
      {closeCity && (
        <div className="city-view-caption" aria-label="City view">
          <h2>{closeCity.name}</h2>
          {world.adaptive && onInspectDaily && <button onClick={() => { exploreCity(closeCity); onInspectDaily(closeCity.cell) }}>Inspect daily life</button>}
          <p>
            {compact(closeCity.population)} people ·{' '}
            {closeCity.capital
              ? 'Capital'
              : closeCity.kind === 'city'
                ? 'City'
                : closeCity.kind === 'town'
                  ? 'Town'
                  : 'Village'}
          </p>
        </div>
      )}
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
          {isRelief && pickedCity && (
            <button className="city-explore" onClick={() => exploreCity(pickedCity)}>
              <ScanSearch size={16} /> Explore {pickedCity.name}
            </button>
          )}
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
                setView({
                  zoom,
                  x: (mapW / 2 - c.x) * fit * zoom,
                  y: (mapH / 2 - c.y) * fit * zoom * verticalFactor,
                })
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
