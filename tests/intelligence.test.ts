import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { generateWorld } from '../src/sim/generate'
import { tick } from '../src/sim/engine'
import {
  ensureStatecraft,
  stateAgentContext,
  submitStandingOffer,
  acceptStatePlan,
} from '../src/sim/statecraft'
import { advanceGeopolitics } from '../src/sim/geopolitics'
import {
  advanceIntelligence,
  configureIntelligence,
  intelligenceService,
  foreignIntelligence,
  perceivedPower,
  knownMap,
  perceivedAllies,
} from '../src/sim/intelligence'
import { validateWorld, restoreWorld } from '../src/sim/persistence'
import { IntelligenceOffice } from '../src/components/IntelligenceOffice'
import type { StateAgentPlan } from '../src/sim/statecraft-types'
import type { World } from '../src/sim/types'

function fixture(seed = 'partial-knowledge') {
  const w = generateWorld(seed)
  ensureStatecraft(w)
  for (const s of w.intelligence!.services) s.budgetShare = 0
  const s = intelligenceService(w, 0),
    target = s.dossiers[0].nation
  return { w, s, target }
}
const months = (w: World, n: number) => {
  for (let i = 0; i < n; i++) {
    w.month++
    advanceIntelligence(w)
  }
}
test('states receive partial charts, uncertain dossiers and own forces, with no private foreign state or global statistics', () => {
  const { w, s } = fixture(),
    c = stateAgentContext(w, 0, true)
  assert(s.chart.length < w.regions.length)
  assert(c.foreignStates.length > 0)
  for (const other of c.foreignStates) {
    assert(
      !('character' in other) &&
        !('armySize' in other) &&
        !('navy' in other) &&
        !('population' in other) &&
        !('stability' in other),
    )
    if (other.military) {
      assert(other.military.values.effectivePower.high > other.military.values.effectivePower.low)
      assert(other.military.confidence < 1)
    }
  }
  assert(c.armies.every((a) => a.nation === 0))
  assert(c.fleets.every((f) => f.nation === 0))
  assert(!('simulationConditions' in c))
  assert(c.map.every((p) => p.neighbors.every((id) => c.map.some((known) => known.id === id))))
  assert.match(c.intelligence.limits, /unknown, not zero/)
})

test('changing hidden foreign armies, fleets, treasury, research, reserves and private motives does not change an actor’s context', () => {
  const { w, target } = fixture('knowledge-leak-check'),
    before = stateAgentContext(w, 0, true)
  const n = w.nations[target]
  n.treasury = 987654321
  n.population *= 3
  n.stability = 1
  n.legitimacy = 2
  n.technologies.military += 1
  n.character!.leader.politics!.ambition = 'A hidden invasion plan'
  n.character!.effective.assertiveness = 0.999
  for (const a of w.armies.filter((a) => a.nation === target)) {
    a.soldiers *= 5
    a.morale = 0.01
    a.supply = 0.03
    a.target = null
  }
  for (const r of w.regions.filter((r) => r.nation === target)) {
    r.production.iron = 88888
    r.stocks.food = 9999999
    r.unrest = 98
  }
  for (const f of w.warfare?.fleets.filter((f) => f.nation === target) ?? []) f.warships = 12
  assert.deepEqual(stateAgentContext(w, 0, true), before)
})

test('local strategy uses the same recorded intelligence instead of secretly consulting foreign strength', () => {
  const { w, target } = fixture('native-knowledge')
  for (const n of w.nations) n.ai = n.id === 0
  w.month = 24
  const altered = structuredClone(w)
  for (const a of altered.armies.filter((a) => a.nation === target)) {
    a.soldiers *= 100
    a.morale = 0.001
  }
  altered.nations[target].treasury = 0
  assert.equal(perceivedPower(w, 0, target), perceivedPower(altered, 0, target))
  advanceGeopolitics(w)
  advanceGeopolitics(altered)
  assert.deepEqual(w.nations[0].policies, altered.nations[0].policies)
  assert.deepEqual(
    w.armies.filter((a) => a.nation === 0),
    altered.armies.filter((a) => a.nation === 0),
  )
  assert.deepEqual(
    w.statecraft!.offers.filter((o) => o.author === 0),
    altered.statecraft!.offers.filter((o) => o.author === 0),
  )
})

test('funding develops focused networks over time and consumes actual treasury without adding people', () => {
  const { w, s, target } = fixture('funded-reporting'),
    n = w.nations[0],
    before = structuredClone(s.dossiers.find((d) => d.nation === target)!)
  n.income = 1000
  n.treasury = 100000
  const money = n.treasury,
    people = w.totals.population
  configureIntelligence(w, 0, 0.1, 'military', target)
  assert.equal(s.capacity, 0)
  assert.deepEqual(
    s.dossiers.find((d) => d.nation === target),
    before,
  )
  months(w, 24)
  const d = s.dossiers.find((d) => d.nation === target)!
  assert.equal(money - n.treasury, 2400)
  assert.equal(s.totalSpent, 2400)
  assert(s.capacity > 0 && d.access > 0)
  assert(d.military!.confidence > before.military!.confidence)
  assert.equal(w.totals.population, people)
  const collected = d.military!.month
  stateAgentContext(w, 0, true)
  stateAgentContext(w, 0, true)
  assert.equal(d.military!.month, collected, 'requesting another context cannot reroll observations')
  validateWorld(w)
})

test('an unfunded appropriation buys neither network access nor trained collection capacity', () => {
  const { w, s, target } = fixture('unfunded-reporting')
  w.nations[0].treasury = 0
  w.nations[0].income = 1000
  configureIntelligence(w, 0, 0.15, 'politics', target)
  months(w, 18)
  assert.equal(s.spent, 0)
  assert.equal(s.totalSpent, 0)
  assert.equal(s.capacity, 0)
  assert.equal(s.dossiers.find((d) => d.nation === target)!.access, 0)
  assert.throws(() => configureIntelligence(w, 0, 0.16, 'balanced', null), /15%/)
  assert.throws(() => configureIntelligence(w, 0, 0.1, 'balanced', 0), /already known/)
  validateWorld(w)
})

test('reports retain their date and lose confidence with age; secret third-party pacts remain unknown', () => {
  const { w, s, target } = fixture('reports-and-secrecy'),
    other = w.nations.find((n) => n.id !== 0 && n.id !== target)!.id
  const offer = submitStandingOffer(w, target, {
    title: 'Hidden mutual defense',
    visibility: 'secret',
    parties: [target, other],
    duration: 24,
    supersedes: 0,
    terms: [
      {
        kind: 'alliance',
        from: target,
        to: other,
        amount: 0,
        good: '',
        field: '',
        regions: [],
        duration: 24,
        text: 'Confidential defense.',
      },
    ],
  })
  const old = foreignIntelligence(w, 0).find((d) => d.id === target)!.military!
  w.month = 24
  const stale = foreignIntelligence(w, 0).find((d) => d.id === target)!.military!
  assert.equal(stale.month, old.month)
  assert(stale.currentConfidence < old.currentConfidence)
  assert.deepEqual(stale.values, old.values)
  months(w, 12)
  const c = stateAgentContext(w, 0, true)
  assert(!c.offers.some((o) => o.id === offer.id))
  assert(!JSON.stringify(c).includes('Hidden mutual defense'))
  assert(!s.agreements.some((r) => r.offer.id === offer.id))
  assert(!perceivedAllies(w, 0, target).includes(other))
})

test('public agreements and news arrive through contacts with delay and do not reveal full foreign event consequences', () => {
  const { w, s, target } = fixture('slow-news'),
    other = w.nations.find((n) => n.id !== 0 && n.id !== target)!.id
  const offer = submitStandingOffer(w, target, {
    title: 'Reported open commerce',
    visibility: 'public',
    parties: [target, other],
    duration: 24,
    supersedes: 0,
    terms: [
      {
        kind: 'research',
        from: target,
        to: other,
        amount: 1,
        good: '',
        field: 'logistics',
        regions: [],
        duration: 24,
        text: 'Lower tariffs.',
      },
    ],
  })
  w.events.unshift({
    id: w.nextEvent++,
    month: 0,
    type: 'war',
    nation: target,
    title: 'A distant border clash',
    detail: 'SECRET_EXACT_FOREIGN_CASUALTIES',
  })
  assert(!stateAgentContext(w, 0, true).offers.some((o) => o.id === offer.id))
  assert(!stateAgentContext(w, 0, true).recentPublicHistory.some((e) => e.title === 'A distant border clash'))
  months(w, 6)
  const c = stateAgentContext(w, 0, true)
  assert(s.agreements.some((r) => r.offer.id === offer.id))
  assert(c.offers.some((o) => o.id === offer.id))
  assert(c.recentPublicHistory.some((e) => e.title === 'A distant border clash'))
  assert(!JSON.stringify(c).includes('SECRET_EXACT_FOREIGN_CASUALTIES'))
  validateWorld(w)
})

test('counterintelligence reduces the quality of an equally funded rival network', () => {
  const { w, target } = fixture('counterintelligence'),
    n = w.nations[0]
  n.income = 1000
  n.treasury = 100000
  configureIntelligence(w, 0, 0.15, 'military', target)
  const closed = structuredClone(w),
    opposing = intelligenceService(closed, target)
  opposing.priority = 'counterintelligence'
  opposing.capacity = 0.9
  opposing.budgetShare = 0.15
  closed.nations[target].income = 1000
  closed.nations[target].treasury = 100000
  months(w, 24)
  months(closed, 24)
  const read = (x: World) =>
    intelligenceService(x, 0).dossiers.find((d) => d.nation === target)!.military!.confidence
  assert(read(closed) < read(w))
})

test('state agents can fund intelligence through validated domestic orders', () => {
  const { w, s, target } = fixture('agent-reporting-orders')
  const plan: StateAgentPlan = {
    assessment: 'Need a military report.',
    strategy: 'Observe the frontier.',
    memory: 'Uncertain foreign reserves.',
    goals: ['Improve military information'],
    escalate: false,
    reason: '',
    orders: [{ kind: 'intelligence', target, key: 'military', value: 4, text: '' }],
    messages: [],
    offers: [],
    answers: [],
  }
  acceptStatePlan(w, 0, plan, true, 'fixture', w.month)
  assert.equal(s.budgetShare, 0.04)
  assert.equal(s.priority, 'military')
  assert.equal(s.focus, target)
})

test('knowledge persists through exact monthly continuation, validates untrusted records and upgrades legacy worlds without omniscience', () => {
  const { w } = fixture('saved-intelligence')
  for (let i = 0; i < 3; i++) tick(w)
  validateWorld(w)
  const copy = restoreWorld(JSON.parse(JSON.stringify(w)))
  tick(w)
  tick(copy)
  assert.equal(JSON.stringify(copy), JSON.stringify(w))
  const bad = structuredClone(w)
  bad.intelligence!.services[0].budgetShare = 1
  assert.throws(() => validateWorld(bad), /intelligence/)
  const legacy = structuredClone(w)
  delete legacy.intelligence
  const loaded = restoreWorld(legacy)
  const chart = knownMap(loaded, 0)
  assert(chart.length < loaded.regions.length)
  assert.equal(intelligenceService(loaded, 0).totalSpent, 0)
  validateWorld(loaded)
})

test('internal resolution reasoning and future effect schedules do not become strategic intelligence', () => {
  const { w, target } = fixture('resolution-privacy'),
    state = w.statecraft!
  const offer = submitStandingOffer(w, 0, {
    title: 'An implementation question',
    visibility: 'public',
    parties: [0, target],
    duration: 12,
    supersedes: 0,
    terms: [
      {
        kind: 'custom',
        from: 0,
        to: target,
        amount: 0,
        good: '',
        field: '',
        regions: [],
        duration: 0,
        text: 'Propose talks.',
      },
    ],
  })
  offer.ruling = 'HIDDEN_RESOLUTION_TRUTH: the foreign treasury has a secret reserve.'
  state.rulings.push({
    id: state.nextId++,
    month: w.month,
    offer: offer.id,
    visibility: 'public',
    parties: [0, target],
    verdict: 'defer',
    reasoning: offer.ruling,
    model: 'internal',
    effects: [],
  })
  const c = stateAgentContext(w, 0, true)
  assert(!JSON.stringify(c).includes('HIDDEN_RESOLUTION_TRUTH'))
  assert(c.developments.length > 0)
  assert(!('effects' in c.developments[0]))
})

test('the diplomacy inspector exposes funding controls, unknown estimates and the selected government’s reports', () => {
  const { w } = fixture('intelligence-interface')
  const html = renderToStaticMarkup(
    createElement(IntelligenceOffice, { world: w, nation: 0, onCommand: () => {} }),
  )
  assert(html.includes('Intelligence and foreign reports'))
  assert(html.includes('Fund this reporting plan'))
  assert(html.includes('Counterintelligence'))
  assert(html.includes('Unknown'))
  assert(!/referee/i.test(html))
})
