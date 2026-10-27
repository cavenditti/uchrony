import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { fastForwardStep } from '../src/sim/fast-forward'
import { validateWorld } from '../src/sim/persistence'
import { auditLedger } from '../src/sim/ledger'
import { auditGoods } from '../src/sim/goods-accounting'
import { auditBanks } from '../src/sim/banking'

test('an ordinary frontier expands and produces a funded new state without injected resources', () => {
  const w = generateWorld('Gino', 3, 8, undefined, 'regional', 'frontier')
  const openingPeople = w.totals.population
  // This is the real engine, with ordinary starting people, policies and assets.
  // Allow a long horizon without requiring a charter on an exact calendar date.
  while (w.month < 480 && w.nations.length === 8) fastForwardStep(w)
  assert(w.nations.length > 8, 'a prosperous independent settlement should become a state')
  assert(w.regions.filter((r) => r.nation >= 0).length >= 18, 'growth must continue beyond the first camps')
  assert(w.totals.population > openingPeople * 0.8, 'expansion must not be driven by a dying world')
  assert(w.events.some((e) => e.title.includes('joins')))
  const city = w.nations[8]
  assert(city.treasury > 0 && city.ai)
  assert(w.regions.some((r) => r.nation === city.id))
  assert(w.economy!.ledger.net[`government:${city.id}`] > 0, 'the treasury must be funded by real transfers')
  validateWorld(w)
  auditLedger(w)
  auditGoods(w)
  auditBanks(w)
})
