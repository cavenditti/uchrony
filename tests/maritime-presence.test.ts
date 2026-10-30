import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { maritimeContacts } from '../src/sim/maritime-presence'
import { advanceFrontierPolitics } from '../src/sim/frontier-politics'
import { portAt, waterPath } from '../src/sim/navy'
import { transportNetwork } from '../src/sim/transport'
import { landComponents } from '../src/sim/land-connectivity'
import { rollupPopulation } from '../src/sim/population'
import { population } from '../src/sim/types'
import { balances } from '../src/sim/ledger'
import { rebaseEndowments } from './fixtures/endowment'

function fixture() {
  const w = generateWorld('Maritime politics', 5, 8, undefined, 'regional', 'frontier')
  const land = landComponents(w),
    ports = transportNetwork(w).harbors
  const home = ports.find(
    (h) =>
      w.regions[h.region].nation >= 0 &&
      ports.some(
        (b) =>
          w.regions[b.region].nation === -1 &&
          land[w.regions[h.region].center] !== land[w.regions[b.region].center] &&
          waterPath(w, h.water, b.water).length,
      ),
  )!
  const source = w.regions[home.region],
    n = w.nations[source.nation]
  const target = ports
    .map((h) => w.regions[h.region])
    .find(
      (r) =>
        r.nation === -1 &&
        land[r.center] !== land[source.center] &&
        waterPath(w, home.water, portAt(w, r.id)!.water).length,
    )!
  assert(source && target)
  // Remove all terrestrial candidates to isolate delivered maritime influence.
  target.neighbors = []
  target.communities = structuredClone(source.communities)
  for (const g of target.communities!) g.host = g.allegiance = -1
  rollupPopulation(target)
  n.ai = false
  n.stability = n.legitimacy = 90
  n.foodCoverage = 1
  n.treasury = 100000
  n.policies.citizenship = 'civic'
  for (const r of w.relations) r.treaty = 'neutral'
  w.routes = []
  rebaseEndowments(w)
  return { w, source, target, n }
}

test('a proposed route or passing ship creates no political claim; delivered sea trade does', () => {
  const { w, source, target, n } = fixture()
  assert(!maritimeContacts(w).has(target.id))
  w.routes = [{ from: source.id, to: target.id, volume: 0, sea: true } as never]
  assert(!maritimeContacts(w).has(target.id))
  w.routes[0].volume = 10
  assert.equal(maritimeContacts(w).get(target.id)?.get(n.id)?.trade, 10)
  target.nation = (n.id + 1) % w.nations.length
  assert(!maritimeContacts(w).has(target.id), 'foreign sovereignty cannot be acquired through this process')
})

test('sustained maritime commerce funds gradual accession; isolated contact cannot annex', () => {
  const { w, source, target, n } = fixture()
  const cash = Object.values(balances(w)).reduce((a, b) => a + b, 0)
  w.routes = [{ from: source.id, to: target.id, volume: population(target) * 0.026, sea: true } as never]
  w.month++
  advanceFrontierPolitics(w)
  assert.equal(target.nation, -1)
  w.routes = []
  for (let i = 0; i < 24; i++) {
    w.month++
    advanceFrontierPolitics(w)
  }
  assert.equal(target.nation, -1)
  assert.equal(w.sovereignty!.frontiers!.find((f) => f.region === target.id)!.nation, -1)
  w.routes = [{ from: source.id, to: target.id, volume: population(target) * 0.026, sea: true } as never]
  const treasury = n.treasury
  for (let i = 0; i < 240 && target.nation === -1; i++) {
    w.month++
    advanceFrontierPolitics(w)
  }
  assert.equal(target.nation, n.id)
  assert(n.treasury < treasury)
  assert(Math.abs(Object.values(balances(w)).reduce((a, b) => a + b, 0) - cash) < 1e-6)
})
