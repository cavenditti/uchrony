import {
  tradeRoadEdges,
  roadKey,
  orientedRoadCurves,
  traceRoadCurves,
  type RoadPoint,
  type RoadCurve,
} from './road-curves'
import { traversableLegs } from '../sim/transport'
import { StringTable } from './string-table'
import type { Route, World } from '../sim/types'
import { METERS_PER_MAP_UNIT } from '../sim/physical-space'

export interface FreightSegment {
  a: number
  b: number
  mode: 'land' | 'sea'
  forward: number
  backward: number
  selectedForward: number
  selectedBackward: number
}
export interface FreightCorridor {
  cells: number[]
  points?: RoadPoint[]
  curves?: RoadCurve[]
  lengths: number[]
  distance: number
  mode: 'land' | 'sea'
  forward: number
  backward: number
  selectedForward: number
  selectedBackward: number
}

/** Every physical edge is painted once, even when many shipments share it. */
export function freightOverlay(world: World, nation: number, region: number | null) {
  const segments = new StringTable<FreightSegment>(),
    ports = new Map<number, { cell: number; volume: number; selected: number }>(),
    terminals = new Set(world.regions.map((r) => r.center))
  let legacy = false
  for (const route of world.routes) {
    if (!route.legs) {
      legacy = true
      continue
    }
    if (!traversableLegs(world, route.legs)) continue
    const selected =
      region !== null
        ? route.from === region || route.to === region
        : world.regions[route.from].nation === nation || world.regions[route.to].nation === nation
    for (const leg of route.legs) {
      if (leg.mode === 'sea')
        for (const cell of [leg.cells[0], leg.cells[leg.cells.length - 1]]) {
          terminals.add(cell)
          const port = ports.get(cell) ?? { cell, volume: 0, selected: 0 }
          port.volume += route.volume
          if (selected) port.selected += route.volume
          ports.set(cell, port)
        }
      for (let i = 1; i < leg.cells.length; i++) {
        const from = leg.cells[i - 1],
          to = leg.cells[i],
          a = Math.min(from, to),
          b = Math.max(from, to),
          key = `${leg.mode}-${a}-${b}`,
          segment = segments.get(key) ?? {
            a,
            b,
            mode: leg.mode,
            forward: 0,
            backward: 0,
            selectedForward: 0,
            selectedBackward: 0,
          }
        if (from === a) {
          segment.forward += route.volume
          if (selected) segment.selectedForward += route.volume
        } else {
          segment.backward += route.volume
          if (selected) segment.selectedBackward += route.volume
        }
        segments.set(key, segment)
      }
    }
  }
  const edges = [...segments.values()],
    adjacent = new StringTable<number[]>()
  for (const [i, edge] of edges.entries())
    for (const cell of [edge.a, edge.b]) {
      const key = `${edge.mode}-${cell}`,
        links = adjacent.get(key) ?? []
      links.push(i)
      adjacent.set(key, links)
    }
  const visited = new Uint8Array(edges.length),
    corridors: FreightCorridor[] = []
  const junction = (mode: string, cell: number) =>
    terminals.has(cell) || adjacent.get(`${mode}-${cell}`)!.length !== 2
  const walk = (index: number, start: number) => {
    const first = edges[index],
      forward = first.a === start,
      corridor: FreightCorridor = {
        cells: [start],
        lengths: [0],
        distance: 0,
        mode: first.mode,
        forward: forward ? first.forward : first.backward,
        backward: forward ? first.backward : first.forward,
        selectedForward: forward ? first.selectedForward : first.selectedBackward,
        selectedBackward: forward ? first.selectedBackward : first.selectedForward,
      }
    let cell = start
    while (!visited[index]) {
      visited[index] = 1
      const edge = edges[index],
        next = edge.a === cell ? edge.b : edge.a,
        a = world.cells[cell],
        b = world.cells[next]
      corridor.distance += Math.hypot(a.x - b.x, a.y - b.y)
      corridor.cells.push(next)
      corridor.lengths.push(corridor.distance)
      cell = next
      if (junction(edge.mode, cell)) break
      index = adjacent.get(`${edge.mode}-${cell}`)!.find((id) => !visited[id]) ?? index
    }
    corridors.push(corridor)
  }
  for (const [i, edge] of edges.entries()) {
    if (visited[i]) continue
    if (junction(edge.mode, edge.a)) walk(i, edge.a)
    else if (junction(edge.mode, edge.b)) walk(i, edge.b)
  }
  // Closed loops have no junction; they still carry and display freight.
  for (const [i, edge] of edges.entries()) if (!visited[i]) walk(i, edge.a)
  const roads = tradeRoadEdges(world)
  for (const corridor of corridors) {
    if (corridor.mode !== 'land') continue
    const points: RoadPoint[] = [],
      curves: RoadCurve[] = []
    for (let i = 1; i < corridor.cells.length; i++) {
      const from = corridor.cells[i - 1],
        edge = roads.get(roadKey(from, corridor.cells[i]))!
      const part = edge.a === from ? edge.points : [...edge.points].reverse()
      points.push(...(points.length ? part.slice(1) : part))
      curves.push(...orientedRoadCurves(edge, from))
    }
    corridor.points = points
    corridor.curves = curves
    corridor.lengths = [0]
    for (let i = 1; i < points.length; i++)
      corridor.lengths.push(
        corridor.lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y),
      )
    corridor.distance = corridor.lengths.at(-1) ?? 0
  }
  return { corridors, ports: [...ports.values()], legacy }
}

export function pointAlong(world: World, corridor: FreightCorridor, distance: number) {
  const d = Math.max(0, Math.min(corridor.distance, distance))
  let i = 1
  while (i < corridor.lengths.length - 1 && corridor.lengths[i] < d) i++
  const a = corridor.points?.[i - 1] ?? world.cells[corridor.cells[i - 1]],
    b = corridor.points?.[i] ?? world.cells[corridor.cells[i]],
    t = (d - corridor.lengths[i - 1]) / (corridor.lengths[i] - corridor.lengths[i - 1])
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

export function routeDistance(world: World, route: Pick<Route, 'legs'>) {
  return route.legs?.reduce(
    (sum, leg) =>
      sum +
      leg.cells.slice(1).reduce((length, id, i) => {
        const a = world.cells[leg.cells[i]],
          b = world.cells[id]
        return (
          length +
          (Math.hypot(b.x - a.x, b.y - a.y) * (world.adaptive?.metersPerMapUnit ?? METERS_PER_MAP_UNIT)) /
            1000
        )
      }, 0),
    0,
  )
}

export function drawFreight(
  ctx: CanvasRenderingContext2D,
  world: World,
  overlay: ReturnType<typeof freightOverlay>,
  scale: number,
  time: number,
  focused: boolean,
  animate: boolean,
) {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // Width represents summed monthly tonnage in both directions, on a square-root scale.
  const peak = Math.max(
    1,
    ...overlay.corridors.map((c) =>
      focused ? c.selectedForward + c.selectedBackward : c.forward + c.backward,
    ),
  )
  const strength = (volume: number) => Math.min(1, Math.sqrt(volume / peak))
  const width = (volume: number) => (0.35 + Math.min(3, Math.sqrt(volume / 140))) / scale
  const drawLine = (corridor: FreightCorridor, selected: boolean) => {
    const volume = selected
      ? corridor.selectedForward + corridor.selectedBackward
      : corridor.forward + corridor.backward
    if (volume <= 0) return
    const sea = corridor.mode === 'sea'
    // The underlying land route is already painted as a dirt road. Only the
    // explicit Trade layer adds a quantity highlight above that ground texture.
    if (!sea && !focused) return
    ctx.globalAlpha = focused && !selected ? 0.13 : 0.2 + strength(volume) * (sea ? 0.7 : 0.6)
    ctx.strokeStyle = sea ? '#e8d3a5' : '#524328'
    ctx.lineWidth = width(volume)
    ctx.setLineDash(sea ? [4 / scale, 5 / scale] : [])
    ctx.beginPath()
    if (corridor.curves) traceRoadCurves(ctx, corridor.curves)
    else
      corridor.cells.forEach((id, i) => {
        const c = world.cells[id]
        if (i === 0) ctx.moveTo(c.x, c.y)
        else if (i === corridor.cells.length - 1) ctx.lineTo(c.x, c.y)
        else {
          // Round only inside the cell around a corner; never shortcut the route.
          const before = world.cells[corridor.cells[i - 1]],
            after = world.cells[corridor.cells[i + 1]],
            inset = 0.18
          ctx.lineTo(c.x + (before.x - c.x) * inset, c.y + (before.y - c.y) * inset)
          ctx.quadraticCurveTo(c.x, c.y, c.x + (after.x - c.x) * inset, c.y + (after.y - c.y) * inset)
        }
      })
    ctx.stroke()
  }
  for (const corridor of overlay.corridors) drawLine(corridor, false)
  if (focused) for (const corridor of overlay.corridors) drawLine(corridor, true)
  ctx.setLineDash([])
  ctx.globalAlpha = 1
  // Distance-based motion keeps freight moving at a constant screen speed.
  // Both directions are shown when they carry goods; particles are symbolic.
  for (const corridor of overlay.corridors) {
    if (corridor.distance * scale < 24) continue
    const directions = focused
      ? [corridor.selectedForward, corridor.selectedBackward]
      : [corridor.forward, corridor.backward]
    for (const [reverse, volume] of directions.entries()) {
      if (volume < 1) continue
      ctx.globalAlpha = 0.15 + strength(volume) * 0.85
      const length = corridor.distance * scale,
        count = Math.max(1, Math.floor(length / 150)),
        phase = (animate ? time * 0.018 : length * 0.42) + corridor.cells[0] * 0.73 + reverse * 37
      for (let i = 0; i < count; i++) {
        const d = ((phase + (i * length) / count) % length) / scale,
          p = pointAlong(world, corridor, reverse ? corridor.distance - d : d)
        ctx.fillStyle = corridor.mode === 'sea' ? '#fff1c8' : '#fff5d8'
        ctx.beginPath()
        ctx.arc(p.x, p.y, 1.3 / scale, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  for (const port of overlay.ports) {
    const c = world.cells[port.cell],
      radius = (port.selected > 0 ? 3 : 2) / scale
    ctx.globalAlpha = focused && port.selected === 0 ? 0.3 : 1
    ctx.fillStyle = '#28444d'
    ctx.strokeStyle = '#f3deb0'
    ctx.lineWidth = 1 / scale
    ctx.beginPath()
    ctx.arc(c.x, c.y, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}
