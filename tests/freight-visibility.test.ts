/** Completed monthly shipments remain accounts history, not a permanent right to sail. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { freightOverlay } from '../src/map/trade'
import { detailRoads } from '../src/map/activity-layout'
import { makeNation } from '../src/sim/generate'
import { setBorderPolicy } from '../src/sim/border-policy'
import { completedFreight, corridorWorld } from './fixtures/corridors'

function fixture() {
  const w = corridorWorld(['AAABBB'])
  w.seed = 'Recent wartime cargo'
  w.nations = [makeNation(0, 0), makeNation(1, 1)]
  w.regions[1].nation = 1
  w.relations = [{ a: 0, b: 1, treaty: 'neutral', opinion: 0, since: 0, grievance: 0, warExhaustion: 0 }]
  w.routes = [completedFreight({ from: 0, to: 1, legs: [{ mode: 'land', cells: [0, 1, 2, 3] }] }, 100)]
  return w
}

test('a declaration after trade clearing immediately stops map traffic without deleting past shipments', () => {
  const w = fixture(),
    recorded = w.routes,
    history = structuredClone(recorded)
  assert(freightOverlay(w, 0, null).corridors.length > 0)
  w.relations[0].treaty = 'war'
  assert.equal(freightOverlay(w, 0, null).corridors.length, 0)
  assert.equal(w.routes, recorded)
  assert.deepEqual(w.routes, history)
  w.relations[0].treaty = 'truce'
  assert(freightOverlay(w, 0, null).corridors.length > 0)
})

test('map cargo responds to same-month embargo and arms restrictions', () => {
  const w = fixture()
  w.routes[0].goods.coal = 60
  w.routes[0].goods.arms = 40
  setBorderPolicy(w, 0, 1, { trade: 'restricted', military: 'treaties' })
  assert.equal(freightOverlay(w, 0, null).corridors[0].forward, 60)
  setBorderPolicy(w, 0, 1, { trade: 'embargo', military: 'treaties' })
  assert.equal(freightOverlay(w, 0, null).corridors.length, 0)
  assert.equal(w.routes[0].volume, 100)
})

test('road memory preserves the road but cannot invent moving carts after trade stops', () => {
  const w = fixture()
  w.corridors = [{ a: 1, b: 2, familiarity: 1, traffic: 100 }]
  assert(detailRoads(w).some((r) => r.traffic))
  w.relations[0].treaty = 'war'
  assert(detailRoads(w).length > 0)
  assert(detailRoads(w).every((r) => !r.traffic))
  w.routes = []
  assert.equal(detailRoads(w).length, 1)
  assert(!detailRoads(w)[0].traffic)
})
