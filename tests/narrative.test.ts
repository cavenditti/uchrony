import { ensureHistory } from '../src/sim/history'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { generateWorld } from '../src/sim/generate'
import {
  ensureStatecraft,
  stateAgentContext,
  acceptStatePlan,
  acceptRefereeDecision,
} from '../src/sim/statecraft'
import { presentWorld, inWorldText } from '../src/sim/narrative'
import { STATE_PROMPT, REFEREE_PROMPT } from '../server/agent-prompts'
import { DiplomaticChancery } from '../src/components/DiplomaticChancery'
import { AgreementText } from '../src/components/AgreementReference'
import { hashSeed } from '../src/sim/random'
import type { DiplomaticOffer, StateAgentPlan } from '../src/sim/statecraft-types'
import { validateWorld } from '../src/sim/persistence'

function fixture() {
  const world = generateWorld('in-world-narrative')
  ensureHistory(world)
  const state = ensureStatecraft(world),
    id = state.nextId++,
    offer: DiplomaticOffer = {
      id,
      title: 'The Northern Passage Accord',
      author: 0,
      month: world.month,
      visibility: 'public',
      parties: [0, 1],
      terms: [
        {
          kind: 'payment',
          from: 0,
          to: 1,
          amount: 1,
          good: '',
          field: '',
          regions: [],
          duration: 0,
          text: 'Payment awaits referee approval.',
        },
      ],
      digest: '',
      signatures: [],
      status: 'proposed',
      supersedes: 0,
      expires: 12,
      activated: 0,
      ends: 0,
      ruling: 'The referee approved the signed terms.',
      resolved: [],
      breaches: 0,
      delivered: 0,
    }
  offer.digest = `${id}:${hashSeed(JSON.stringify([offer.title, offer.visibility, offer.parties, offer.terms])).toString(16)}`
  offer.signatures = offer.parties.map((nation) => ({ nation, digest: offer.digest, month: world.month }))
  state.offers.push(offer)
  state.agents[0].assessment = `We await referee approval of [[agreement:${id}]].`
  state.agents[0].memory = 'The referee has applied institutional consequences.'
  state.agents[0].escalation = `Referee approve: ${offer.title}`
  world.events.unshift({
    id: world.nextEvent++,
    month: world.month,
    type: 'diplomacy',
    title: 'Referee defer: passage agreement',
    detail: 'Live-state verification: the referee requested renewed consent.',
  })
  return { world, state, offer }
}
test('legacy outcomes become historical developments without altering citations or ordinary institutions', () => {
  assert.equal(inWorldText('Referee approve: Northern accord'), 'Agreement took effect: Northern accord')
  assert.equal(
    inWorldText('We await referee approval of [[agreement:8]].'),
    'We await implementation of [[agreement:8]].',
  )
  for (const text of [
    'The referee’s ruling is pending.',
    'REFEREES must approve.',
    'A referee-agent reviewed this.',
    'refereeModel failed',
    'The independent referee rejected this proposal.',
  ])
    assert.doesNotMatch(inWorldText(text), /referee/i)
  assert.equal(
    inWorldText('Local arbitration chambers settle land disputes.'),
    'Local arbitration chambers settle land disputes.',
  )
})
test('rendered diplomacy and linked text contain no hidden adjudicator while immutable source/export data stays intact', () => {
  const { world, offer } = fixture(),
    original = JSON.stringify(world),
    view = presentWorld(world)
  const html = renderToStaticMarkup(
    createElement(DiplomaticChancery, {
      world: view,
      nation: 0,
      onReview: () => {},
      status: {
        pending: 0,
        active: [],
        decisionModel: 'fast',
        strategyModel: 'strategic',
        error: 'refereeModel unavailable',
      },
    }),
  )
  assert.doesNotMatch(html, /referee|adjudicat/i)
  assert.match(html, /Terms and developments|Development:/)
  const linked = renderToStaticMarkup(
    createElement(AgreementText, {
      world,
      nation: 0,
      confidential: false,
      onOpen: () => {},
      text: `Awaiting referee approval of [[agreement:${offer.id}]].`,
    }),
  )
  assert.match(linked, new RegExp(`href="#agreement-${offer.id}"`))
  assert.doesNotMatch(linked, /referee/i)
  assert(JSON.stringify(world) === original, 'presentation must not mutate authoritative data')
  assert.equal(view.statecraft!.offers[0].digest, offer.digest)
  assert.notEqual(view.statecraft!.offers[0].terms[0].text, offer.terms[0].text)
  assert.equal(view.cells, world.cells)
  assert.equal(view.regions[0].communities, world.regions[0].communities)
  validateWorld(world)
})
test('state agents receive in-world explanations without an external authority, including legacy memory and outcomes', () => {
  const { world, state, offer } = fixture()
  state.rulings.push({
    id: state.nextId++,
    month: 0,
    offer: offer.id,
    visibility: 'public',
    parties: [0, 1],
    verdict: 'defer',
    reasoning: 'The referee deferred this agreement.',
    model: 'internal-referee-model',
    effects: [],
  })
  const before = JSON.stringify(world),
    context = stateAgentContext(world, 0, true)
  assert.doesNotMatch(STATE_PROMPT, /referee|adjudicat/i)
  assert.match(REFEREE_PROMPT, /Never name yourself/)
  assert.doesNotMatch(JSON.stringify(context), /referee|adjudicat|internal-referee/i)
  assert(!('rulings' in context))
  assert(context.developments.length === 1)
  assert.equal(context.offers[0].digest, offer.digest)
  assert(JSON.stringify(world) === before, 'context projection must not mutate source records')
})
test('internal settlement enforcement persists and reports practical outcomes rather than an overseer', () => {
  const { world, state, offer } = fixture(),
    before = world.nations.map((n) => n.treasury)
  acceptRefereeDecision(
    world,
    {
      rulings: [
        {
          offer: offer.id,
          digest: offer.digest,
          verdict: 'approve',
          reasoning: 'The referee approved the payment.',
          resolved: [],
          effects: [],
          misconduct: [],
        },
      ],
    },
    [{ id: offer.id, digest: offer.digest }],
    'internal-model',
  )
  assert.equal(offer.status, 'ratified')
  assert.equal(world.nations[0].treasury, before[0] - 1)
  assert.equal(world.nations[1].treasury, before[1] + 1)
  assert.doesNotMatch(offer.ruling, /referee/i)
  assert.match(state.agents[1].escalation, /Agreement took effect/)
  const unsigned = fixture()
  unsigned.offer.signatures = unsigned.offer.signatures.slice(0, 1)
  acceptRefereeDecision(
    unsigned.world,
    {
      rulings: [
        {
          offer: unsigned.offer.id,
          digest: unsigned.offer.digest,
          verdict: 'approve',
          reasoning: 'Consent claimed.',
          resolved: [],
          effects: [],
          misconduct: [],
        },
      ],
    },
    [{ id: unsigned.offer.id, digest: unsigned.offer.digest }],
    'internal-model',
  )
  assert.equal(unsigned.offer.status, 'proposed', 'internal approval cannot forge missing consent')
  const plan: StateAgentPlan = {
    assessment: 'Assessing circumstances.',
    strategy: 'Protect supply.',
    memory: 'Remember limits.',
    goals: [],
    escalate: false,
    reason: '',
    orders: [
      {
        kind: 'build',
        target: world.regions.find((r) => r.nation !== 0)!.id,
        key: '',
        value: 0,
        text: 'farm',
      },
    ],
    messages: [],
    offers: [],
    answers: [],
  }
  const trust = state.agents[0].integrity
  acceptStatePlan(world, 0, plan, true, 'fixture')
  assert(state.agents[0].integrity < trust)
  assert.doesNotMatch(state.agents[0].escalation, /referee|adjudicat/i)
  validateWorld(world)
})
