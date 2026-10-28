import test from 'node:test'
import assert from 'node:assert/strict'
import { CELL_METERS, CELL_SIZE } from '../src/sim/grid'
import { METERS_PER_MAP_UNIT } from '../src/sim/physical-space'
import { type World } from '../src/sim/types'
import { type SettlementLane } from '../src/sim/adaptive-types'
import { laneTouchesRiver, surveyRiverBridge, reconcileRiverLanes, RIVER_ROADS } from '../src/sim/river-lanes'
import { inRiverChannel, riverCurves, riverPoint, riverSectionsNear } from '../src/map/rivers'
import { generateWorld } from '../src/sim/generate'
import { prepareSpatialWorld, tick } from '../src/sim/engine'
import { validateWorld, restoreWorld } from '../src/sim/persistence'
import { packWorldSave } from '../src/sim/save-codec'
import { groundRoads } from '../src/map/ground-roads'
import { fastForwardStep } from '../src/sim/fast-forward'
import { EXPANSION_PROFILES, withExpansionParameters } from '../src/sim/expansion-parameters'

function channel(flow = 12) {
  const width = 9,
    height = 9
  const cells = Array.from({ length: width * height }, (_, id) => {
    const q = id % width,
      r = Math.floor(id / width)
    return {
      id,
      q,
      r,
      x: (q + 0.5) * CELL_SIZE,
      y: (r + 0.5) * CELL_SIZE,
      terrain: 'grassland',
      elevation: 0.4 - r * 0.001,
      river: q === 4,
      riverFlow: flow,
      downstream: q === 4 && r < height - 1 ? id + width : undefined,
    }
  })
  const w = {
    cells,
    width,
    height,
    month: 0,
    adaptive: { metersPerMapUnit: METERS_PER_MAP_UNIT, sites: {}, lanes: [], revision: 0 },
    localEconomy: { units: { 0: { cells: cells.map((c) => c.id) } } },
  } as unknown as World
  return { w, x: 4.5 * CELL_METERS, y: 4.5 * CELL_METERS }
}

test('a bridge approach anchored at a house records coordinates rather than a live census object', () => {
  const w = generateWorld('Maritime republics', 3, 8, undefined, 'regional', 'frontier')
  withExpansionParameters(EXPANSION_PROFILES.baseline, () => {
    fastForwardStep(w)
    fastForwardStep(w)
  })
  const lanes = w.adaptive!.lanes!
  assert(lanes.some((lane) => lane.bridge && lane.founded === 12))
  const saved = JSON.stringify(lanes)
  for (const site of Object.values(w.adaptive!.sites)) if (site.residents !== undefined) site.residents++
  assert.equal(JSON.stringify(lanes), saved, 'a census change cannot mutate recorded road geometry')
})

test('a surveyed bridge is short, perpendicular and dry at both abutments', () => {
  const { w, x, y } = channel()
  const origin = { x: x - 80, y }
  const before = JSON.stringify(w)
  const bridge = surveyRiverBridge(w, origin, [], () => true)!
  assert(bridge)
  const [a, b] = bridge.points
  assert(Math.abs(a.y - b.y) < 1e-6)
  assert((a.x - x) * (b.x - x) < 0)
  assert(Math.hypot(a.x - b.x, a.y - b.y) < RIVER_ROADS.maxSpan)
  assert(!laneTouchesRiver(w, [a], 5.5) && !laneTouchesRiver(w, [b], 5.5))
  assert(laneTouchesRiver(w, [a, b], 5.5))
  assert.deepEqual(
    surveyRiverBridge(w, origin, [], () => true),
    bridge,
  )
  assert.equal(JSON.stringify(w), before, 'survey must be read-only')
})

test('nearby streets reuse a crossing; broad rivers and blocked banks cannot create bridges', () => {
  const { w, x, y } = channel()
  const origin = { x: x - 80, y }
  const bridge = surveyRiverBridge(w, origin, [], () => true)!
  const lane: SettlementLane = { pool: 0, founded: 0, width: 5.5, points: bridge.points, bridge: true }
  assert.equal(
    surveyRiverBridge(w, { ...origin, y: y + 30 }, [lane], () => true),
    undefined,
  )
  assert.equal(
    surveyRiverBridge(w, origin, [], () => false),
    undefined,
  )
  const wide = channel(100000)
  assert.equal(
    surveyRiverBridge(wide.w, { x: wide.x - 270, y: wide.y }, [], () => true),
    undefined,
  )
})

test('bends use the local river normal and confluences move the crossing away from the junction', () => {
  const bend = channel()
  bend.w.cells.forEach((c) => {
    c.river = false
    delete c.downstream
  })
  const chain = [4, 4, 5, 5, 4, 4, 5, 5, 4].map((q, r) => r * bend.w.width + q)
  chain.forEach((id, i) => {
    bend.w.cells[id].river = true
    bend.w.cells[id].downstream = chain[i + 1]
  })
  const curve = riverCurves(bend.w)[1]
  assert(curve)
  const p = riverPoint(curve, 0.5),
    scale = METERS_PER_MAP_UNIT
  const section = riverSectionsNear(bend.w, p, 1)[0]
  const origin = { x: p.x * scale - section.tangent.y * 70, y: p.y * scale + section.tangent.x * 70 }
  const bridge = surveyRiverBridge(bend.w, origin, [], () => true)!
  assert(bridge)
  const [a, b] = bridge.points
  const center = { x: (a.x + b.x) / 2 / scale, y: (a.y + b.y) / 2 / scale }
  const tangent = riverSectionsNear(bend.w, center, 1)[0].tangent
  assert(
    Math.abs(((b.x - a.x) * tangent.x + (b.y - a.y) * tangent.y) / Math.hypot(b.x - a.x, b.y - a.y)) < 0.05,
  )
  const junction = channel()
  for (let q = 1; q < 4; q++) {
    const c = junction.w.cells[4 * junction.w.width + q]
    c.river = true
    c.downstream = c.id + 1
  }
  const crossing = surveyRiverBridge(junction.w, { x: junction.x + 70, y: junction.y }, [], () => true)!
  assert(crossing)
  const mid = {
    x: (crossing.points[0].x + crossing.points[1].x) / 2,
    y: (crossing.points[0].y + crossing.points[1].y) / 2,
  }
  assert(Math.hypot(mid.x - junction.x, mid.y - junction.y) > 40, 'do not bridge through the confluence')
  assert(crossing.points.every((p) => !laneTouchesRiver(junction.w, [p], 5.5)))
})

test('repair cannot add a bridge across sea, occupied abutments or steep banks', () => {
  for (const obstacle of ['sea', 'building', 'slope'] as const) {
    const { w, x, y } = channel()
    w.adaptive!.lanes = [
      {
        pool: 0,
        founded: 0,
        width: 5.5,
        points: [
          { x: x - 130, y },
          { x: x + 130, y },
        ],
      },
    ]
    if (obstacle === 'sea') w.cells[4 * w.width + 4].terrain = 'water'
    if (obstacle === 'slope')
      w.cells.forEach((c) => {
        c.elevation = c.q <= 3 ? 0 : 1
      })
    if (obstacle === 'building')
      w.adaptive!.sites.block = {
        building: [
          { x: x - 500, y: y - 500 },
          { x: x + 500, y: y - 500 },
          { x: x + 500, y: y + 500 },
          { x: x - 500, y: y + 500 },
        ],
      } as any
    const sites = JSON.stringify(w.adaptive!.sites)
    reconcileRiverLanes(w)
    assert.equal(w.adaptive!.lanes!.filter((l) => l.bridge).length, 0, obstacle)
    assert.equal(JSON.stringify(w.adaptive!.sites), sites)
  }
})

test('old water-crossing tangles become dry streets and a connected shared bridge, without moving homes', () => {
  const { w, x, y } = channel()
  w.adaptive!.lanes = [-60, 0, 60].map((dy) => ({
    pool: 0,
    founded: 0,
    width: 5.5,
    points: [
      { x: x - 130, y: y + dy },
      { x: x + 130, y: y + dy + 25 },
    ],
  }))
  const sites = JSON.stringify(w.adaptive!.sites)
  assert(reconcileRiverLanes(w))
  const lanes = w.adaptive!.lanes!
  assert(
    lanes.every((lane) =>
      lane.points.every((p) => Object.keys(p).every((key) => key === 'x' || key === 'y')),
    ),
    'street geometry must not retain mutable residential records',
  )
  const bridges = lanes.filter((l) => l.bridge)
  assert.equal(bridges.length, 1)
  assert(
    lanes
      .filter((l) => !l.bridge)
      .every((l) => l.points.slice(1).every((p, i) => !laneTouchesRiver(w, [l.points[i], p], l.width))),
  )
  for (const end of bridges[0].points)
    assert(
      lanes.some((l) => !l.bridge && l.points.some((p) => Math.hypot(p.x - end.x, p.y - end.y) < 0.01)),
      'bridge joins an actual dry street at both ends',
    )
  assert.equal(JSON.stringify(w.adaptive!.sites), sites)
  const repaired = JSON.stringify(w)
  assert(!reconcileRiverLanes(w))
  assert.equal(JSON.stringify(w), repaired)
})

test('new riverside cities retain dry roads, shared crossings and valid save geometry as they grow', () => {
  const w = generateWorld('Quadtree urban validation', 3, 8, undefined, 'regional', 'frontier')
  prepareSpatialWorld(w)
  for (let i = 0; i < 3; i++) tick(w)
  const lanes = w.adaptive!.lanes!
  const bridges = lanes.filter((l) => l.bridge)
  assert(bridges.length > 0, 'the riverside fixture must exercise a real crossing')
  const wet = lanes.filter(
    (l) => !l.bridge && l.points.slice(1).some((p, i) => laneTouchesRiver(w, [l.points[i], p], l.width)),
  )
  assert.equal(wet.length, 0)
  const scale = w.adaptive!.metersPerMapUnit
  assert(
    Object.values(w.adaptive!.sites)
      .filter((s) => s.building)
      .every(
        (s) =>
          !inRiverChannel(
            w,
            s.building!.map((p) => ({ x: p.x / scale, y: p.y / scale })),
          ),
      ),
  )
  assert.equal(groundRoads(w).filter((r) => r.kind === 'bridge').length, bridges.length)
  validateWorld(w)
  const saved = packWorldSave(w)
  const restored = restoreWorld(JSON.parse(JSON.stringify(saved)))
  assert.deepEqual(restored.adaptive!.lanes, lanes)
  const invalid = structuredClone(w)
  invalid.adaptive!.lanes!.find((l) => l.bridge)!.points.push({ ...bridges[0].points[0] })
  assert.throws(() => validateWorld(invalid), /lane/)
})
