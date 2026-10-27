import test from 'node:test'
import assert from 'node:assert/strict'
import { tradeRoadEdges, orientedRoadCurves, roadKey, type RoadPoint } from '../src/map/road-curves'
import { groundRoads, drawGroundRoads } from '../src/map/ground-roads'
import { freightOverlay, pointAlong, routeDistance } from '../src/map/trade'
import { CELL_SIZE, cellAt } from '../src/sim/grid'
import { habitableLand } from '../src/sim/terrain-access'
import { inventory, type Cell, type World, type Region } from '../src/sim/types'

function fixture(path = [17, 18, 19, 27, 35, 36]) {
  const cells = Array.from({ length: 64 }, (_, id): Cell => ({
    id,
    q: id % 8,
    r: Math.floor(id / 8),
    x: ((id % 8) + 0.5) * CELL_SIZE,
    y: (Math.floor(id / 8) + 0.5) * CELL_SIZE,
    elevation: 0.2,
    terrain: 'plains',
    moisture: 0.5,
    river: false,
    region: id === path.at(-1) ? 1 : 0,
  }))
  return {
    cells,
    width: 8,
    height: 8,
    month: 0,
    seed: 'Curved roads',
    regions: [
      { id: 0, nation: 0, center: path[0] },
      { id: 1, nation: 0, center: path.at(-1)! },
    ] as Region[],
    routes: [
      {
        id: 'freight',
        from: 0,
        to: 1,
        path: [0, 1],
        legs: [{ mode: 'land', cells: path }],
        sea: false,
        goods: inventory(),
        volume: 20,
        value: 10,
        capacity: 40,
        international: false,
      },
    ],
  } as World
}
const vector = (a: RoadPoint, b: RoadPoint) => ({ x: b.x - a.x, y: b.y - a.y })
const close = (a: RoadPoint, b: RoadPoint) => assert(Math.hypot(a.x - b.x, a.y - b.y) < 1e-9)

test('land roads join smoothly through bends and share geometry with freight in both directions', () => {
  const w = fixture(),
    before = JSON.stringify(w),
    physicalDistance = routeDistance(w, w.routes[0])
  const edges = tradeRoadEdges(w),
    path = w.routes[0].legs![0].cells
  const curves = path
    .slice(1)
    .flatMap((to, i) => orientedRoadCurves(edges.get(roadKey(path[i], to))!, path[i]))
  for (let i = 1; i < curves.length; i++) {
    close(curves[i - 1].to, curves[i].from)
    const incoming = vector(curves[i - 1].control, curves[i - 1].to),
      outgoing = vector(curves[i].from, curves[i].control)
    assert(
      Math.abs(incoming.x * outgoing.y - incoming.y * outgoing.x) < 1e-9,
      'no kink between halves or edges',
    )
    assert(incoming.x * outgoing.x + incoming.y * outgoing.y > 0)
  }
  assert(
    curves.some(
      (c) =>
        Math.abs(
          (c.control.x - c.from.x) * (c.to.y - c.from.y) - (c.control.y - c.from.y) * (c.to.x - c.from.x),
        ) > 1,
    ),
  )
  const shown = freightOverlay(w, 0, null).corridors[0]
  assert.deepEqual(shown.curves, curves)
  for (let i = 0; i < shown.points!.length; i++)
    close(pointAlong(w, shown, shown.lengths[i]), shown.points![i])
  close(pointAlong(w, shown, -1), w.cells[path[0]])
  close(pointAlong(w, shown, Infinity), w.cells[path.at(-1)!])
  const edge = edges.values().next().value!
  const back = orientedRoadCurves(edge, edge.b)
  close(back[0].from, edge.curves.at(-1)!.to)
  close(back.at(-1)!.to, edge.curves[0].from)
  assert.equal(routeDistance(w, w.routes[0]), physicalDistance, 'only presentation distance changes')
  assert.equal(JSON.stringify(w), before, 'drawing is read-only')
  assert.equal(tradeRoadEdges(w), edges, 'camera frames reuse curves')
})

test('curves stay in the traversed land cells beside high mountains and water', () => {
  const path = [17, 18, 19, 27, 35, 36],
    w = fixture(path)
  for (const c of w.cells)
    if (!path.includes(c.id)) {
      c.terrain = c.id % 2 ? 'water' : 'mountains'
      c.elevation = c.id % 2 ? 0 : 0.9
    }
  const edges = tradeRoadEdges(w)
  assert.equal(edges.size, path.length - 1)
  for (const edge of edges.values())
    for (const p of edge.points) {
      const id = cellAt(p.x, p.y, w.width, w.height)!
      assert(habitableLand(w.cells[id]))
      assert(path.includes(id), 'no cross-country shortcut around a bend')
    }
})

test('junctions and surveyed building frontages retain exact connections; duplicate edges paint once', () => {
  const w = fixture()
  w.corridors = [
    { a: 19, b: 20, familiarity: 0.7, traffic: 20 },
    { a: 18, b: 19, familiarity: 0.7, traffic: 10 },
  ]
  w.viewHomes = [{ cell: 35, building: [{ x: 1, y: 1 }] }] as World['viewHomes']
  const edges = tradeRoadEdges(w)
  assert.equal(edges.size, 6)
  for (const next of [18, 27, 20])
    close(orientedRoadCurves(edges.get(roadKey(19, next))!, 19)[0].from, w.cells[19])
  close(orientedRoadCurves(edges.get(roadKey(27, 35))!, 35)[0].from, w.cells[35])
  close(orientedRoadCurves(edges.get(roadKey(35, 36))!, 35)[0].from, w.cells[35])
  assert.equal(groundRoads(w).length, 6)
  w.routes = []
  assert.equal(tradeRoadEdges(w).size, 2, 'a replacement route snapshot invalidates the cache')
})

test('closed roads have no seam and shipping never becomes a curved land track', () => {
  const w = fixture([18, 19, 27, 26, 18])
  w.regions[0].center = 0
  w.regions[1].center = 63
  const roads = tradeRoadEdges(w)
  assert.equal(roads.size, 4)
  const first = orientedRoadCurves(roads.get(roadKey(18, 19))!, 18)[0]
  const last = orientedRoadCurves(roads.get(roadKey(26, 18))!, 26).at(-1)!
  close(first.from, last.to)
  w.routes = [{ ...w.routes[0], legs: [{ mode: 'sea', cells: [0, 1, 2] }], sea: true }]
  w.cells[1].terrain = 'water'
  assert.equal(tradeRoadEdges(w).size, 0)
})

test('shared road shoulders paint in one batch rather than overlapping end caps', () => {
  const w = fixture(),
    old = globalThis.Path2D
  const strokes: unknown[] = []
  class Path {
    curves = 0
    moveTo() {}
    lineTo() {}
    quadraticCurveTo() {
      this.curves++
    }
  }
  globalThis.Path2D = Path as unknown as typeof Path2D
  try {
    const ctx = {
      save() {},
      restore() {},
      clip() {},
      setLineDash() {},
      stroke(path: Path) {
        strokes.push(path)
      },
    }
    drawGroundRoads(
      ctx as unknown as CanvasRenderingContext2D,
      w,
      4,
      { x: 0, y: 0, width: 96, height: 96 },
      new Path2D(),
    )
    assert.equal(strokes.length, 3, 'shoulder, earth, pigment each paint once across the network')
    assert(strokes.every((s) => s === strokes[0]))
    assert.equal((strokes[0] as Path).curves, 10)
  } finally {
    globalThis.Path2D = old
  }
})
