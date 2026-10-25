import { endowTreasury } from './fixtures/endowment'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { generateWorld } from '../src/sim/generate'
import {
  ensureStatecraft,
  submitStandingOffer,
  settleConventionalOffers,
  readyOffers,
  admitDiplomaticConsent,
  acceptStatePlan,
  acceptRefereeDecision,
} from '../src/sim/statecraft'
import {
  advanceDiplomaticOffices,
  diplomaticCapacity,
  DiplomaticFriction,
  foreignOfficeContext,
} from '../src/sim/diplomatic-friction'
import { relation, type World } from '../src/sim/types'
import type { StateAgentPlan, DiplomaticClause, DiplomaticOffer } from '../src/sim/statecraft-types'
import { agreementTerms } from '../src/sim/agreements'
import { validateWorld, restoreWorld } from '../src/sim/persistence'
import { DiplomaticChancery } from '../src/components/DiplomaticChancery'
import { applyCommand } from '../src/sim/engine'
import { intelligenceService } from '../src/sim/intelligence'

function fresh(seed = 'diplomatic-friction') {
  const w = generateWorld(seed)
  ensureStatecraft(w)
  for (const r of w.relations) r.treaty = 'neutral'
  for (const n of w.nations) {
    endowTreasury(w, n.id, 10000)
    n.budget.administration = 20
  }
  return w
}
function clause(kind: DiplomaticClause['kind'] = 'trade', from = 0, to = 1): DiplomaticClause {
  return {
    kind,
    from,
    to,
    amount: kind === 'research' ? 1 : 0,
    good: '',
    field: kind === 'research' ? 'logistics' : '',
    regions: [],
    duration: 0,
    text: '',
  }
}
function draft(kind: DiplomaticClause['kind'] = 'trade', to = 1): StateAgentPlan['offers'][number] {
  return {
    title: 'A substantive arrangement',
    parties: [0, to],
    visibility: 'public',
    duration: 24,
    supersedes: 0,
    terms: [clause(kind, 0, to)],
  }
}
function wait(w: World, n: number) {
  for (let i = 0; i < n; i++) {
    w.month++
    advanceDiplomaticOffices(w)
  }
}
function sign(w: World, p: DiplomaticOffer) {
  for (const n of p.parties) assert(admitDiplomaticConsent(w, n, p))
}
function implement(w: World, p: DiplomaticOffer) {
  sign(w, p)
  wait(w, Math.max(0, (p.notBefore ?? w.month) - w.month))
  settleConventionalOffers(w)
  assert.equal(p.status, 'ratified', p.ruling)
}
const plan = (p: Partial<StateAgentPlan> = {}): StateAgentPlan => ({
  assessment: 'Review the current situation.',
  strategy: 'Maintain useful commitments.',
  memory: '',
  goals: [],
  escalate: false,
  reason: '',
  orders: [],
  messages: [],
  offers: [],
  answers: [],
  ...p,
})

test('negotiations use real funds and attention and cannot implement before diplomatic preparation, even with all signatures', () => {
  const w = fresh(),
    money = w.nations[0].treasury,
    offer = submitStandingOffer(w, 0, draft())
  assert(w.nations[0].treasury < money)
  const office = w.foreignOffices!.offices.find((o) => o.nation === 0)!
  assert(Math.abs(money - w.nations[0].treasury - office.spent) < 1e-8)
  assert(office.load > 0 && offer.notBefore! > w.month)
  sign(w, offer)
  assert(!readyOffers(w).includes(offer))
  settleConventionalOffers(w)
  acceptRefereeDecision(
    w,
    {
      rulings: [
        {
          offer: offer.id,
          digest: offer.digest,
          verdict: 'approve',
          reasoning: 'Implement the commitments.',
          resolved: [],
          effects: [],
          misconduct: [],
        },
      ],
    },
    [{ id: offer.id, digest: offer.digest }],
    'fixture',
  )
  assert.equal(offer.status, 'proposed')
  assert.equal(relation(w, 0, 1)!.treaty, 'neutral')
  wait(w, offer.notBefore! - w.month)
  settleConventionalOffers(w)
  assert.equal(offer.status, 'ratified')
  assert.equal(relation(w, 0, 1)!.treaty, 'trade')
  validateWorld(w)
})

test('renaming or rewording the same negotiation creates no duplicate document or new expense', () => {
  const w = fresh(),
    p = draft(),
    first = submitStandingOffer(w, 0, p),
    cash = w.nations[0].treasury
  assert.throws(
    () =>
      submitStandingOffer(w, 0, {
        ...p,
        title: 'A freshly named pact',
        terms: [{ ...p.terms[0], text: 'New prose and an annual review.', duration: 120 }],
      }),
    DiplomaticFriction,
  )
  assert.equal(w.statecraft!.offers.length, 1)
  assert.equal(w.nations[0].treasury, cash)
  assert.equal(w.statecraft!.offers[0], first)
})

test('an existing alliance covers trade and access without additional pacts', () => {
  const w = fresh()
  relation(w, 0, 1)!.treaty = 'alliance'
  assert.throws(() => submitStandingOffer(w, 0, draft('trade')), /already provide/)
  assert.throws(() => submitStandingOffer(w, 0, draft('access')), /already provide/)
  assert.equal(w.statecraft!.offers.length, 0)
})

test('finite diplomatic capacity recovers with time and does not sanction governments for administrative overload', () => {
  const w = fresh(),
    integrity = w.statecraft!.agents[0].integrity
  let admitted = 0,
    blocked = 0
  for (let id = 1; id < w.nations.length; id++)
    try {
      submitStandingOffer(w, 0, draft('research', id))
      admitted++
    } catch (e) {
      assert(e instanceof DiplomaticFriction)
      blocked = id
      break
    }
  assert(admitted > 0 && blocked > 0)
  const o = w.foreignOffices!.offices[0],
    load = o.load
  assert(load <= diplomaticCapacity(w, 0).capacity)
  acceptStatePlan(w, 0, plan({ offers: [draft('research', blocked)] }), true, 'fixture', w.month)
  assert.equal(w.statecraft!.agents[0].integrity, integrity)
  wait(w, 12)
  assert(o.load < load)
  assert(submitStandingOffer(w, 0, draft('research', blocked)))
  validateWorld(w)
})

test('an idle government can undertake one large constitutional negotiation at the cost of its ordinary diplomatic bandwidth', () => {
  const w = fresh('large-multilateral-initiative')
  w.nations[0].budget.administration = 0
  w.nations[0].character!.leader.skills.diplomacy = 0
  w.nations[0].technologies.logistics = 0
  const p = submitStandingOffer(w, 0, {
    title: 'Common constitutional settlement',
    parties: w.nations.map((n) => n.id),
    visibility: 'public',
    duration: 36,
    supersedes: 0,
    terms: [
      {
        ...clause('institution', 0, -1),
        text: 'A shared confederation',
        charter: {
          operation: 'found',
          id: 0,
          form: 'confederation',
          powers: ['defense', 'trade'],
          rule: 'unanimity',
          contribution: 0.02,
          exit: 'notice',
        },
      },
    ],
  })
  assert(w.foreignOffices!.offices[0].load > diplomaticCapacity(w, 0).capacity)
  assert.throws(() => submitStandingOffer(w, 0, draft('research')), DiplomaticFriction)
  assert.doesNotThrow(() =>
    applyCommand(w, {
      type: 'charter-proposal',
      nation: 0,
      members: [0, 1],
      name: 'Another pact',
      charter: {
        operation: 'found',
        id: 0,
        form: 'customs-union',
        powers: ['trade'],
        rule: 'unanimity',
        contribution: 0.02,
        exit: 'free',
      },
    }),
  )
  implement(w, p)
  assert.equal(w.institutions!.organizations[0].members.length, w.nations.length)
  validateWorld(w)
})

test('parallel dealings with the same counterpart consolidate into a counteroffer after a short interval', () => {
  const w = fresh(),
    p = submitStandingOffer(w, 0, draft('research'))
  assert.throws(() => submitStandingOffer(w, 0, draft('access')), /already open/)
  const counter = { ...draft('research'), supersedes: p.id, terms: [{ ...clause('research'), amount: 2 }] }
  assert.throws(() => submitStandingOffer(w, 0, counter), /premature/)
  wait(w, 2)
  const q = submitStandingOffer(w, 0, counter)
  implement(w, q)
  assert.equal(p.status, 'expired')
  assert.equal(agreementTerms(w, 'research').length, 1)
  assert.equal(agreementTerms(w, 'research')[0].term.amount, 2)
})

test('ratified replacements retire old recurring obligations and preserve the signed original text', () => {
  const w = fresh(),
    p = submitStandingOffer(w, 0, draft('research'))
  implement(w, p)
  const digest = p.digest,
    text = JSON.stringify(p.terms)
  wait(w, 6)
  const q = submitStandingOffer(w, 0, {
    ...draft('research'),
    supersedes: p.id,
    terms: [{ ...clause('research'), amount: 3 }],
  })
  implement(w, q)
  assert.equal(p.status, 'expired')
  assert.equal(p.digest, digest)
  assert.equal(JSON.stringify(p.terms), text)
  assert.equal(agreementTerms(w, 'research').length, 1)
  assert.equal(agreementTerms(w, 'research')[0].offer.id, q.id)
  assert.throws(
    () =>
      submitStandingOffer(w, 0, {
        ...draft('research'),
        supersedes: p.id,
        terms: [{ ...clause('research'), amount: 4 }],
      }),
    /newer agreement/,
  )
  assert.throws(
    () => submitStandingOffer(w, 0, { ...draft('research', 2), supersedes: q.id }),
    /every existing party/,
  )
  validateWorld(w)
})

test('replacing a public alliance immediately removes its cached privileges when the new agreement grants only access', () => {
  const w = fresh(),
    p = submitStandingOffer(w, 0, draft('alliance'))
  implement(w, p)
  wait(w, 6)
  const q = submitStandingOffer(w, 0, { ...draft('access'), supersedes: p.id })
  implement(w, q)
  assert.equal(relation(w, 0, 1)!.treaty, 'neutral')
  assert.equal(agreementTerms(w, 'alliance').length, 0)
  assert.equal(agreementTerms(w, 'access').length, 1)
})

test('a broker using an old public report cannot discover a secret replacement through proposal admission', () => {
  const w = fresh('private-replacement'),
    original = { ...draft('research', 2), parties: [1, 2], terms: [clause('research', 1, 2)] }
  const p = submitStandingOffer(w, 1, original)
  implement(w, p)
  intelligenceService(w, 0).agreements.push({ offer: structuredClone(p), month: w.month })
  wait(w, 6)
  const hidden = submitStandingOffer(w, 1, {
    ...original,
    title: 'A confidential replacement',
    visibility: 'secret',
    supersedes: p.id,
    terms: [{ ...clause('research', 1, 2), amount: 2 }],
  })
  implement(w, hidden)
  const broker = submitStandingOffer(w, 0, {
    ...original,
    parties: [0, 1, 2],
    supersedes: p.id,
    terms: [{ ...clause('research', 1, 2), amount: 3 }],
  })
  assert.equal(broker.status, 'proposed')
  assert(!foreignOfficeContext(w, 0).notice.includes('newer'))
  validateWorld(w)
})

test('durable arrangements are left alone until their expiry approaches', () => {
  const w = fresh(),
    p = submitStandingOffer(w, 0, { ...draft(), terms: [{ ...clause(), duration: 60 }] })
  implement(w, p)
  wait(w, 6)
  const renewal = { ...draft(), supersedes: p.id, terms: [{ ...clause(), duration: 120 }] }
  assert.throws(() => submitStandingOffer(w, 0, renewal), /already provide/)
  wait(w, p.ends - 10 - w.month)
  const q = submitStandingOffer(w, 0, renewal)
  assert(q.notBefore! > w.month)
  assert.equal(p.status, 'ratified')
})

test('major changed circumstances can reopen a rejected initiative, while rejection alone is not a new opening', () => {
  const w = fresh(),
    p = submitStandingOffer(w, 0, draft('research'))
  p.status = 'rejected'
  assert.throws(() => submitStandingOffer(w, 0, draft('research')), /already pursued/)
  w.nations[0].foodCoverage = 0.5
  assert(submitStandingOffer(w, 0, draft('research')))
})

test('unilateral military orders stay immediate and genuine peace talks have an expedited path under wartime overload', () => {
  const w = fresh()
  const first = submitStandingOffer(w, 0, draft('research', 2))
  assert(first)
  w.foreignOffices!.offices[0].load = 9
  endowTreasury(w, 0, 0)
  const war = submitStandingOffer(w, 0, { ...draft('war'), parties: [0] })
  settleConventionalOffers(w)
  assert.equal(war.status, 'ratified')
  assert.equal(relation(w, 0, 1)!.treaty, 'war')
  const peace = submitStandingOffer(w, 0, draft('peace'))
  assert.equal(peace.notBefore, w.month + 1)
  sign(w, peace)
  wait(w, 1)
  settleConventionalOffers(w)
  assert.equal(peace.status, 'ratified')
  assert.equal(relation(w, 0, 1)!.treaty, 'truce')
  validateWorld(w)
})

test('maintaining agreements costs funds and slows recovery without silently cancelling their rights', () => {
  const w = fresh(),
    p = submitStandingOffer(w, 0, draft())
  implement(w, p)
  const o = w.foreignOffices!.offices[0],
    cash = w.nations[0].treasury,
    spent = o.totalSpent
  wait(w, 1)
  assert(o.spent > 0 && o.totalSpent > spent)
  assert(Math.abs(cash - w.nations[0].treasury - o.spent) < 1e-8)
  endowTreasury(w, 0, 0)
  wait(w, 1)
  assert.equal(p.status, 'ratified')
  assert.equal(relation(w, 0, 1)!.treaty, 'trade')
})

test('messages have finite bandwidth, silence is valid, and refusing a proposal remains free', () => {
  const w = fresh(),
    m = {
      to: [1],
      visibility: 'public' as const,
      subject: 'A concrete question',
      body: 'Please respond to the proposal.',
      offer: 0,
    }
  acceptStatePlan(
    w,
    0,
    plan({ messages: [m, { ...m, body: 'Following up immediately.' }] }),
    true,
    'fixture',
    w.month,
  )
  assert.equal(w.statecraft!.messages.length, 1)
  const next = w.statecraft!.nextId,
    money = w.nations[0].treasury
  acceptStatePlan(w, 0, plan(), true, 'fixture', w.month)
  assert.equal(w.statecraft!.nextId, next)
  assert.equal(w.nations[0].treasury, money)
  const p = submitStandingOffer(w, 0, draft('research'))
  const cash = w.nations[1].treasury
  acceptStatePlan(
    w,
    1,
    plan({
      answers: [
        { offer: p.id, digest: p.digest, answer: 'reject', reason: 'Existing policy is sufficient.' },
      ],
    }),
    true,
    'fixture',
    w.month,
  )
  assert.equal(w.nations[1].treasury, cash)
  assert.equal(p.status, 'rejected')
})

test('manual treaty proposals use preparation time instead of instantly granting rights', () => {
  const w = fresh()
  relation(w, 0, 1)!.opinion = 60
  const message = applyCommand(w, { type: 'diplomacy', nation: 0, target: 1, action: 'alliance' })
  assert.match(message, /proposal is dispatched/)
  const p = w.statecraft!.offers.at(-1)!
  assert.equal(relation(w, 0, 1)!.treaty, 'neutral')
  assert.equal(p.signatures.length, 2)
  wait(w, p.notBefore! - w.month)
  settleConventionalOffers(w)
  assert.equal(relation(w, 0, 1)!.treaty, 'alliance')
})

test('office workload and deadlines survive saves; legacy agreements keep their existing contract', () => {
  const w = fresh(),
    p = submitStandingOffer(w, 0, draft())
  sign(w, p)
  wait(w, 1)
  validateWorld(w)
  const copy = restoreWorld(JSON.parse(JSON.stringify(w)))
  wait(w, 2)
  wait(copy, 2)
  assert.deepEqual(copy.foreignOffices, w.foreignOffices)
  const bad = structuredClone(w)
  bad.foreignOffices!.offices[0].load = -1
  assert.throws(() => validateWorld(bad), /foreign office/)
  const legacy = fresh('legacy-diplomacy'),
    old = submitStandingOffer(legacy, 0, draft())
  delete old.notBefore
  delete legacy.foreignOffices
  sign(legacy, old)
  settleConventionalOffers(legacy)
  assert.equal(old.status, 'ratified')
  validateWorld(legacy)
})

test('the dossier exposes attention and diplomatic preparation without internal adjudication language', () => {
  const w = fresh(),
    p = submitStandingOffer(w, 0, draft())
  const html = renderToStaticMarkup(
    createElement(DiplomaticChancery, {
      world: w,
      nation: 0,
      status: { pending: 0, active: [], decisionModel: 'fixture', strategyModel: 'fixture', error: '' },
      onReview: () => {},
    }),
  )
  assert(html.includes('Diplomatic attention committed'))
  assert(html.includes('earliest implementation'))
  assert(!/referee/i.test(html))
  assert.equal(foreignOfficeContext(w, 0).pending[0].offer, p.id)
})
