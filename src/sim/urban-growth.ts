import { settlementElevation } from './settlement-terrain'
export { settlementElevation } from './settlement-terrain'
import { habitableLand } from './terrain-access'
import type { PhysicalSite, PointMeters, SettlementLane, SpatialBounds } from './adaptive-types'
import type { World } from './types'
import { CELL_METERS } from './grid'
import { hashSeed } from './random'
import { cellPolygon, pointInPolygon } from './physical-space'
import { footprintConnection } from './residential-geometry'
import { SpatialBuckets } from './spatial-buckets'
import { inRiverChannel } from '../map/rivers'
import { laneTouchesRiver, nearbyRiverBank, surveyRiverBridge } from './river-lanes'

export interface BuildingPlot {
  cell: number
  point: PointMeters
  parcel: SpatialBounds
  building: PointMeters[]
  weight: number
  lanes: SettlementLane[]
}
/** Clear bank between a surveyed house and the rendered river, in meters. */
const RIVER_SETBACK = 6
const distance = (a: PointMeters, b: PointMeters) => Math.hypot(a.x - b.x, a.y - b.y)
const random = (key: string) => hashSeed(key) / 4294967296
const along = (p: PointMeters, angle: number, length: number) => ({
  x: p.x + Math.cos(angle) * length,
  y: p.y + Math.sin(angle) * length,
})
export function rectangularFootprint(point: PointMeters, width: number, depth: number, angle: number) {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, y]) => ({
    x: point.x + ((x * width) / 2) * Math.cos(angle) - ((y * depth) / 2) * Math.sin(angle),
    y: point.y + ((x * width) / 2) * Math.sin(angle) + ((y * depth) / 2) * Math.cos(angle),
  }))
}

function surveyContext(w: World, source: PhysicalSite, existing: PhysicalSite[], opening: boolean) {
  const owned = new Set(w.localEconomy!.units[source.pool].cells)
  const obstacles = existing.filter((s) => (!opening || s.id !== source.id) && (s.capacity > 0 || s.building))
  const shapes = obstacles.map(
    (s) =>
      s.building ??
      (s.parcel
        ? [
            s.parcel,
            { x: s.parcel.x + s.parcel.size, y: s.parcel.y },
            { x: s.parcel.x + s.parcel.size, y: s.parcel.y + s.parcel.size },
            { x: s.parcel.x, y: s.parcel.y + s.parcel.size },
          ]
        : []),
  )
  const bounds = shapes.map((shape) => ({
    x: Math.min(...shape.map((p) => p.x)),
    y: Math.min(...shape.map((p) => p.y)),
    right: Math.max(...shape.map((p) => p.x)),
    bottom: Math.max(...shape.map((p) => p.y)),
  }))
  const nearby = new SpatialBuckets<number>(128)
  bounds.forEach((b, i) => {
    if (Number.isFinite(b.x)) nearby.insert(i, b.x, b.y, b.right, b.bottom)
  })
  const land = (p: PointMeters) => {
    if (p.x < 0 || p.y < 0 || p.x >= w.width * CELL_METERS || p.y >= w.height * CELL_METERS) return -1
    const cell = Math.floor(p.y / CELL_METERS) * w.width + Math.floor(p.x / CELL_METERS)
    return owned.has(cell) && habitableLand(w.cells[cell]) ? cell : -1
  }
  const clear = (shape: PointMeters[], gap: number) => {
    const box = {
      x: Math.min(...shape.map((p) => p.x)),
      y: Math.min(...shape.map((p) => p.y)),
      right: Math.max(...shape.map((p) => p.x)),
      bottom: Math.max(...shape.map((p) => p.y)),
    }
    for (const i of nearby.query(box.x - gap, box.y - gap, box.right + gap, box.bottom + gap))
      if (
        box.x < bounds[i].right + gap &&
        box.right + gap > bounds[i].x &&
        box.y < bounds[i].bottom + gap &&
        box.bottom + gap > bounds[i].y &&
        footprintConnection(shape, shapes[i]).distance < gap
      )
        return false
    return true
  }
  const add = (shape: PointMeters[]) => {
    shapes.push(shape)
    bounds.push({
      x: Math.min(...shape.map((p) => p.x)),
      y: Math.min(...shape.map((p) => p.y)),
      right: Math.max(...shape.map((p) => p.x)),
      bottom: Math.max(...shape.map((p) => p.y)),
    })
    const b = bounds.at(-1)!
    nearby.insert(shapes.length - 1, b.x, b.y, b.right, b.bottom)
  }
  return { land, clear, add }
}

function initialDirection(w: World, source: PhysicalSite) {
  const meters = w.adaptive!.metersPerMapUnit
  // Existing freight roads establish frontage before a new lane is surveyed.
  const edge = (w.corridors ?? [])
    .filter((e) => e.a === source.cell || e.b === source.cell)
    .sort((a, b) => b.traffic - a.traffic || b.familiarity - a.familiarity || a.a - b.a)[0]
  if (edge) {
    const other = w.cells[edge.a === source.cell ? edge.b : edge.a]
    return Math.atan2(other.y * meters - source.y, other.x * meters - source.x)
  }
  const dx =
      settlementElevation(w, { x: source.x + 96, y: source.y }) -
      settlementElevation(w, { x: source.x - 96, y: source.y }),
    dy =
      settlementElevation(w, { x: source.x, y: source.y + 96 }) -
      settlementElevation(w, { x: source.x, y: source.y - 96 })
  const salt = random(`${w.seed}:lane-bearing:${source.cell}`)
  return Math.hypot(dx, dy) > 0.005
    ? Math.atan2(dy, dx) + Math.PI / 2 + (salt - 0.5) * 0.5
    : salt * Math.PI * 2
}

function tradeFrontages(w: World, source: PhysicalSite): SettlementLane[] {
  const meters = w.adaptive!.metersPerMapUnit,
    result: SettlementLane[] = []
  const edges = new Set<string>()
  const add = (a: number, b: number) => {
    const key = `${Math.min(a, b)}:${Math.max(a, b)}`
    if (
      edges.has(key) ||
      !w.cells[a] ||
      !w.cells[b] ||
      !habitableLand(w.cells[a]) ||
      !habitableLand(w.cells[b])
    )
      return
    edges.add(key)
    const from = { x: w.cells[a].x * meters, y: w.cells[a].y * meters },
      to = { x: w.cells[b].x * meters, y: w.cells[b].y * meters }
    if (footprintConnection([source], [from, to]).distance > 500) return
    const steps = Math.ceil(distance(from, to) / 26)
    const points = Array.from({ length: steps + 1 }, (_, i) => ({
      x: from.x + ((to.x - from.x) * i) / steps,
      y: from.y + ((to.y - from.y) * i) / steps,
    }))
    result.push({ pool: source.pool, founded: w.month, width: 5, points })
  }
  for (const trace of w.corridors ?? [])
    if (trace.familiarity > 0.06 || trace.traffic > 0) add(trace.a, trace.b)
  return result
}

/** Lane-frontage growth. The square quadtree only indexes these free-positioned
 * plots; streets, buildings and their physical capacities do not snap to it. */
export function surveyBuildingPlots(
  w: World,
  source: PhysicalSite,
  count: number,
  compact: boolean,
  existing: PhysicalSite[],
  opening = true,
): { plots: BuildingPlot[]; lanes: SettlementLane[] } {
  const context = surveyContext(w, source, existing, opening)
  const lanes = [
    ...(w.adaptive!.lanes ?? []).filter((l) => l.pool === source.pool),
    ...tradeFrontages(w, source),
  ]
  const fresh: SettlementLane[] = [],
    plots: BuildingPlot[] = []
  const streets = new SpatialBuckets<{ points: PointMeters[]; gap: number }>(128)
  const addStreet = (lane: SettlementLane) => {
    const gap = lane.width / 2 + 1
    for (let i = 1; i < lane.points.length; i++) {
      const a = lane.points[i - 1],
        b = lane.points[i]
      streets.insert(
        { points: [a, b], gap },
        Math.min(a.x, b.x) - gap,
        Math.min(a.y, b.y) - gap,
        Math.max(a.x, b.x) + gap,
        Math.max(a.y, b.y) + gap,
      )
    }
  }
  for (const lane of lanes) addStreet(lane)
  const salt = `${w.seed}:frontage:${source.id}`
  const reach = Math.max(100, Math.sqrt(count) * 21)
  const segmentClear = (a: PointMeters, b: PointMeters, width: number) => {
    const n = Math.max(1, Math.ceil(distance(a, b) / 6))
    for (let i = 0; i <= n; i++) {
      const p = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }
      if (context.land(p) < 0) return false
    }
    return (
      Math.abs(settlementElevation(w, a) - settlementElevation(w, b)) < 0.025 &&
      context.clear([a, b], width / 2 + 1)
    )
  }
  const place = (a: PointMeters, b: PointMeters, roadWidth: number, key: string, side: number) => {
    const angle = Math.atan2(b.y - a.y, b.x - a.x),
      t = 0.35 + random(`${key}:along`) * 0.3,
      front = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    const centrality = compact ? Math.max(0, 1 - distance(front, source) / (reach * 1.2)) : 0
    const type = random(`${key}:type`)
    const width =
      type < 0.22
        ? 6 + random(`${key}:w`) * 3
        : type > 0.84
          ? 16 + random(`${key}:w`) * 9
          : 9 + random(`${key}:w`) * 6
    const depth = type > 0.84 ? 12 + random(`${key}:d`) * 8 : 7 + random(`${key}:d`) * 7
    const setback = compact
      ? 1.5 + (1 - centrality) * 5 + random(`${key}:garden`) * 3
      : 22 + random(`${key}:garden`) * 20
    const point = along(front, angle + (side * Math.PI) / 2, roadWidth / 2 + depth / 2 + setback)
    const cell = context.land(point)
    if (cell < 0) return
    const heading = angle + (random(`${key}:turn`) - 0.5) * 0.16
    const building = rectangularFootprint(point, width, depth, heading)
    const minX = Math.min(...building.map((p) => p.x)),
      minY = Math.min(...building.map((p) => p.y)),
      span =
        Math.max(Math.max(...building.map((p) => p.x)) - minX, Math.max(...building.map((p) => p.y)) - minY) +
        3
    const parcel = { x: point.x - span / 2, y: point.y - span / 2, size: span }
    const corners = [
      parcel,
      { x: parcel.x + span, y: parcel.y },
      { x: parcel.x + span, y: parcel.y + span },
      { x: parcel.x, y: parcel.y + span },
    ]
    if (!corners.every((p) => context.land(p) === cell && pointInPolygon(p, cellPolygon(w, cell)))) return
    const relief =
      Math.max(...building.map((p) => settlementElevation(w, p))) -
      Math.min(...building.map((p) => settlementElevation(w, p)))
    if (relief > 0.014 || !context.clear(building, compact ? 2.5 : 26)) return
    // River cells are habitable, but the visible channel is wider than a lot.
    const scale = w.adaptive!.metersPerMapUnit
    if (
      inRiverChannel(
        w,
        building.map((p) => ({ x: p.x / scale, y: p.y / scale })),
        RIVER_SETBACK / scale,
      )
    )
      return
    // Keep setbacks from every existing street, including intersecting lanes.
    if (
      [
        ...streets.query(
          minX,
          minY,
          Math.max(...building.map((p) => p.x)),
          Math.max(...building.map((p) => p.y)),
        ),
      ].some((street) => footprintConnection(building, street.points).distance < street.gap)
    )
      return
    const weight = (width * depth * (1 + centrality * (type > 0.65 ? 1.3 : 0.25))) / 32
    const plot = { cell, point, parcel, building, weight, lanes: [...fresh] }
    context.add(building)
    plots.push(plot)
  }
  if (!opening) {
    // Existing street frontages are considered before extending a dead end.
    const edges = lanes
      .filter((l) => !l.bridge)
      .flatMap((l, index) =>
        l.points.slice(1).map((b, i) => ({
          a: l.points[i],
          b,
          width: l.width,
          key: `existing:${index}:${i}`,
        })),
      )
      .sort((a, b) => distance(a.a, source) - distance(b.a, source))
    for (const edge of edges)
      for (const side of [-1, 1]) {
        if (distance(edge.a, source) > 300) continue
        place(edge.a, edge.b, edge.width, `${salt}:${edge.key}:${side}`, side)
        if (plots.length >= count) return { plots, lanes: fresh }
      }
  }
  type Tip = { point: PointMeters; angle: number; depth: number; key: string; priority: number }
  const tips: Tip[] = []
  const addTip = (point: PointMeters, angle: number, depth: number, key: string) =>
    tips.push({ point, angle, depth, key, priority: distance(point, source) + depth * 4 })
  let anchor: PointMeters = source
  const bank = nearbyRiverBank(w, source)
  if (opening && laneTouchesRiver(w, [anchor], 5.5) && bank) {
    // Opening housing supports can be centred on a river. Begin on a real bank,
    // never grow a mesh of streets through the channel to find buildable ground.
    const dry = [bank.point, bank.opposite].find(
      (p) => context.land(p) >= 0 && !laneTouchesRiver(w, [p], 5.5),
    )
    if (dry) anchor = dry
  }
  if (!opening) {
    const end = lanes
      .filter((l) => !l.bridge && l.width >= 5)
      .flatMap((l) => [l.points[0], l.points.at(-1)!])
      .filter((p) => distance(p, source) < 180 && !laneTouchesRiver(w, [p], 5.5))
      .sort((a, b) => distance(a, source) - distance(b, source))[0]
    if (end) anchor = end
  }
  const bridge =
    compact && (opening ? count >= 24 : anchor !== source) && bank
      ? surveyRiverBridge(
          w,
          anchor,
          [...(w.adaptive!.lanes ?? []).filter((l) => l.bridge), ...lanes],
          (a, b, width) =>
            segmentClear(a, b, width) &&
            segmentClear(anchor, a, width) &&
            !laneTouchesRiver(w, [anchor, a], width),
        )
      : undefined
  if (bridge) {
    const [a, b] = bridge.points
    const deck: SettlementLane = {
      pool: source.pool,
      founded: w.month,
      width: 5.5,
      points: [a, b],
      bridge: true,
    }
    fresh.push(deck)
    addStreet(deck)
    if (distance(anchor, a) > 1) {
      const approach = { pool: source.pool, founded: w.month, width: 5.5, points: [anchor, a] }
      fresh.push(approach)
      addStreet(approach)
    }
    const angle = Math.atan2(bridge.tangent.y, bridge.tangent.x)
    for (const [i, p] of [a, b].entries()) {
      addTip(p, angle, 0, `main:bank:${i}:0`)
      addTip(p, angle + Math.PI, 0, `main:bank:${i}:1`)
    }
  }
  if (!opening && lanes.length) {
    for (const [i, l] of lanes.entries()) {
      const p = l.points.at(-1)!,
        before = l.points.at(-2)!
      if (distance(p, source) <= 320) addTip(p, Math.atan2(p.y - before.y, p.x - before.x), 0, `extend:${i}`)
    }
  } else if (!bridge) {
    const direction = initialDirection(w, source)
    if (!opening && source.building) {
      // Older building saves have no lanes. Start outside the occupied house,
      // leaving its existing footprint and residents untouched.
      source.building.forEach((p, i) => {
        const next = source.building![(i + 1) % source.building!.length]
        const front = { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2 }
        const outward = Math.atan2(front.y - source.y, front.x - source.x)
        const start = along(front, outward, 5)
        addTip(start, outward + Math.PI / 2, 0, `legacy:${i}:0`)
        addTip(start, outward - Math.PI / 2, 0, `legacy:${i}:1`)
      })
    } else {
      const bearing = anchor !== source && bank ? Math.atan2(bank.tangent.y, bank.tangent.x) : direction
      addTip(anchor, bearing, 0, 'main:0')
      addTip(anchor, bearing + Math.PI, 0, 'main:1')
    }
  }
  const visited = new Set<string>()
  let attempts = 0
  while (tips.length && plots.length < count && attempts++ < Math.max(300, count * 80)) {
    tips.sort((a, b) => b.priority - a.priority || b.key.localeCompare(a.key))
    const tip = tips.pop()!,
      key = `${salt}:${tip.key}:${tip.depth}`
    const step = compact ? 20 + random(`${key}:step`) * 10 : 58 + random(`${key}:step`) * 25
    const width = tip.key.startsWith('main') ? 5.5 : 3.5
    const elevation = settlementElevation(w, tip.point)
    const turns = [-0.62, -0.3, 0, 0.3, 0.62]
    if (laneTouchesRiver(w, [tip.point], width + step * 2)) {
      const edge = nearbyRiverBank(w, tip.point)
      if (edge) {
        const tangent = Math.atan2(edge.tangent.y, edge.tangent.x)
        for (const heading of [tangent, tangent + Math.PI]) {
          const turn = Math.atan2(Math.sin(heading - tip.angle), Math.cos(heading - tip.angle))
          if (Math.abs(turn) < Math.PI * 0.75) turns.push(turn)
        }
      }
    }
    const candidates = turns
      .map((turn) => {
        const angle = tip.angle + turn + (random(`${key}:bend`) - 0.5) * 0.28
        const point = along(tip.point, angle, step)
        const cell = context.land(point)
        const grade = Math.abs(settlementElevation(w, point) - elevation) / step
        return {
          point,
          angle,
          cell,
          score:
            Math.abs(turn) * 0.4 +
            grade * 1800 +
            (cell < 0 ? Infinity : (1 - (w.cells[cell].landscape?.habitat ?? 0.5)) * 0.15),
        }
      })
      .filter(
        (c) =>
          c.cell >= 0 &&
          !laneTouchesRiver(w, [tip.point, c.point], width) &&
          segmentClear(tip.point, c.point, width),
      )
      .sort((a, b) => a.score - b.score)
    const best = candidates[0]
    if (!best) continue
    const tag = `${Math.round(best.point.x / 12)}:${Math.round(best.point.y / 12)}`
    if (visited.has(tag)) continue
    visited.add(tag)
    // Roads cannot run through another road's frontage buildings; intersections
    // themselves remain available and naturally create denser junctions.
    const lane: SettlementLane = {
      pool: source.pool,
      founded: w.month,
      width,
      points: [{ x: tip.point.x, y: tip.point.y }, best.point],
    }
    fresh.push(lane)
    addStreet(lane)
    for (const side of [-1, 1]) {
      place(tip.point, best.point, width, `${key}:${side}`, side)
      if (plots.length >= count) break
    }
    addTip(best.point, best.angle, tip.depth + 1, tip.key)
    if (compact && tip.depth % 3 === 1) {
      const side = random(`${key}:branch`) > 0.5 ? 1 : -1
      addTip(
        best.point,
        best.angle + side * (0.85 + random(`${key}:fork`) * 0.5),
        0,
        `${tip.key}.${tip.depth}`,
      )
    }
  }
  if (plots.length < count && opening)
    throw new Error(`Insufficient accessible frontage for ${source.id}: ${plots.length}/${count}`)
  return { plots, lanes: fresh }
}

export function findOrganicParcel(w: World, source: PhysicalSite, existing: PhysicalSite[]) {
  const result = surveyBuildingPlots(w, source, 1, true, existing, false)
  const plot = result.plots[0]
  return plot ? { ...plot, lanes: result.lanes, distance: distance(plot.point, source) } : undefined
}
