import { expeditionPeople } from '../src/sim/overseas-types'
import { endowTreasury } from './fixtures/endowment'
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { applyCommand } from '../src/sim/engine'
import { ensureWarfare, commissionFleet, advanceNavy, embarkArmy, canEmbarkArmy } from '../src/sim/navy'
import { restoreWorld, validateWorld } from '../src/sim/persistence'
import { releaseSoldiers, takeCivilianAdults } from '../src/sim/population'
import { transportNetwork } from '../src/sim/transport'
import { relation, population, type World } from '../src/sim/types'
import { initialArmyOperations } from '../src/sim/navy'
import { MAX_ARMIES } from '../src/sim/military-limits'
import { reinforceArmies } from '../src/sim/military-personnel'
import { allForces } from '../src/sim/forces'
import { restoreSave } from '../src/storage/autosave'
import { WorldStorage } from '../src/storage/world-storage'
import type { WorldSave } from '../src/storage/save-types'
import { movementNeighbors, stepDistance } from '../src/sim/grid'

test('manual recruitment is immediately saveable, before the next simulation month', () => {
  const w = generateWorld('manual-recruit-save')
  ensureWarfare(w)
  const r = w.regions[w.nations[0].capital],
    count = w.armies.length
  endowTreasury(w, 0, 10000)
  r.stocks.arms = 1000
  applyCommand(w, { type: 'recruit', nation: 0, region: r.id })
  assert.equal(w.armies.length, count + 1)
  assert(w.armies.at(-1)!.operations)
  validateWorld(w)
})

test('missing army operations are rejected without inventing supplies or changing people', () => {
  const w = generateWorld('missing-operations-save')
  delete w.armies[0].operations
  const original = JSON.stringify(w)
  assert.throws(() => validateWorld(w), /army \d+ is missing its operations record/)
  assert.throws(() => restoreWorld(w), /army \d+ is missing its operations record/)
  assert.equal(JSON.stringify(w), original)
  const malformed = structuredClone(w)
  malformed.armies[0].operations = { food: 1 } as never
  assert.throws(() => restoreWorld(malformed), /operations/)
})

test('only machine roundoff at military bounds is recoverable; real negatives and dangling transports fail', () => {
  const w = generateWorld('military-roundoff-save')
  ensureWarfare(w)
  const o = w.armies[0].operations!
  o.cohesion = 1 + Number.EPSILON
  o.food = -Number.EPSILON
  const recovered = restoreWorld(w)
  assert.equal(recovered.armies[0].operations!.cohesion, 1)
  assert.equal(recovered.armies[0].operations!.food, 0)
  assert.equal(o.food, -Number.EPSILON)
  o.food = -0.01
  assert.throws(() => restoreWorld(w), /operations/)
  o.food = 0
  o.embarkedOn = 999999
  assert.throws(() => restoreWorld(w), /operations/)
})

function fleetWorld() {
  const w = generateWorld('fleet-save-regression')
  ensureWarfare(w)
  const harbor = transportNetwork(w).harbors[0],
    r = w.regions[harbor.region]
  endowTreasury(w, r.nation, 10000)
  for (const good of ['timber', 'iron', 'arms', 'tools', 'food'] as const) r.stocks[good] = 100000
  commissionFleet(w, r.nation, r.id, 1, 4)
  return { w, r, f: w.warfare!.fleets.at(-1)! }
}

test('diagonal sailing charges physical distance and preserves fractional progress through a save', () => {
  const { w, f } = fleetWorld()
  const harbors = new Set(transportNetwork(w).harbors.map((h) => h.water))
  const start = w.cells.find(
    (c) =>
      c.terrain === 'water' &&
      !harbors.has(c.id) &&
      movementNeighbors(w.cells, c.id, w.width, w.height).some(
        (id) => w.cells[id].terrain === 'water' && !harbors.has(id) && stepDistance(c, w.cells[id]) > 1,
      ),
  )!
  const next = movementNeighbors(w.cells, start.id, w.width, w.height).find(
    (id) => w.cells[id].terrain === 'water' && !harbors.has(id) && stepDistance(start, w.cells[id]) > 1,
  )!
  f.cell = start.id
  f.target = null
  f.food = f.soldiers * 0.034 * 10
  w.nations[f.nation].technologies.logistics = 0
  assert(!transportNetwork(w).harbors.some((h) => h.water === f.cell))
  const path = Array.from({ length: 61 }, (_, i) => (i % 2 ? next : start.id))
  f.course = path.slice(1)
  advanceNavy(w)
  const completed = path.length - 1 - f.course.length
  const traveled = path
    .slice(1, completed + 1)
    .reduce((sum, id, i) => sum + stepDistance(w.cells[path[i]], w.cells[id]), 0)
  assert(Math.abs(traveled + f.sailingProgress! - 11) < 1e-9)
  assert(f.sailingProgress! > 0 && f.sailingProgress! < Math.SQRT2)
  validateWorld(w)
  const restored = restoreWorld(JSON.parse(JSON.stringify(w)))
  assert.equal(restored.warfare!.fleets.at(-1)!.sailingProgress, f.sailingProgress)
  advanceNavy(w)
  advanceNavy(restored)
  assert.deepEqual(restored.warfare, w.warfare)
  validateWorld(restored)
  restored.warfare!.fleets.at(-1)!.sailingProgress = Math.SQRT2
  assert.throws(() => validateWorld(restored), /sailing progress/)
})

test('naval repairs consume exactly the available limiting input despite floating-point roundoff', () => {
  const { w, r, f } = fleetWorld()
  const iron = 8.299999999999999e-19
  assert((iron / 15) * 15 > iron, 'fixture must reproduce the one-ULP overshoot')
  r.stocks.iron = iron
  r.consumption.iron = 0
  f.hull = 0.5
  advanceNavy(w)
  assert.equal(r.stocks.iron, 0)
  assert.equal(r.consumption.iron, iron)
  validateWorld(w)
})

test('fleet manifests drop armies that have dispersed before the naval phase', () => {
  const { w, r, f } = fleetWorld(),
    a = w.armies.find((a) => a.nation === r.nation)!
  a.region = r.id
  embarkArmy(w, a.id, f.id)
  releaseSoldiers(w, a, r, a.soldiers)
  w.armies = w.armies.filter((a) => a.soldiers > 0)
  advanceNavy(w)
  assert.deepEqual(f.embarked, [])
  validateWorld(w)
})

test('automatic embarkation eligibility rejects inaccessible ports and insufficient berths', () => {
  const { w, r, f } = fleetWorld(),
    a = w.armies.find((a) => a.nation === r.nation)!
  a.region = r.id
  assert(canEmbarkArmy(w, a, f))
  const foreign = transportNetwork(w).harbors.find((h) => w.regions[h.region].nation !== r.nation)!
  a.region = foreign.region
  f.cell = foreign.water
  relation(w, a.nation, w.regions[foreign.region].nation)!.treaty = 'neutral'
  assert.equal(canEmbarkArmy(w, a, f), false)
  assert.throws(() => embarkArmy(w, a.id, f.id), /accessible embarkation port/)
  a.region = r.id
  f.cell = transportNetwork(w).harbors.find((h) => h.region === r.id)!.water
  f.hull = 0.001
  assert.equal(canEmbarkArmy(w, a, f), false)
  assert.throws(() => embarkArmy(w, a.id, f.id), /transport berths/)
})

test('an unaffordable allied-port purchase cannot give a fleet negative ammunition', () => {
  const { w, r, f } = fleetWorld()
  const foreign = transportNetwork(w).harbors.find((h) => w.regions[h.region].nation !== r.nation)!
  const host = w.regions[foreign.region]
  relation(w, r.nation, host.nation)!.treaty = 'alliance'
  f.cell = foreign.water
  f.region = host.id
  // Reproduce a rounding debt after a fully funded food purchase.
  endowTreasury(w, r.nation, -Number.EPSILON)
  f.food = f.soldiers * 0.034 * 4
  f.arms = 0
  advanceNavy(w)
  assert.equal(f.arms, 0)
  assert(f.food >= 0 && f.supply >= 0 && f.supply <= 1)
})

function fillCadres(w: World, count: number) {
  const template = w.armies[0],
    province = w.regions[template.region]
  while (w.armies.length < count) {
    w.armies.push({
      ...template,
      id: w.nextArmy++,
      name: `Territorial cadre ${w.armies.length}`,
      soldiers: 1,
      establishment: 1,
      communities: takeCivilianAdults(w, province, 1),
      operations: initialArmyOperations(),
    })
  }
}
const people = (w: World) =>
  w.regions.reduce((sum, r) => sum + population(r), 0) +
  allForces(w).reduce((sum, a) => sum + a.soldiers, 0) +
  expeditionPeople(w)

test('recruiting the 501st formation remains saveable and preserves people and military identities', async () => {
  const w = generateWorld('army-capacity-regression'),
    r = w.regions[w.nations[0].capital]
  fillCadres(w, 500)
  validateWorld(w)
  const before = people(w),
    ids = w.armies.map((a) => a.id)
  endowTreasury(w, 0, 100000)
  r.stocks.arms = 10000
  assert.match(applyCommand(w, { type: 'recruit', nation: 0, region: r.id }), /Recruited/)
  assert.equal(w.armies.length, 501)
  assert.equal(people(w), before)
  assert.deepEqual(
    w.armies.slice(0, 500).map((a) => a.id),
    ids,
  )
  validateWorld(w)
  let stored: WorldSave | null = null
  const backend = {
    name: 'disk' as const,
    read: async () => stored,
    write: async (value: WorldSave) => {
      stored = value
    },
    writeBlob: async (blob: Blob) => {
      stored = JSON.parse(await blob.text())
    },
  }
  await new WorldStorage([backend], () => {}).save(w, 1)
  const restored = (await restoreSave([backend])).world!
  assert.deepEqual(restored.armies, w.armies)
  assert.equal(people(restored), before)
  const original = JSON.stringify(w)
  assert.equal(restoreWorld(w).armies.length, 501)
  assert.equal(JSON.stringify(w), original, 'loading does not delete, merge or rewrite the source formations')
})

test('a state can rebuild its funded standing cadre after the world passes 500 formations', () => {
  const w = generateWorld('army-capacity-cadre')
  for (const a of w.armies.filter((a) => a.nation === 1))
    releaseSoldiers(w, a, w.regions[a.region], a.soldiers)
  w.armies = w.armies.filter((a) => a.soldiers > 0)
  fillCadres(w, 500)
  const n = w.nations[1],
    source = w.regions[n.capital],
    before = people(w)
  endowTreasury(w, n.id, 100000)
  n.budget.military = 1000
  n.policies.military = 20
  n.policies.conscription = 1
  source.foodCoverage = 1
  source.unrest = 0
  source.stocks.arms = 10000
  source.stocks.food = 100000
  reinforceArmies(w)
  assert(w.armies.some((a) => a.nation === 1 && a.soldiers >= 20))
  assert.equal(w.armies.length, 501)
  assert.equal(people(w), before)
  validateWorld(w)
})

test('the shared safety boundary rejects oversized saves and blocks recruitment before spending or taking civilians', () => {
  const w = generateWorld('army-capacity-boundary'),
    r = w.regions[w.nations[0].capital]
  w.armies = Array(MAX_ARMIES).fill(w.armies[0])
  const before = {
    treasury: w.nations[0].treasury,
    stocks: structuredClone(r.stocks),
    adults: r.population.adults,
    nextArmy: w.nextArmy,
  }
  assert.match(
    applyCommand(w, { type: 'recruit', nation: 0, region: r.id }),
    /supported number of army formations/,
  )
  assert.deepEqual(
    { treasury: w.nations[0].treasury, stocks: r.stocks, adults: r.population.adults, nextArmy: w.nextArmy },
    before,
  )
  w.armies.push(w.armies[0])
  assert.throws(() => validateWorld(w), /army formation capacity exceeded \(16385; supported 16384\)/)
  w.armies = {} as never
  assert.throws(() => validateWorld(w), /armies must be a list/)
})
