import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { ensureFirms } from '../src/sim/firms'
import { advanceDestructiveRaids } from '../src/sim/destructive-raids'
import { establishControl } from '../src/sim/military-control'
import { ensureWarfare } from '../src/sim/navy'
import { ensureAdaptiveWorld, syncSites } from '../src/sim/adaptive-world'
import { ensureResidentialSites } from '../src/sim/residential-sites'
import { ensureUrbanFabric, validateUrbanFabric } from '../src/sim/urban-fabric'
import { urbanShape, advanceUrbanConstruction } from '../src/sim/urban-construction'
import { applyCommand } from '../src/sim/commands'
import { economicRegions, provinceId, localFirmRegion } from '../src/sim/local-units'
import { balances, auditLedger } from '../src/sim/ledger'
import { beginGoodsMonth, auditGoods } from '../src/sim/goods-accounting'
import { validateWorld, restoreWorld } from '../src/sim/persistence'
import { packWorldSave } from '../src/sim/save-codec'
import { validateGeopolitics } from '../src/sim/geopolitics-persistence'
import { relation, population } from '../src/sim/types'
import { rebaseEndowments } from './fixtures/endowment'

function fixture() {
  const w = generateWorld('destructive raids', 3, 4)
  ensureWarfare(w)
  ensureFirms(w)
  ensureAdaptiveWorld(w)
  ensureResidentialSites(w)
  ensureUrbanFabric(w)
  const a = w.armies.find((a) => a.nation === 0)!
  const r = w.regions.find((r) => r.nation === 1 && r.id !== w.nations[1].capital)!
  for (const n of w.nations) n.ai = false
  for (const enemy of w.armies.filter((a) => a.nation === 1)) enemy.region = w.nations[1].capital
  a.region = r.id
  a.target = null
  a.supply = a.morale = a.operations!.cohesion = 1
  a.operations!.fatigue = a.operations!.disorder = 0
  a.operations!.arms = 10000
  a.operations!.stance = 'hold'
  a.operations!.conduct = 'raze'
  relation(w, 0, 1)!.treaty = 'war'
  establishControl(w, r.id, 0)
  const own = economicRegions(w).filter((u) => provinceId(u) === r.id)
  const ids = new Set(own.map((u) => u.id))
  const firms = w.economy!.firms!.filter((f) => ids.has(localFirmRegion(f)))
  const homes = Object.values(w.adaptive!.sites).filter(
    (s) => s.kind === 'residential' && w.cells[s.cell].region === r.id,
  )
  r.infrastructure = 1
  r.publicWorks = { road: 'rail' }
  for (const u of own) u.infrastructure = 1
  rebaseEndowments(w)
  beginGoodsMonth(w)
  return { w, a, r, own, firms, homes }
}

test('destructive raids reduce actual capital and housing while conserving money and residents', () => {
  const { w, a, r, own, firms, homes } = fixture()
  const capital = firms.reduce((sum, f) => sum + f.capital, 0)
  own[0].devastation = 0.95
  const housing = homes.reduce((sum, s) => sum + s.capacity, 0)
  const cash = balances(w),
    people = w.regions.reduce((sum, r) => sum + population(r), 0)
  const residents = homes.map((s) => s.residents),
    ammunition = a.operations!.arms
  const neutral = w.regions.find((r) => r.nation === 2)!.infrastructure
  advanceDestructiveRaids(w)
  assert(firms.reduce((sum, f) => sum + f.capital, 0) < capital)
  assert(homes.reduce((sum, s) => sum + s.capacity, 0) < housing)
  assert(own.every((u) => u.infrastructure < 1 && u.devastation > 0))
  assert.equal(own[0].devastation, 0.95, 'raiding cannot heal earlier devastation')
  assert(r.infrastructure < 1)
  assert.notEqual(r.publicWorks!.road, 'rail')
  assert.equal(w.regions.find((r) => r.nation === 2)!.infrastructure, neutral)
  assert.deepEqual(balances(w), cash)
  assert.deepEqual(
    homes.map((s) => s.residents),
    residents,
  )
  assert.equal(
    w.regions.reduce((sum, r) => sum + population(r), 0),
    people,
  )
  assert(a.operations!.arms < ammunition)
  syncSites(w)
  auditLedger(w)
  auditGoods(w)
  validateUrbanFabric(w)
  validateWorld(w)
})

test('peace, absent occupation, marching, disorder, embarkation and missing supplies prevent destruction', () => {
  const { w, a, r, homes } = fixture()
  const capacity = homes[0].capacity,
    ammo = a.operations!.arms
  for (const change of [
    () => {
      relation(w, 0, 1)!.treaty = 'truce'
    },
    () => {
      delete r.control
    },
    () => {
      a.operations!.stance = 'march'
    },
    () => {
      a.operations!.disorder = 1
    },
    () => {
      a.operations!.embarkedOn = 1
    },
    () => {
      a.supply = 0
    },
    () => {
      a.operations!.arms = 0
    },
    () => {
      a.operations!.conduct = 'pillage'
    },
  ]) {
    relation(w, 0, 1)!.treaty = 'war'
    establishControl(w, r.id, 0)
    Object.assign(a.operations!, {
      stance: 'hold',
      conduct: 'raze',
      disorder: 0,
      embarkedOn: null,
      arms: ammo,
    })
    a.supply = 1
    change()
    const before = a.operations!.arms
    advanceDestructiveRaids(w)
    assert.equal(homes[0].capacity, capacity)
    assert.equal(a.operations!.arms, before)
    assert.equal(r.control?.destruction, undefined)
  }
})

test('splitting formations gives the same damage and a saved monthly guard prevents repeat raids', () => {
  const { w, a, r } = fixture()
  const split = structuredClone(w),
    original = split.armies.find((x) => x.id === a.id)!
  const second = structuredClone(original)
  second.id = split.nextArmy++
  original.soldiers /= 2
  second.soldiers /= 2
  original.operations!.arms /= 2
  second.operations!.arms /= 2
  split.armies.push(second)
  advanceDestructiveRaids(w)
  advanceDestructiveRaids(split)
  assert.deepEqual(split.regions[r.id].control!.destruction, r.control!.destruction)
  const restored = restoreWorld(packWorldSave(w))
  const before = JSON.stringify(restored)
  advanceDestructiveRaids(restored)
  assert.equal(JSON.stringify(restored), before)
  restored.regions[r.id].control!.destruction!.housing = -1
  assert.throws(() => validateGeopolitics(restored), /Invalid strategic/)
})

test('sustained raids demolish roads, housing and factories; cancelled blueprints cannot recreate them', () => {
  const { w, r, homes, firms, own } = fixture()
  const home = homes.find((s) => s.building) ?? homes[0]
  // A surveyed test building uses the existing legal parcel, not invented people.
  if (!home.building) {
    const p = home.parcel!
    home.building = [
      { x: p.x + 2, y: p.y + 2 },
      { x: p.x + 10, y: p.y + 2 },
      { x: p.x + 10, y: p.y + 10 },
      { x: p.x + 2, y: p.y + 10 },
    ]
  }
  const shape = urbanShape(home)
  const project = {
    id: w.adaptive!.urban!.nextProject++,
    kind: 'repair' as const,
    status: 'funded' as const,
    proposed: w.month,
    started: w.month,
    sponsor: `producer:${home.pool}`,
    pool: home.pool,
    host: home.pool,
    sites: [home.id],
    reason: 'Test funded repair',
    benefit: 1,
    cost: 2,
    inputs: { timber: 1, stone: 1, labor: 1 },
    duration: 6,
    before: [shape],
    after: [structuredClone(shape)],
    displaced: [],
  }
  w.adaptive!.urban!.projects.push(project)
  w.adaptive!.construction = [{ site: home.id, capacity: 100, cost: 1, remaining: 6 }]
  w.adaptive!.lanes = [
    { pool: home.pool, founded: 0, width: 2, points: [home.building[0], home.building[1]] },
  ]
  for (let i = 0; i < 80; i++) {
    w.month++
    advanceDestructiveRaids(w)
  }
  assert.equal(
    homes.reduce((sum, s) => sum + s.capacity, 0),
    0,
  )
  assert.equal(
    firms.reduce((sum, f) => sum + f.capital, 0),
    0,
  )
  assert(own.every((u) => u.industry === 0 && u.infrastructure === 0))
  assert.equal(r.publicWorks!.road, undefined)
  assert.equal(home.building, undefined)
  assert.equal(home.fabric!.floorArea, 0)
  assert.equal(w.adaptive!.lanes!.length, 0)
  assert.equal(w.adaptive!.construction!.length, 0)
  assert.equal(project.status, 'cancelled')
  advanceUrbanConstruction(w)
  syncSites(w)
  ensureUrbanFabric(w)
  assert.equal(home.capacity, 0)
  assert.equal(home.fabric!.floorArea, 0)
  assert.equal(home.building, undefined)
  validateWorld(w)
})

test('army commands and save loading retain the explicit destructive conduct', () => {
  const { w, a } = fixture()
  a.operations!.conduct = 'restrained'
  applyCommand(w, { type: 'army-orders', army: a.id, stance: 'hold', conduct: 'raze' })
  assert.equal(a.operations!.conduct, 'raze')
  assert.equal(restoreWorld(packWorldSave(w)).armies.find((x) => x.id === a.id)!.operations!.conduct, 'raze')
})

test('idle armies never scan physical sites or financial assets for destructive raids', () => {
  const { w, a } = fixture()
  a.operations!.conduct = 'restrained'
  for (const key of ['adaptive', 'economy', 'corridors'] as const)
    Object.defineProperty(w, key, {
      get() {
        throw new Error(`Idle raid phase scanned ${key}`)
      },
    })
  advanceDestructiveRaids(w)
})
