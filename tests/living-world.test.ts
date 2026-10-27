import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { generateWorld } from '../src/sim/generate'
import { tick, applyCommand } from '../src/sim/engine'
import { economicLandscape, TILE_ACTIVITIES } from '../src/sim/economic-landscape'
import { localClimate } from '../src/sim/climate'
import { viewSnapshot } from '../src/sim/view-snapshot'
import { activityLayout } from '../src/map/activity-layout'
import { ActivityScenery, ACTIVITY_CACHE_LIMIT } from '../src/map/activity-scenery'
import { TerrainPicker } from '../src/map/relief-picking'
import { corridorProfile } from '../src/sim/corridors'
import { transportNetwork } from '../src/sim/transport'
import { balances, beginLedgerMonth } from '../src/sim/ledger'
import { validateWorld, restoreWorld } from '../src/sim/persistence'
import { packWorldSave } from '../src/sim/save-codec'
import { canonicalHash } from './fixtures/world-hash'
import { acceptStatePlan } from '../src/sim/statecraft'
import { CELL_SIZE } from '../src/sim/grid'

test('geographic growing seasons reverse between hemispheres and preserve annual mean output', () => {
  const w = generateWorld('Climate geography'),
    c = w.cells.find((c) => c.terrain === 'plains')!
  for (const r of [0, Math.floor(w.height / 2), w.height - 1]) {
    const values = Array.from({ length: 12 }, (_, month) => localClimate({ ...w, month }, { ...c, r }).season)
    assert(Math.abs(values.reduce((a, b) => a + b) / 12 - 1) < 1e-12)
    assert(values.every((x) => x >= 0.77 && x <= 1.23))
  }
  assert.equal(localClimate(w, { ...c, r: 0 }).biome, 'polar')
  assert.equal(
    localClimate(w, { ...c, r: Math.floor(w.height / 2), terrain: 'desert', moisture: 0.1 }).biome,
    'arid',
  )
  const north = localClimate({ ...w, month: 7 }, { ...c, r: Math.floor(w.height * 0.25) }).season
  const south = localClimate(
    { ...w, month: 1 },
    { ...c, r: w.height - 1 - Math.floor(w.height * 0.25) },
  ).season
  assert(Math.abs(north - south) < 1e-12)
})

test('economic tile projection and detailed observation leave the canonical world untouched', () => {
  const w = generateWorld('Living landscape observers')
  tick(w)
  const before = canonicalHash(w),
    land = economicLandscape(w)
  const all = viewSnapshot(w),
    none = viewSnapshot(w, null)
  assert.deepEqual(
    all.viewLandscape,
    none.viewLandscape,
    'dossier subscription cannot remove economic activity',
  )
  for (const c of w.cells.filter((c) => c.terrain !== 'water').slice(0, 30)) {
    assert.deepEqual(activityLayout(w, land, c.id), activityLayout(w, land, c.id))
  }
  assert.equal(canonicalHash(w), before)
  assert(
    Math.abs(
      Array.from(land.residents).reduce((a, b) => a + b) -
        w.regions.reduce(
          (sum, r) => sum + r.population.children + r.population.adults + r.population.elders,
          0,
        ),
    ) < 1e-6,
  )
  assert(land.workers.some((n) => n > 0))
  assert(land.activity.includes(TILE_ACTIVITIES.indexOf('forest')), 'diffuse farm jobs retain woodland')
  assert(land.activity.includes(TILE_ACTIVITIES.indexOf('pasture')), 'dry and cold farms show grazing land')
  assert(
    Math.abs(
      Array.from(land.workers).reduce((a, b) => a + b, 0) -
        w.economy!.firms!.filter((f) => f.active).reduce((sum, f) => sum + f.employment, 0),
    ) < 1e-6,
    'tile job attribution preserves the employment total',
  )
})

test('distinct tile activities produce identifiable facilities, dense woods and finite geometry', () => {
  const w = generateWorld('Activity anatomy'),
    land = economicLandscape(w),
    cell = w.cells.find((c) => c.terrain === 'plains' && !c.river)!
  for (const [use, role] of [
    ['fields', 'farmhouse'],
    ['pasture', 'livestock'],
    ['forest', 'tree'],
    ['timber', 'sawmill'],
    ['quarry', 'quarry-bench'],
    ['iron', 'headframe'],
    ['coal', 'ore-pile'],
    ['workshops', 'workshop'],
  ] as const) {
    land.activity[cell.id] = TILE_ACTIVITIES.indexOf(use)
    const plan = activityLayout(w, land, cell.id)
    assert(
      plan.pieces.some((p) => p.role === role),
      `${use} needs ${role}`,
    )
    assert(plan.pieces.every((p) => [p.x, p.z, p.y, p.w, p.h, p.d, p.angle].every(Number.isFinite)))
    if (use === 'forest') assert(plan.pieces.filter((p) => p.role === 'tree').length > 100)
  }
  const harbor = land.harbors[0]
  assert(harbor)
  assert(activityLayout(w, land, harbor.cell).pieces.some((p) => p.role === 'pier'))
  assert(
    !activityLayout(w, land, cell.id).pieces.some((p) => p.role === 'pier') ||
      land.harbors.some((h) => h.cell === cell.id),
  )
})

test('detail and moving-instance budgets stay bounded while touring the map', () => {
  const w = generateWorld('Observation budgets'),
    land = economicLandscape(w)
  w.viewLandscape = land
  const plane = new THREE.PlaneGeometry(w.width * CELL_SIZE, w.height * CELL_SIZE)
    .rotateX(-Math.PI / 2)
    .translate((w.width * CELL_SIZE) / 2, 0, (w.height * CELL_SIZE) / 2)
  const scenery = new ActivityScenery(w, new TerrainPicker(plane)),
    camera = new THREE.OrthographicCamera(-28, 28, 28, -28, 1, 2000)
  try {
    for (const c of w.cells
      .filter((c) => c.terrain !== 'water')
      .filter((_, i) => i % 70 === 0)
      .slice(0, 12)) {
      camera.position.set(c.x, 1000, c.y)
      camera.up.set(0, 0, -1)
      camera.lookAt(c.x, 0, c.y)
      camera.updateMatrixWorld()
      scenery.view(camera, 800, 800, 14)
      assert(scenery.stats.visible <= 100, 'the viewport bounds activity work')
      assert(scenery.stats.cached <= ACTIVITY_CACHE_LIMIT)
      assert(scenery.stats.moving <= 600, 'screen-sized detail remains bounded')
      assert(
        scenery.group.children.length <= 10,
        'props and actors are instanced, not a draw call per person',
      )
      scenery.animate(5)
      const matrices = scenery.group.children.map((c) =>
        (c as THREE.InstancedMesh).instanceMatrix.array.slice(),
      )
      scenery.animate(5)
      assert.deepEqual(
        scenery.group.children.map((c) => (c as THREE.InstancedMesh).instanceMatrix.array),
        matrices,
        'paused time remains frozen',
      )
    }
    scenery.view(camera, 800, 800, 1)
    assert.equal(scenery.group.visible, false)
  } finally {
    scenery.dispose()
    plane.dispose()
  }
})

test('funded transport changes capacity, persists and rejects free, inland or premature upgrades', () => {
  const w = generateWorld('Public works'),
    r = w.regions.find((r) => r.coastal)!,
    n = w.nations[r.nation]
  n.technologies.logistics = 3
  for (const g of ['timber', 'stone', 'iron', 'tools'] as const) r.stocks[g] = 1000
  beginLedgerMonth(w)
  const before = Object.values(balances(w)).reduce((a, b) => a + b, 0),
    profiles = corridorProfile(w)
  acceptStatePlan(
    w,
    n.id,
    {
      assessment: 'Improve freight access.',
      strategy: 'Invest in the existing road network.',
      memory: '',
      goals: [],
      escalate: false,
      reason: '',
      messages: [],
      offers: [],
      answers: [],
      orders: [{ kind: 'build', target: r.id, key: '', value: 0, text: 'paved-road' }],
    },
    true,
    'fixture',
    w.month,
  )
  assert.equal(r.publicWorks?.road, 'paved')
  const after = Object.values(balances(w)).reduce((a, b) => a + b, 0)
  assert(Math.abs(after - before) < 1e-6, 'public construction transfers, rather than destroys, money')
  assert.equal(r.stocks.stone, 840)
  assert.match(applyCommand(w, { type: 'build', region: r.id, building: 'railway' }), /completed/)
  assert.equal(r.publicWorks?.road, 'rail')
  assert.match(applyCommand(w, { type: 'build', region: r.id, building: 'port' }), /completed/)
  const updated = corridorProfile(w)
  const h = transportNetwork(w).harbors.find((h) => h.region === r.id)!
  const i = updated.index(h.land, h.water)
  assert(updated.capacity[i] > profiles.capacity[i])
  const paid = canonicalHash(w)
  assert.match(applyCommand(w, { type: 'build', region: r.id, building: 'railway' }), /already/)
  assert.equal(canonicalHash(w), paid)
  validateWorld(w)
  const restored = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(w))))
  assert.deepEqual(restored.regions[r.id].publicWorks, r.publicWorks)
  const inland = w.regions.find((r) => !r.coastal)!
  w.nations[inland.nation].technologies.logistics = 3
  assert.match(applyCommand(w, { type: 'build', region: inland.id, building: 'port' }), /coastal/)
  n.technologies.logistics = 0
  assert.match(applyCommand(w, { type: 'build', region: r.id, building: 'port' }), /logistics/)
  const invalid = structuredClone(restored)
  invalid.regions[r.id].publicWorks!.harbor = 999
  assert.throws(() => validateWorld(invalid), /transport works/)
})
