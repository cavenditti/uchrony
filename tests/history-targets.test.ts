import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { validateHistoricalEffect, validateHistoricalProposal } from '../src/sim/history-schema'
import { ensureHistory, receiveHistoricalEvent } from '../src/sim/history'
import { proceduralEvent } from '../src/sim/history-procedural'
import type { HistoricalEffect } from '../src/sim/history-types'
import { validateWorld } from '../src/sim/persistence'

function fixture() {
  const w = generateWorld('historical-targets'),
    state = ensureHistory(w),
    r = w.regions[0]
  const opportunity = {
    id: state.nextId++,
    month: w.month,
    nation: r.nation,
    region: r.id,
    category: 'diplomacy' as const,
    seed: 1,
  }
  const event = proceduralEvent(w, opportunity)
  event.responses = []
  event.followUps = []
  const opinion: HistoricalEffect = {
    kind: 'change',
    scope: 'relation',
    stat: 'opinion',
    target: -1,
    other: (r.nation + 1) % w.nations.length,
    amount: 5,
    duration: 0,
    delay: 0,
    curve: 'steady',
    field: '',
    text: '',
  }
  return { w, state, opportunity, event, opinion }
}

test('actor-relative bilateral effects resolve in immediate, response and delayed effects without changing the input', () => {
  const { w, event, opinion } = fixture(),
    actor = event.nation,
    partner = opinion.other
  event.effects = [opinion]
  event.responses = [
    {
      name: 'Respond',
      rationale: 'A diplomatic response.',
      affinity: 'neutral',
      weight: 1,
      conditions: [],
      effects: [{ ...opinion, target: partner, other: -1 }],
    },
  ]
  event.followUps = [
    {
      title: 'Talks continue',
      description: 'The two governments continue talks.',
      afterMonths: 3,
      withinMonths: 0,
      probability: 0.5,
      conditions: [],
      effects: [{ ...opinion }],
    },
  ]
  const raw = JSON.stringify(event),
    p = validateHistoricalProposal(w, event)
  assert.equal(p.effects[0].target, actor)
  assert.equal(p.responses[0].effects[0].other, actor)
  assert.equal(p.followUps[0].effects[0].target, actor)
  assert.equal(JSON.stringify(event), raw)
})

test('unused counterpart slots are canonicalized only at the model boundary; persisted effects remain strict', () => {
  const { w, event } = fixture()
  const effect: HistoricalEffect = {
    kind: 'change',
    scope: 'nation',
    stat: 'stability',
    target: -1,
    other: event.nation,
    amount: 3,
    duration: 0,
    delay: 0,
    curve: 'steady',
    field: '',
    text: '',
  }
  event.effects = [effect]
  const p = validateHistoricalProposal(w, event)
  assert.equal(p.effects[0].other, -1)
  assert.throws(
    () => validateHistoricalEffect(w, { ...effect, target: event.nation }),
    /invalid relation target/,
  )
})

test('ambiguous, unknown and unrelated foreign counterparts remain rejected', () => {
  const { w, event, opinion } = fixture()
  for (const endpoints of [
    { target: -1, other: -1 },
    { target: -1, other: 99999 },
    { target: (event.nation + 1) % w.nations.length, other: (event.nation + 2) % w.nations.length },
  ]) {
    event.effects = [{ ...opinion, ...endpoints }]
    assert.throws(() => validateHistoricalProposal(w, event), /relation target|diplomatic target/)
  }
})

test('a normalized generated diplomatic event is queued and survives save validation', () => {
  const { w, state, opportunity, event, opinion } = fixture()
  state.opportunity = opportunity
  event.effects = [opinion]
  assert(receiveHistoricalEvent(w, opportunity.id, event, 'fixture-model'))
  assert.equal(state.prepared![0].proposal.effects[0].target, event.nation)
  validateWorld(w)
})
