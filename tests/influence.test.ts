import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import {
  advanceMilitaryInfluence,
  advanceTradeInfluence,
  localImpression,
  militaryImpression,
  recordMilitaryInfluence,
} from '../src/sim/influence'
import { validateInfluence } from '../src/sim/influence-persistence'
import { evolveIdentities } from '../src/sim/identities'
import { identityDistribution } from '../src/sim/population'
import { withSimulationPeriod } from '../src/sim/simulation-period'
import { inventory, population, relation, type World } from '../src/sim/types'
import { restoreWorld } from '../src/sim/persistence'
import { packWorldSave } from '../src/sim/save-codec'

const fixture = () => generateWorld('Commercial language contacts', 3, 6, undefined, 'regional')
function route(w: World, from: number, to: number, volume: number) {
  w.routes = [
    {
      id: 'test',
      from,
      to,
      path: [from, to],
      sea: false,
      goods: { ...inventory(), food: volume },
      volume,
      value: volume * 0.014,
      capacity: volume,
      international: true,
    },
  ]
}
test('trade builds durable bilateral contact in monthly units, fades without traffic and is idempotent', () => {
  const w = fixture(),
    a = w.nations[0].capital,
    b = w.nations[1].capital
  const coarse = structuredClone(w)
  const volume = Math.min(population(w.regions[a]), population(w.regions[b])) * 0.01
  for (let i = 0; i < 6; i++) {
    w.month++
    route(w, a, b, volume)
    advanceTradeInfluence(w)
  }
  coarse.month = 6
  route(coarse, a, b, volume * 6)
  withSimulationPeriod(6, () => advanceTradeInfluence(coarse))
  assert.equal(w.influence!.trade.length, 2)
  w.influence!.trade.forEach((entry, i) =>
    assert(Math.abs(entry.strength - coarse.influence!.trade[i].strength) < 1e-12),
  )
  const before = structuredClone(w.influence)
  advanceTradeInfluence(w)
  assert.deepEqual(w.influence, before)
  w.routes = []
  w.month += 6
  withSimulationPeriod(6, () => advanceTradeInfluence(w))
  assert(w.influence!.trade[0].strength > 0)
  assert(w.influence!.trade[0].strength < before!.trade[0].strength)
  validateInfluence(w)
})
test('sustained trade teaches an unrelated language and changes culture without changing population', () => {
  const w = fixture(),
    a = w.regions[w.nations[0].capital]
  const native = identityDistribution(a.communities!, 'language')[0].id
  const b = w.regions.find(
    (r) =>
      r.nation !== a.nation &&
      !a.neighbors.includes(r.id) &&
      identityDistribution(r.communities!, 'language')[0]?.id !== native,
  )!
  assert(b)
  const foreign = identityDistribution(b.communities!, 'language')[0].id
  const culture = identityDistribution(b.communities!, 'culture')[0].id
  const control = structuredClone(w)
  w.nations[a.nation].policies.languagePolicy = 'multilingual'
  control.nations[a.nation].policies.languagePolicy = 'multilingual'
  const count = population(a)
  for (let i = 0; i < 120; i++) {
    w.month++
    control.month++
    route(w, a.id, b.id, Math.max(population(a), population(b)) * 0.025)
    evolveIdentities(w)
    evolveIdentities(control)
  }
  const learners = a.communities!.filter((g) => g.knownLanguage === foreign && g.fluency > 0.5)
  assert(learners.length > 0)
  const foreignCulture = (world: World) =>
    identityDistribution(world.regions[a.id].communities!, 'culture').find((e) => e.id === culture)?.count ??
    0
  assert(foreignCulture(w) > foreignCulture(control))
  assert.equal(population(a), count)
  assert(identityDistribution(a.communities!, 'language')[0].id === native)
})
test('military force creates directional fear and opposition among witnesses, with slower resentment decay', () => {
  const w = fixture(),
    actor = 0,
    target = 1,
    region = w.nations[target].capital
  const distant = w.nations.find(
    (n) =>
      n.id !== actor &&
      n.id !== target &&
      !w.regions[region].neighbors.some((id) => w.regions[id].nation === n.id),
  )!
  const opinion = relation(w, actor, target)!.opinion
  recordMilitaryInfluence(w, actor, target, region, 'attack', 1, 0.5)
  recordMilitaryInfluence(w, actor, target, region, 'victory', 1)
  const before = structuredClone(militaryImpression(w, target, actor)!)
  assert(before.fear > 0 && before.opposition > 0)
  assert(relation(w, actor, target)!.opinion < opinion)
  assert(localImpression(w, region, actor)!.opposition > 0)
  assert.equal(militaryImpression(w, distant.id, actor), undefined)
  assert.equal(militaryImpression(w, actor, target), undefined)
  w.month = 24
  advanceMilitaryInfluence(w)
  const after = militaryImpression(w, target, actor)!
  assert(after.fear / before.fear < after.opposition / before.opposition)
  const snapshot = structuredClone(w.influence)
  advanceMilitaryInfluence(w)
  assert.deepEqual(w.influence, snapshot)
  validateInfluence(w)
})
test('influence survives saves, resumes deterministically and rejects corrupt or duplicate memories', () => {
  const w = fixture()
  recordMilitaryInfluence(w, 0, 1, w.nations[1].capital, 'requisition', 1, 0.8)
  const restored = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(w))))
  assert.deepEqual(restored.influence, w.influence)
  w.month = restored.month = 12
  advanceMilitaryInfluence(w)
  advanceMilitaryInfluence(restored)
  assert.deepEqual(restored.influence, w.influence)
  restored.influence!.military[0].fear = NaN
  assert.throws(() => validateInfluence(restored), /influence/)
  restored.influence = structuredClone(w.influence)
  restored.influence!.military.push({ ...restored.influence!.military[0] })
  assert.throws(() => validateInfluence(restored), /influence/)
})
