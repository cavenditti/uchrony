import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { applyCommand } from '../src/sim/engine'
import { ensureWarfare, commissionFleet, advanceNavy, embarkArmy } from '../src/sim/navy'
import { restoreWorld, validateWorld } from '../src/sim/persistence'
import { releaseSoldiers } from '../src/sim/population'
import { transportNetwork } from '../src/sim/transport'
import { relation } from '../src/sim/types'

test('manual recruitment is immediately saveable, before the next simulation month', () => {
  const w = generateWorld('manual-recruit-save')
  ensureWarfare(w)
  const r = w.regions[w.nations[0].capital],
    count = w.armies.length
  w.nations[0].treasury = 10000
  r.stocks.arms = 1000
  applyCommand(w, { type: 'recruit', nation: 0, region: r.id })
  assert.equal(w.armies.length, count + 1)
  assert(w.armies.at(-1)!.operations)
  validateWorld(w)
})

test('saves from the recruitment bug recover missing operations without inventing supplies or changing people', () => {
  const w = generateWorld('missing-operations-save')
  ensureWarfare(w)
  delete w.armies[0].operations
  assert.throws(() => validateWorld(w), /army \d+ is missing its operations record/)
  const original = JSON.stringify(w),
    recovered = restoreWorld(w)
  validateWorld(recovered)
  assert.equal(recovered.armies[0].operations!.food, 0)
  assert.equal(recovered.armies[0].operations!.arms, 0)
  assert.equal(recovered.armies[0].operations!.embarkedOn, null)
  assert.deepEqual(
    recovered.armies.map((a) => a.communities),
    w.armies.map((a) => a.communities),
  )
  assert.deepEqual(recovered.regions, w.regions)
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
  w.nations[r.nation].treasury = 10000
  for (const good of ['timber', 'iron', 'arms', 'tools', 'food'] as const) r.stocks[good] = 100000
  commissionFleet(w, r.nation, r.id, 1, 4)
  return { w, r, f: w.warfare!.fleets.at(-1)! }
}

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

test('an unaffordable allied-port purchase cannot give a fleet negative ammunition', () => {
  const { w, r, f } = fleetWorld()
  const foreign = transportNetwork(w).harbors.find((h) => w.regions[h.region].nation !== r.nation)!
  const host = w.regions[foreign.region]
  relation(w, r.nation, host.nation)!.treaty = 'alliance'
  f.cell = foreign.water
  f.region = host.id
  // Reproduce a rounding debt after a fully funded food purchase.
  w.nations[r.nation].treasury = -Number.EPSILON
  f.food = f.soldiers * 0.034 * 4
  f.arms = 0
  advanceNavy(w)
  assert.equal(f.arms, 0)
  assert(f.food >= 0 && f.supply >= 0 && f.supply <= 1)
})
