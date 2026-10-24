import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { ensureHistory, advanceHistory, receiveHistoricalEvent } from '../src/sim/history'
import { proceduralEvent } from '../src/sim/history-procedural'
import { HISTORY_CATEGORIES } from '../src/sim/history-types'
import { validateHistoricalProposal } from '../src/sim/history-schema'
import { validateWorld } from '../src/sim/persistence'
import { parseHistoryPatterns } from '../src/sim/history-repertoire'

test('local history composes distinct mechanisms, effects, responses and aftermath reproducibly', () => {
  const world = generateWorld('local-repertoire')
  ensureHistory(world)
  const region = world.regions[0],
    mechanisms = new Set(),
    consequences = new Set()
  for (const category of HISTORY_CATEGORIES)
    for (let seed = 1; seed <= 80; seed++) {
      const opportunity = {
        id: seed,
        month: world.month,
        nation: region.nation,
        region: region.id,
        category,
        seed,
      }
      const proposal = proceduralEvent(world, opportunity)
      assert.deepEqual(proposal, proceduralEvent(world, opportunity))
      validateHistoricalProposal(world, proposal)
      assert(proposal.description.length <= 500)
      assert(proposal.responses.length >= 2)
      assert(proposal.followUps.length === 2)
      mechanisms.add(proposal.title)
      consequences.add(JSON.stringify([proposal.effects, proposal.responses, proposal.followUps]))
    }
  assert(mechanisms.size >= 45, `${mechanisms.size} mechanisms`)
  assert(consequences.size > 600, `${consequences.size} causal combinations`)
})

test('one model response supplies a bespoke event and portable mechanisms that survive saves', () => {
  const world = generateWorld('learned-repertoire'),
    state = ensureHistory(world)
  const region = world.regions[0]
  const opportunity = {
    id: state.nextId++,
    month: 0,
    nation: region.nation,
    region: region.id,
    category: 'commerce' as const,
    seed: 5,
  }
  state.opportunity = opportunity
  const event = proceduralEvent(world, opportunity)
  const patterns = [
    {
      category: 'commerce',
      name: 'A shared repairs fund',
      development: 'carriers pool contributions to repair commonly used equipment',
      gain: 'tradeCapacity',
      friction: 'taxIncome',
    },
  ]
  assert(receiveHistoricalEvent(world, opportunity.id, { event, patterns }, 'fixture-model'))
  assert.equal(state.repertoire?.length, 1)
  assert.equal(state.prepared?.length, 1)
  let reused = false
  for (let seed = 0; seed < 100; seed++) {
    const proposal = proceduralEvent(world, { ...opportunity, seed })
    if (proposal.patternModel === 'fixture-model') {
      reused = true
      validateHistoricalProposal(world, proposal)
    }
  }
  assert(reused)
  assert.equal(validateWorld(structuredClone(world)).historical?.repertoire?.[0].model, 'fixture-model')
  world.month = state.nextRoll
  advanceHistory(world)
  assert(world.events.some((entry) => entry.historical?.source === 'openrouter'))
})

test('portable patterns cannot inject executable actions or unsupported effect paths', () => {
  assert.throws(() =>
    parseHistoryPatterns(
      [
        {
          category: 'commerce',
          name: 'Forged',
          development: 'invent stocks',
          gain: 'stocks.food',
          friction: 'taxIncome',
        },
      ],
      'fixture',
    ),
  )
  assert.throws(() => parseHistoryPatterns(Array(4).fill({}), 'fixture'))
})
