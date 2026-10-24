import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import {
  ensureCharacters,
  replaceStateLeader,
  characterContext,
  characterPolicyTargets,
} from '../src/sim/character'
import { DRIVE_AXES, strategicPressures } from '../src/sim/ambitions'
import { advancePressures, ensurePressures } from '../src/sim/pressures'
import { applyCommand, tick } from '../src/sim/engine'
import { DEFAULT_SETTINGS } from '../src/sim/settings'
import { validateWorld } from '../src/sim/persistence'
import { ensureStatecraft, stateAgentContext } from '../src/sim/statecraft'
import { population } from '../src/sim/types'

const people = (w: ReturnType<typeof generateWorld>) =>
  w.regions.reduce((s, r) => s + population(r), 0) +
  [...w.armies, ...(w.warfare?.fleets ?? [])].reduce((s, a) => s + a.soldiers, 0)
test('leaders have reproducible private extremes and distinct ambitions; legacy upgrade preserves the person', () => {
  const w = generateWorld('political-extremes'),
    copy = generateWorld('political-extremes')
  assert.deepEqual(
    w.nations.map((n) => n.character),
    copy.nations.map((n) => n.character),
  )
  const archetypes = new Set<string>()
  let reckless = 0,
    cautious = 0
  for (let i = 0; i < 48; i++) {
    replaceStateLeader(w, 0, `Head ${i}`)
    const p = w.nations[0].character!.leader.politics!
    archetypes.add(p.archetype)
    reckless += +(p.drives.riskTolerance > 0.85)
    cautious += +(p.drives.riskTolerance < 0.25)
    assert(DRIVE_AXES.every((axis) => p.drives[axis] >= 0 && p.drives[axis] <= 1))
  }
  assert(archetypes.size >= 8)
  assert(reckless > 0)
  assert(cautious > 0)
  const n = w.nations[0],
    before = structuredClone(n.character!.leader)
  delete n.character!.leader.politics
  ensureCharacters(w)
  assert.deepEqual({ ...n.character!.leader, politics: undefined }, { ...before, politics: undefined })
  assert(!('politics' in characterContext(n, true)!.leader))
  validateWorld(w)
})

test('private motives enter strategy without exposing foreign private profiles and affect native mobilization targets', () => {
  const w = generateWorld('ambition-context')
  ensureStatecraft(w)
  const n = w.nations[0],
    politics = n.character!.leader.politics!
  const low = characterPolicyTargets(n)
  politics.drives.dominance = 1
  politics.drives.riskTolerance = 1
  const high = characterPolicyTargets(n)
  assert(high.military >= low.military)
  assert(high.conscription >= low.conscription)
  const context = stateAgentContext(w, n.id, true)
  assert(context.strategicLandscape.doctrine?.ambition)
  assert(context.strategicLandscape.rivals.length > 0)
  assert(context.foreignStates.every((other) => !('politics' in other.character!.leader)))
  assert(strategicPressures(w, n).constraints.suppliedLandPower >= 0)
})

test('instability changes irregular local/state/regional/international event frequency without transfers or fabricated resources', () => {
  const original = generateWorld('pressure-frequency'),
    quiet = structuredClone(original),
    normal = structuredClone(original),
    volatile = structuredClone(original)
  quiet.simulation!.instability = 0
  volatile.simulation!.instability = 3
  const owners = original.regions.map((r) => r.nation),
    initialPeople = people(original)
  for (let month = 1; month <= 240; month++)
    for (const w of [quiet, normal, volatile]) {
      w.month = month
      advancePressures(w)
    }
  assert.equal(ensurePressures(quiet).nextId, 1)
  assert(ensurePressures(volatile).nextId > ensurePressures(normal).nextId * 1.5)
  assert.equal(new Set(volatile.pressures!.incidents.map((i) => i.scope)).size, 4)
  assert(volatile.pressures!.incidents.some((i) => i.scope === 'international' && i.nations.length === 2))
  assert.deepEqual(
    volatile.regions.map((r) => r.nation),
    owners,
  )
  assert.equal(people(volatile), initialPeople)
  validateWorld(volatile)
})

test('conditions, pressure RNG and extreme leaders survive exact save continuation and reject malformed input', () => {
  const w = generateWorld('pressure-continuation')
  ensureStatecraft(w)
  const before = people(w),
    stocks = w.regions.map((r) => ({ ...r.stocks }))
  applyCommand(w, {
    type: 'conditions',
    settings: { ...DEFAULT_SETTINGS, instability: 3, abundance: 0.6, extremity: 2 },
  })
  assert.equal(people(w), before)
  assert.deepEqual(
    w.regions.map((r) => r.stocks),
    stocks,
  )
  for (let i = 0; i < 6; i++) {
    const count = people(w)
    tick(w)
    assert.equal(people(w), count + w.totals.births - w.totals.deaths)
  }
  const restored = structuredClone(validateWorld(w))
  tick(w)
  tick(restored)
  assert.deepEqual(w, restored)
  const invalid = structuredClone(w)
  invalid.simulation!.instability = Infinity
  assert.throws(() => validateWorld(invalid))
  const forged = structuredClone(w)
  forged.nations[0].character!.leader.politics!.drives.riskTolerance = 10
  assert.throws(() => validateWorld(forged))
  const bad = structuredClone(w)
  bad.pressures!.incidents[0].regions = [9999]
  assert.throws(() => validateWorld(bad))
})
