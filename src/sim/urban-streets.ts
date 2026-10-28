import type { World } from './types'
import type { PointMeters, SettlementLane } from './adaptive-types'
import { MinHeap } from './heap'
import { SpatialBuckets } from './spatial-buckets'
import { urbanCellAt, urbanLandSegment } from './urban-land'
import { laneTouchesRiver } from './river-lanes'
import { footprintConnection } from './residential-geometry'

const distance = (a: PointMeters, b: PointMeters) => Math.hypot(a.x - b.x, a.y - b.y)
const cross = (a: PointMeters, b: PointMeters) => a.x * b.y - a.y * b.x
const minus = (a: PointMeters, b: PointMeters) => ({ x: a.x - b.x, y: a.y - b.y })
const at = (a: PointMeters, b: PointMeters, t: number) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
})
export function streetProjection(p: PointMeters, a: PointMeters, b: PointMeters) {
  const d = minus(b, a),
    length = d.x * d.x + d.y * d.y
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / (length || 1)))
  return { point: at(a, b, t), t }
}
interface Segment {
  a: PointMeters
  b: PointMeters
  lane: SettlementLane
  cuts: number[]
  index: number
}
export interface StreetEdge {
  to: number
  minutes: number
  lane: SettlementLane
  meters: number
}
export interface UrbanStreetGraph {
  nodes: PointMeters[]
  edges: StreetEdge[][]
  buckets: SpatialBuckets<number>
  segments: { a: number; b: number; lane: SettlementLane; meters: number; minutes: number }[]
  buildings: SpatialBuckets<import('./adaptive-types').PhysicalSite>
}
const caches = new WeakMap<
  World,
  {
    month: number
    revision: number
    streetRevision: number
    lanes: SettlementLane[]
    length: number
    graph: UrbanStreetGraph
  }
>()

/** Intersections are geometric, including T-junctions and internal boundary crossings. */
export function urbanStreetGraph(w: World): UrbanStreetGraph {
  const lanes = w.adaptive?.lanes ?? [],
    revision = w.adaptive?.revision ?? 0
  const cached = caches.get(w)
  const streetRevision = w.adaptive?.urban?.streetRevision ?? 0
  if (
    cached &&
    cached.streetRevision === streetRevision &&
    cached.lanes === lanes &&
    cached.length === lanes.length
  ) {
    if (cached.month !== w.month || cached.revision !== revision) {
      refreshStreetBuildings(w, cached.graph)
      queryCaches.delete(cached.graph)
      cached.month = w.month
      cached.revision = revision
    }
    return cached.graph
  }
  const raw: Segment[] = [],
    index = new SpatialBuckets<Segment>(128)
  for (const lane of lanes)
    for (let i = 1; i < lane.points.length; i++) {
      const a = lane.points[i - 1],
        b = lane.points[i]
      if (distance(a, b) < 0.01) continue
      const s: Segment = { a, b, lane, cuts: [0, 1], index: raw.length }
      raw.push(s)
      index.insert(s, Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y))
    }
  for (const s of raw)
    for (const t of index.query(
      Math.min(s.a.x, s.b.x) - 0.1,
      Math.min(s.a.y, s.b.y) - 0.1,
      Math.max(s.a.x, s.b.x) + 0.1,
      Math.max(s.a.y, s.b.y) + 0.1,
    )) {
      if (t.index <= s.index) continue
      const d = minus(s.b, s.a),
        e = minus(t.b, t.a),
        delta = minus(t.a, s.a),
        determinant = cross(d, e)
      if (Math.abs(determinant) > 1e-8) {
        const u = cross(delta, e) / determinant,
          v = cross(delta, d) / determinant
        if (u >= -1e-8 && u <= 1 + 1e-8 && v >= -1e-8 && v <= 1 + 1e-8) {
          s.cuts.push(Math.max(0, Math.min(1, u)))
          t.cuts.push(Math.max(0, Math.min(1, v)))
        }
      } else {
        for (const p of [s.a, s.b]) {
          const q = streetProjection(p, t.a, t.b)
          if (distance(p, q.point) < 0.01) t.cuts.push(q.t)
        }
        for (const p of [t.a, t.b]) {
          const q = streetProjection(p, s.a, s.b)
          if (distance(p, q.point) < 0.01) s.cuts.push(q.t)
        }
      }
    }
  const graph: UrbanStreetGraph = {
    nodes: [],
    edges: [],
    buckets: new SpatialBuckets(128),
    segments: [],
    buildings: new SpatialBuckets(128),
  }
  const ids = new Map<string, number>()
  const node = (p: PointMeters) => {
    const key = `${Math.round(p.x * 1000)}:${Math.round(p.y * 1000)}`
    let id = ids.get(key)
    if (id === undefined) {
      id = graph.nodes.length
      ids.set(key, id)
      graph.nodes.push(p)
      graph.edges.push([])
    }
    return id
  }
  for (const s of raw) {
    const cuts = [...new Set(s.cuts)].sort((a, b) => a - b)
    for (let i = 1; i < cuts.length; i++) {
      const p = at(s.a, s.b, cuts[i - 1]),
        q = at(s.a, s.b, cuts[i]),
        meters = distance(p, q)
      if (meters < 0.01) continue
      const a = node(p),
        b = node(q)
      const minutes = (meters / (70 + 3 * s.lane.width)) * (1 + (s.lane.load ?? 0) / (s.lane.width * 80))
      graph.edges[a].push({ to: b, minutes, meters, lane: s.lane })
      graph.edges[b].push({ to: a, minutes, meters, lane: s.lane })
      graph.buckets.insert(
        graph.segments.length,
        Math.min(p.x, q.x),
        Math.min(p.y, q.y),
        Math.max(p.x, q.x),
        Math.max(p.y, q.y),
      )
      graph.segments.push({ a, b, minutes, meters, lane: s.lane })
    }
  }
  refreshStreetBuildings(w, graph)
  caches.set(w, { month: w.month, revision, streetRevision, lanes, length: lanes.length, graph })
  return graph
}
function refreshStreetBuildings(w: World, graph: UrbanStreetGraph) {
  graph.buildings = new SpatialBuckets(128)
  for (const s of Object.values(w.adaptive?.sites ?? {}))
    if (s.building && s.retired === undefined && !s.premises)
      graph.buildings.insert(
        s,
        Math.min(...s.building.map((p) => p.x)),
        Math.min(...s.building.map((p) => p.y)),
        Math.max(...s.building.map((p) => p.x)),
        Math.max(...s.building.map((p) => p.y)),
      )
}
interface Attachment {
  s: UrbanStreetGraph['segments'][number]
  point: PointMeters
  t: number
  walk: number
}
interface PathTree {
  distances: Map<number, number>
  previous: Map<number, { from: number; lane: SettlementLane }>
  roots: Map<number, Attachment>
}
const queryCaches = new WeakMap<
  UrbanStreetGraph,
  {
    attachments: Map<string, Attachment[]>
    edges: Map<string, boolean>
    trees: Map<string, PathTree>
  }
>()

export function urbanAccessSegment(
  w: World,
  from: PointMeters,
  to: PointMeters,
  ignore: Set<string> = new Set(),
) {
  const cell = w.cells[urbanCellAt(w, from)],
    nation = cell && w.regions[cell.region]?.nation
  if (nation === undefined || !urbanLandSegment(w, from, to, nation) || laneTouchesRiver(w, [from, to], 0))
    return false
  for (const site of urbanStreetGraph(w).buildings.query(
    Math.min(from.x, to.x),
    Math.min(from.y, to.y),
    Math.max(from.x, to.x),
    Math.max(from.y, to.y),
  ))
    if (
      !ignore.has(site.id) &&
      distance(from, site) > 1 &&
      distance(to, site) > 1 &&
      footprintConnection([from, to], site.building!).distance < 0.1
    )
      return false
  return true
}

/** A bounded local route. Undefined means no local network at an endpoint;
 * null means an actual surveyed urban barrier/disconnection. */
export function urbanStreetRoute(w: World, from: PointMeters, to: PointMeters, limit = 60) {
  if (!w.adaptive?.urban?.enabled || distance(from, to) > 2000) return undefined
  const nation = w.regions[w.cells[urbanCellAt(w, from)]?.region]?.nation
  if (nation === undefined || w.regions[w.cells[urbanCellAt(w, to)]?.region]?.nation !== nation) return null
  const g = urbanStreetGraph(w)
  let cache = queryCaches.get(g)
  if (!cache) {
    cache = { attachments: new Map(), edges: new Map(), trees: new Map() }
    queryCaches.set(g, cache)
  }
  const clear = (a: number, b: number) => {
    const key = `${nation}:${Math.min(a, b)}:${Math.max(a, b)}`
    let value = cache!.edges.get(key)
    if (value === undefined) {
      value = urbanLandSegment(w, g.nodes[a], g.nodes[b], nation)
      cache!.edges.set(key, value)
    }
    return value
  }
  const attach = (p: PointMeters) => {
    const key = `${nation}:${p.x}:${p.y}`
    const saved = cache!.attachments.get(key)
    if (saved) return saved
    const candidates = [...g.buckets.query(p.x - 64, p.y - 64, p.x + 64, p.y + 64)]
      .map((id) => {
        const s = g.segments[id],
          q = streetProjection(p, g.nodes[s.a], g.nodes[s.b])
        return { s, ...q, walk: distance(p, q.point) / (4000 / 60) }
      })
      .filter((a) => a.walk <= 64 / (4000 / 60))
      .sort((a, b) => a.walk - b.walk || a.s.a - b.s.a)
    const result: Attachment[] = []
    for (const a of candidates) {
      if (clear(a.s.a, a.s.b) && urbanAccessSegment(w, p, a.point)) result.push(a)
      if (result.length === 3) break
    }
    if (cache!.attachments.size >= 8192) cache!.attachments.clear()
    cache!.attachments.set(key, result)
    return result
  }
  const starts = attach(from),
    ends = attach(to)
  if (!starts.length || !ends.length) return undefined
  const treeKey = `${nation}:${from.x}:${from.y}:${limit}`
  let tree = cache.trees.get(treeKey)
  if (!tree) {
    const distances = new Map<number, number>(),
      previous = new Map<number, { from: number; lane: SettlementLane }>(),
      roots = new Map<number, Attachment>()
    const queue = new MinHeap()
    for (const a of starts)
      for (const [node, cost] of [
        [a.s.a, a.walk + a.s.minutes * a.t],
        [a.s.b, a.walk + a.s.minutes * (1 - a.t)],
      ]) {
        if (cost < (distances.get(node) ?? Infinity)) {
          distances.set(node, cost)
          queue.push(node, cost)
          roots.set(node, a)
        }
      }
    while (queue.size) {
      const cur = queue.pop()
      if (cur.cost !== distances.get(cur.id) || cur.cost > limit) continue
      for (const e of g.edges[cur.id]) {
        const cost = cur.cost + e.minutes
        if (
          cost > limit ||
          cost >= (distances.get(e.to) ?? Infinity) ||
          distance(from, g.nodes[e.to]) > 2600 ||
          !clear(cur.id, e.to)
        )
          continue
        distances.set(e.to, cost)
        previous.set(e.to, { from: cur.id, lane: e.lane })
        queue.push(e.to, cost)
        roots.set(e.to, roots.get(cur.id)!)
      }
    }
    tree = { distances, previous, roots }
    if (cache.trees.size >= 16) cache.trees.delete(cache.trees.keys().next().value!)
    cache.trees.set(treeKey, tree)
  }
  const { distances, previous, roots } = tree
  let best = Infinity,
    end = -1,
    endpointLanes: SettlementLane[] = [],
    departure: PointMeters | undefined,
    arrival: PointMeters | undefined
  for (const a of starts)
    for (const b of ends)
      if (a.s === b.s) {
        const cost = a.walk + b.walk + Math.abs(a.t - b.t) * a.s.minutes
        if (cost < best) {
          best = cost
          endpointLanes = [a.s.lane]
          departure = a.point
          arrival = b.point
        }
      }
  for (const e of ends)
    for (const [node, tail] of [
      [e.s.a, e.s.minutes * e.t],
      [e.s.b, e.s.minutes * (1 - e.t)],
    ]) {
      const cost = (distances.get(node) ?? Infinity) + e.walk + tail
      if (cost < best) {
        best = cost
        end = node
        endpointLanes = [roots.get(node)!.s.lane, e.s.lane]
        departure = roots.get(node)!.point
        arrival = e.point
      }
    }
  if (!Number.isFinite(best) || best > limit) return null
  const lanes = new Set<SettlementLane>(endpointLanes),
    points: PointMeters[] = arrival ? [arrival, to] : [to]
  while (end >= 0) {
    points.unshift(g.nodes[end])
    const prev = previous.get(end)
    if (!prev) break
    lanes.add(prev.lane)
    end = prev.from
  }
  if (departure) points.unshift(departure)
  points.unshift(from)
  if (!lanes.size) for (const a of starts) for (const b of ends) if (a.s === b.s) lanes.add(a.s.lane)
  return {
    minutes: best,
    points,
    lanes: [...lanes],
    mode: 'walk' as const,
    cells: [...new Set(points.map((p) => urbanCellAt(w, p)))],
  }
}
