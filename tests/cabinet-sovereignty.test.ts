import test from 'node:test'
import assert from 'node:assert/strict'
import { sovereignFixture } from './fixtures/sovereign-world'
import {
  sovereignStrategyContext,
  capitulationOptions,
  chooseCapitulation,
  requestSovereignReviews,
} from '../src/sim/sovereign-strategy'
import {
  acceptStatePlan,
  ensureStatecraft,
  stateAgentContext,
  refereeContext,
  settleConventionalOffers,
} from '../src/sim/statecraft'
import { sovereigntyAssessment } from '../src/sim/strategic-assessment'
import { applyRoyalAgreement, crownOf, marriageOf } from '../src/sim/dynasties'
import { advanceRoyalDiplomacy, proposeRoyalAgreement } from '../src/sim/royal-diplomacy'
import { intelligenceService } from '../src/sim/intelligence'
import { dependencyOf, establishDependency } from '../src/sim/state-dependencies'
import { relation } from '../src/sim/types'
import type { DiplomaticOffer, StateAgentPlan, DomesticOrder } from '../src/sim/statecraft-types'
import { STATE_PROMPT, REFEREE_PROMPT } from '../server/agent-prompts'

const plan = (orders: DomesticOrder[] = []): StateAgentPlan => ({
  assessment: 'Compare the constitutional and fiscal settlement.',
  strategy: 'Preserve governing capacity.',
  memory: '',
  goals: [],
  escalate: false,
  reason: '',
  orders,
  messages: [],
  offers: [],
  answers: [],
})
const capitulate = (target: number, key = 'subject', value = 25): DomesticOrder => ({
  kind: 'capitulate',
  target,
  key,
  value,
  text: 'Implement the selected settlement.',
})

/** Only consent assessment needs the terms; the normal offer path is exercised separately. */
const unionOffer = {
  terms: [{ kind: 'personal-union', from: 0, to: 1, amount: 0, regions: [] }],
} as DiplomaticOffer

test('routine and strategic cabinets see all capitulation tradeoffs without gaining foreign financial secrets', () => {
  const { w } = sovereignFixture(true)
  const service = intelligenceService(w, 0)
  // Frontier contact is not guaranteed by geographic placement. Supply one
  // explicitly dated report so the test distinguishes knowledge from live balances.
  service.dossiers = [{ nation: 1, name: w.nations[1].name, discovered: 0, access: 0, expansion: 0 }]
  const dossier = service.dossiers[0]
  dossier.economy = {
    month: 0,
    confidence: 0.4,
    sources: ['Diplomatic report'],
    values: { treasury: { estimate: 50, low: 10, high: 90 } },
  }
  w.nations[1].treasury = 7654321
  w.nations[1].debt = 9876543
  for (const strategic of [false, true]) {
    const context = stateAgentContext(w, 0, strategic)
    const briefing = context.sovereignStrategy
    const war = briefing.warSettlements.find((s) => s.nation === 1)!
    assert.equal(war.options.length, 4)
    assert(war.options.every((o) => o.available && o.authority && o.finances && o.forces && o.risks))
    assert(war.options.find((o) => o.outcome === 'annex')!.administrationCost > 0)
    assert.deepEqual(war.reportedEstate!.treasury, { estimate: 50, low: 10, high: 90 })
    assert.equal(war.reportedEstate!.debt, null)
    assert.equal(war.reportedEstate!.month, 0)
    assert(!JSON.stringify(briefing).includes('7654321'))
    assert(!JSON.stringify(briefing).includes('9876543'))
    assert(
      !briefing.royalPartners.some((p) => p.nation === 2),
      'uncontacted houses are not a global matchmaking index',
    )
    assert(!Object.hasOwn(context.affordances.crown!, 'succession'))
    assert(!Object.hasOwn(briefing.ownCrown!, 'succession'))
    assert.equal(context.affordances.capitulations[0].options.length, 4)
  }
  service.dossiers = []
  assert.equal(sovereignStrategyContext(w, 0).warSettlements[0].reportedEstate, null)
  assert(sovereignStrategyContext(w, 1).warSettlements[0].enemyCanImpose)
})

test('union assessment identifies a junior crown’s loss of ruler and offensive authority even without territorial loss', () => {
  const { w } = sovereignFixture()
  w.nations[1].character!.leader.politics!.drives.dominance = 0.1
  applyRoyalAgreement(w, 'royal-marriage', 0, 1)
  assert.equal(sovereigntyAssessment(w, 1, unionOffer).acceptable, false)
  w.month = 12
  const assessment = sovereigntyAssessment(w, 1, unionOffer)
  assert(assessment.acceptable)
  assert(assessment.delegatesForeignPolicy && assessment.changesRuler && assessment.retainsSeparateAccounts)
  assert.equal(assessment.populationShare, 0)
  assert.equal(assessment.endsSovereignty, false)
  assert.match(assessment.reasoning, /junior crown.*delegates offensive foreign policy/)
  w.nations[1].character!.leader.politics!.drives.dominance = 0.95
  assert.equal(sovereigntyAssessment(w, 1, unionOffer).acceptable, false)
  const senior = sovereigntyAssessment(w, 0, unionOffer)
  assert.equal(senior.delegatesForeignPolicy, false)
  assert.equal(senior.retainsSeparateAccounts, true)
})

test('model-led royal consent remains pending until that government signs or native fallback regains control', () => {
  const { w } = sovereignFixture()
  w.nations[1].ai = true
  const agent = ensureStatecraft(w).agents.find((a) => a.nation === 1)!
  agent.lastModel = 'deliberating cabinet'
  agent.lastDecision = w.month
  const offer = proposeRoyalAgreement(w, 0, 1, 'royal-marriage', true)!
  assert(!offer.signatures.some((s) => s.nation === 1))
  w.month = offer.notBefore!
  agent.lastDecision = w.month
  advanceRoyalDiplomacy(w)
  assert(!offer.signatures.some((s) => s.nation === 1))
  w.nations[1].ai = false
  w.month += 6
  advanceRoyalDiplomacy(w)
  assert(!offer.signatures.some((s) => s.nation === 1))
  w.nations[1].ai = true
  advanceRoyalDiplomacy(w)
  assert(offer.signatures.some((s) => s.nation === 1))
  assert.equal(offer.status, 'ratified')
})

test('model plans can propose and explicitly sign both a marriage and a matured personal union', () => {
  const { w } = sovereignFixture()
  w.nations[0].ai = w.nations[1].ai = true
  for (const kind of ['royal-marriage', 'personal-union'] as const) {
    const proposal = plan()
    proposal.offers = [
      {
        title: `A signed ${kind}`,
        visibility: 'public',
        parties: [0, 1],
        terms: [{ kind, from: 0, to: 1, amount: 0, good: '', field: '', regions: [], duration: 0, text: '' }],
        supersedes: 0,
        duration: 24,
      },
    ]
    acceptStatePlan(w, 0, proposal, true, 'cabinet', w.month)
    const offer = w.statecraft!.offers.at(-1)!
    assert(offer, w.statecraft!.audit.at(-1)?.message)
    assert(!offer.signatures.some((signature) => signature.nation === 1))
    const acceptance = plan()
    acceptance.answers = [
      {
        offer: offer.id,
        digest: offer.digest,
        answer: 'accept',
        reason: 'The constitutional bargain serves our strategy.',
      },
    ]
    acceptStatePlan(w, 1, acceptance, true, 'cabinet', w.month)
    w.month = offer.notBefore!
    settleConventionalOffers(w)
    assert.equal(offer.status, 'ratified', offer.ruling)
    if (kind === 'royal-marriage') {
      assert(marriageOf(w, 0, 1))
      assert.equal(dependencyOf(w, 1), undefined)
      w.month += 12
    } else assert.equal(dependencyOf(w, 1)?.kind, 'personal-union')
    assert.equal(w.statecraft!.audit.length, 0)
  }
})

test('new or changed sovereignty choices request one review without re-escalating unchanged monthly situations', () => {
  const { w, army } = sovereignFixture(true)
  w.nations[0].ai = true
  const agent = ensureStatecraft(w).agents[0]
  agent.lastModel = 'cabinet'
  agent.nextDecision = agent.nextStrategy = 10
  requestSovereignReviews(w)
  assert.equal(agent.nextStrategy, w.month)
  assert.match(agent.escalation, /Sovereignty review/)
  agent.escalation = ''
  agent.nextDecision = agent.nextStrategy = 10
  w.month++
  requestSovereignReviews(w)
  assert.equal(agent.nextStrategy, 10)
  assert.equal(agent.escalation, '')
  army.region = w.nations[0].capital
  requestSovereignReviews(w)
  assert.equal(agent.nextStrategy, w.month, 'lost settlement authority is a material change')
  agent.nextStrategy = 10
  agent.escalation = ''
  w.nations[0].ai = false
  crownOf(w, 0)!.heir = null
  requestSovereignReviews(w)
  assert.equal(agent.nextStrategy, 10)
  assert.equal(agent.escalation, '')
})

test('marriage maturity and changes in dependency authority are explicit strategic review triggers', () => {
  const { w } = sovereignFixture()
  applyRoyalAgreement(w, 'royal-marriage', 0, 1)
  w.nations[0].ai = true
  const agent = ensureStatecraft(w).agents[0]
  agent.lastModel = 'cabinet'
  requestSovereignReviews(w)
  agent.escalation = ''
  agent.nextStrategy = 20
  w.month = 11
  requestSovereignReviews(w)
  assert.equal(agent.nextStrategy, 20)
  w.month = 12
  requestSovereignReviews(w)
  assert.equal(agent.nextStrategy, 12)
  const pair = sovereignStrategyContext(w, 0).royalPartners.find((p) => p.nation === 1)!
  assert.equal(pair.seniorUnionObstacle, '')
  assert.equal(pair.juniorUnionObstacle, '')
  agent.nextStrategy = 20
  establishDependency(w, 0, 2, 'subject', true)
  requestSovereignReviews(w)
  assert.equal(agent.nextStrategy, 12)
  const briefing = sovereignStrategyContext(w, 2)
  assert.equal(briefing.offensiveAuthority, 0)
  assert.equal(briefing.dependencies[0].tribute, 0.15)
})

for (const outcome of ['annex', 'subject', 'personal-union', 'independence'])
  test(`the deliberation output can execute ${outcome} through the validated domestic-order path`, () => {
    const { w } = sovereignFixture(true)
    w.nations[0].ai = true
    acceptStatePlan(w, 0, plan([capitulate(1, outcome)]), true, 'cabinet', w.month)
    assert.equal(w.statecraft!.audit.length, 0)
    assert.notEqual(relation(w, 0, 1)!.treaty, 'war')
    if (outcome === 'annex') assert.equal(w.nations[1].extinct, w.month)
    else assert.equal(dependencyOf(w, 1)?.kind, outcome === 'independence' ? undefined : outcome)
  })

test('a valid quoted capitulation that becomes stale requests replanning, while invented authority is still rejected', () => {
  const { w, army } = sovereignFixture(true)
  w.nations[0].ai = true
  w.nations[1].government = 'Republic'
  const context = stateAgentContext(w, 0, true)
  const known = {
    owners: {},
    armies: [],
    capitulations: context.affordances.capitulations.map(({ nation, outcomes }) => ({ nation, outcomes })),
  }
  army.region = w.nations[0].capital
  acceptStatePlan(w, 0, plan([capitulate(1)]), true, 'cabinet', 0, known)
  assert.equal(w.statecraft!.audit.length, 0)
  assert.match(w.statecraft!.agents[0].escalation, /changed during deliberation/)
  assert.equal(relation(w, 0, 1)!.treaty, 'war')
  acceptStatePlan(w, 0, plan([capitulate(2)]), true, 'cabinet', 0, known)
  assert.equal(w.statecraft!.audit.length, 1)
  acceptStatePlan(w, 0, plan([capitulate(1, 'personal-union')]), true, 'cabinet', 0, known)
  assert.equal(w.statecraft!.audit.length, 2, 'an outcome never offered is not stale permission')
})

test('native settlement advice accounts for the governing reserve, affordability and the leader’s appetite for risk', () => {
  const { w } = sovereignFixture(true)
  const n = w.nations[0]
  n.character!.effective.solidarity = 0.2
  n.character!.effective.openness = 0.7
  n.character!.leader.politics!.drives.dominance = 0.9
  n.character!.leader.politics!.drives.riskTolerance = 0.2
  n.spending = 200
  n.income = 0
  assert.equal(chooseCapitulation(w, 0, capitulationOptions(w, 0, 1)).outcome, 'subject')
  n.treasury = 10000
  assert.equal(chooseCapitulation(w, 0, capitulationOptions(w, 0, 1)).outcome, 'annex')
  n.treasury = 1000
  n.character!.leader.politics!.drives.riskTolerance = 0.9
  assert.equal(chooseCapitulation(w, 0, capitulationOptions(w, 0, 1)).outcome, 'annex')
  n.treasury = 0
  assert.notEqual(chooseCapitulation(w, 0, capitulationOptions(w, 0, 1)).outcome, 'annex')
  assert.match(capitulationOptions(w, 0, 1).find((o) => o.outcome === 'annex')!.obstacle, /treasury/)
  relation(w, 0, 1)!.treaty = 'truce'
  const unavailable = chooseCapitulation(w, 0, capitulationOptions(w, 0, 1))
  assert.equal(unavailable.outcome, null)
  assert.match(unavailable.reasoning, /No imposed settlement is currently available/)
})

test('state and settlement briefings state the consent exception and the referee receives actual dynastic authority', () => {
  const { w } = sovereignFixture()
  establishDependency(w, 0, 1, 'subject', true)
  const context = refereeContext(w, [])
  assert.deepEqual(context.groundTruth.dependencies, w.dependencies)
  assert.deepEqual(context.groundTruth.dynasties, w.dynasties)
  assert.match(STATE_PROMPT, /sovereignStrategy/)
  assert.match(STATE_PROMPT, /Becoming a junior crown is a substantive constitutional concession/)
  assert.match(STATE_PROMPT, /defeated cabinet cannot veto/)
  assert.match(STATE_PROMPT, /public cash AND liabilities/)
  assert.doesNotMatch(STATE_PROMPT, /Genuine sovereignty transfers still require valid consent/)
  assert.match(REFEREE_PROMPT, /Imposed capitulation is a separate validated domestic order/)
})
