import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { relation } from '../src/sim/types'
import {
  applyInstitutionTerm,
  advanceInstitutions,
  sharedInstitution,
  transferInstitutionMembership,
  validateInstitutions,
} from '../src/sim/institutions'
import {
  beginInstitutionCrisis,
  reconcileInstitutions,
  institutionQuorum,
} from '../src/sim/institution-lifecycle'
import { advanceInstitutionDefense, respondToInstitutionDefense } from '../src/sim/institution-defense'
import { diplomaticAccess, diplomaticAccessView, preferentialTrade } from '../src/sim/agreements'
import { ensureIntelligence, intelligenceService } from '../src/sim/intelligence'
import type { Charter, Institution } from '../src/sim/institution-types'
import type { DiplomaticClause, DiplomaticOffer } from '../src/sim/statecraft-types'
import type { World } from '../src/sim/types'
const charter: Charter = {
  operation: 'found',
  id: 0,
  form: 'defense-league',
  powers: ['defense', 'trade'],
  rule: 'majority',
  contribution: 0.02,
  exit: 'notice',
}
function term(c: Partial<Charter> = {}, from = 0, to = -1): DiplomaticClause {
  return {
    kind: 'institution',
    from,
    to,
    amount: 0,
    good: '',
    field: '',
    regions: [],
    duration: 0,
    text: 'River League',
    charter: { ...charter, ...c },
  }
}
function act(w: World, t: DiplomaticClause, parties = [0, 1, 2]) {
  applyInstitutionTerm(w, t, { id: 1, parties, visibility: 'public' } as DiplomaticOffer)
}
function fixture(members = [0, 1, 2]) {
  const w = generateWorld('institution-life')
  act(w, term(), members)
  return { w, o: w.institutions!.organizations[0] }
}
const cash = (w: World) =>
  w.nations.reduce((s, n) => s + n.treasury, 0) +
  (w.institutions?.organizations.reduce((s, o) => s + o.treasury, 0) ?? 0)
function war(w: World, a: number, b: number) {
  Object.assign(relation(w, a, b)!, { treaty: 'war', aggressor: a, since: w.month })
}

test('internal aggression suspends access immediately, enters crisis and expels the aggressor by council mandate', () => {
  const { w, o } = fixture()
  war(w, 0, 1)
  assert(!sharedInstitution(w, 0, 2, 'defense'))
  assert(!diplomaticAccess(w, 0, 1))
  assert(!diplomaticAccessView(w)(0, 1))
  assert(!preferentialTrade(w, 0, 1))
  reconcileInstitutions(w)
  assert.equal(o.status, 'crisis')
  assert.deepEqual(o.suspended, [0])
  assert(sharedInstitution(w, 1, 2, 'defense'))
  const former = o.events![0].version!
  w.month = 6
  reconcileInstitutions(w)
  assert.equal(o.status, 'active')
  assert.deepEqual(o.members, [1, 2])
  assert.deepEqual(former.members, [0, 1, 2])
  validateInstitutions(w)
})
test('two-member internal war disbands and refunds only once, without subsidizing the aggressor', () => {
  const { w, o } = fixture([0, 1])
  o.treasury = 90
  war(w, 0, 1)
  const before = cash(w),
    attacker = w.nations[0].treasury
  advanceInstitutions(w)
  assert.equal(w.nations[0].treasury, attacker)
  w.month = 6
  reconcileInstitutions(w)
  assert.equal(o.status, 'dissolved')
  assert.equal(o.treasury, 0)
  assert(Math.abs(cash(w) - before) < 1e-7)
  const after = cash(w),
    entries = o.events!.length
  reconcileInstitutions(w)
  assert.equal(cash(w), after)
  assert.equal(o.events!.length, entries)
  validateInstitutions(w)
})
test('renaming, admissions, expulsion and charter versions retain their original names and voting rights', () => {
  const { w, o } = fixture()
  act(w, { ...term({ operation: 'rename', id: o.id }), text: 'New League' }, [0, 1])
  assert.equal(o.name, 'New League')
  assert.equal(o.events![0].version!.name, 'River League')
  act(w, term({ operation: 'join', id: o.id }, 3), [0, 1, 3])
  assert(o.members.includes(3))
  beginInstitutionCrisis(w, o, 'Breach', [3])
  assert.throws(() => act(w, term({ operation: 'expel', id: o.id }, 3, 0), [3]), /eligible/)
  act(w, term({ operation: 'expel', id: o.id }, 0, 3), [0, 1])
  assert(!o.members.includes(3))
  assert(institutionQuorum(w, o, [0, 1]))
  validateInstitutions(w)
})
test('withdrawal respects notice; dissolved history is not rewritten by subsequent state succession', () => {
  const { w, o } = fixture()
  act(w, term({ operation: 'withdraw', id: o.id }), [0])
  assert(o.members.includes(0))
  w.month = 5
  reconcileInstitutions(w)
  assert(o.members.includes(0))
  w.month = 6
  reconcileInstitutions(w)
  assert(!o.members.includes(0))
  act(w, term({ operation: 'dissolve', id: o.id }, 1), [1, 2])
  const frozen = structuredClone(o)
  transferInstitutionMembership(w, 1, 2)
  assert.deepEqual(o, frozen)
  validateInstitutions(w)
})
test('human council votes are never fabricated and unresolved crises expire', () => {
  const { w, o } = fixture()
  o.charter.rule = 'unanimity'
  w.nations[1].ai = false
  beginInstitutionCrisis(w, o, 'Refusal', [0])
  w.month = 6
  reconcileInstitutions(w)
  assert.equal(o.status, 'dissolved')
  assert(!o.events!.some((e) => e.kind === 'expelled'))
})
test('a legacy institution acquires an honest baseline and malformed histories fail validation', () => {
  const { w, o } = fixture()
  delete o.events
  w.month = 40
  reconcileInstitutions(w)
  assert.equal(o.events![0].month, 40)
  assert.equal(o.events![0].kind, 'baseline')
  validateInstitutions(w)
  o.events![0].version!.members = [999]
  assert.throws(() => validateInstitutions(w), /history/)
})
function callFixture() {
  const { w, o } = fixture()
  war(w, 3, 0)
  ensureIntelligence(w)
  // Directly supplied intelligence is dated evidence, not omniscient automatic fulfillment.
  for (const id of [1, 2]) {
    const s = intelligenceService(w, id)
    s.relations.push({
      ...relation(w, 0, 3)!,
      month: 0,
      source: 'public news',
    } as (typeof s.relations)[number])
    w.nations[id].ai = false
  }
  advanceInstitutionDefense(w, o)
  return { w, o }
}
test('defense calls record notification and real aid, preserve old responses and avoid duplicate calls', () => {
  const { w, o } = callFixture()
  const c = o.calls![0]
  assert.equal(c.responses.length, 2)
  const before = cash(w)
  respondToInstitutionDefense(w, o.id, c.id, 1, 'aid')
  assert.equal(c.responses[0].status, 'fulfilled')
  assert(Math.abs(cash(w) - before) < 1e-7)
  assert.equal(o.events!.find((e) => e.call?.responses.length === 2)!.call!.responses[0].status, 'pending')
  advanceInstitutionDefense(w, o)
  assert.equal(o.calls!.length, 1)
  assert.throws(() => respondToInstitutionDefense(w, o.id, c.id, 1, 'aid'), /pending/)
  w.month = 6
  advanceInstitutionDefense(w, o)
  assert.equal(c.responses[1].status, 'overdue')
  assert.equal(o.status, 'crisis')
  validateInstitutions(w)
})
test('declarations alone do not fulfill military duties, and peace releases pending responses', () => {
  const { w, o } = callFixture()
  const c = o.calls![0]
  c.requirement = 'military'
  war(w, 1, 3)
  w.armies = w.armies.filter((a) => a.nation !== 1)
  advanceInstitutionDefense(w, o)
  assert.equal(c.responses[0].status, 'pending')
  relation(w, 0, 3)!.treaty = 'truce'
  w.month = 1
  advanceInstitutionDefense(w, o)
  assert.equal(c.closed, 1)
  assert(c.responses.every((r) => r.status === 'released'))
})

test('defending an attacked member preserves the original aggressor and does not multiply defense calls', async () => {
  const { applyCommand } = await import('../src/sim/commands')
  const { w, o } = fixture()
  war(w, 0, 1)
  reconcileInstitutions(w)
  applyCommand(w, { type: 'diplomacy', nation: 2, target: 0, action: 'war' })
  assert.equal(relation(w, 0, 2)!.aggressor, 0)
  assert.equal(relation(w, 0, 2)!.defenseOf, 1)
  assert.deepEqual(o.suspended, [0])
  advanceInstitutionDefense(w, o)
  assert.equal(o.calls!.length, 1)
})

test('removing defense powers preserves existing duties and still releases them at peace', () => {
  const { w, o } = callFixture()
  const call = o.calls![0]
  act(w, term({ operation: 'amend', id: o.id, powers: ['trade'] }))
  war(w, 4, 2)
  advanceInstitutionDefense(w, o)
  assert.equal(o.calls!.length, 1)
  assert.equal(call.responses[0].status, 'pending')
  respondToInstitutionDefense(w, o.id, call.id, 1, 'aid')
  assert.equal(call.responses[0].status, 'fulfilled')
  relation(w, 0, 3)!.treaty = 'truce'
  w.month = 1
  advanceInstitutionDefense(w, o)
  assert.equal(call.closed, 1)
  assert.equal(call.responses[1].status, 'released')
  validateInstitutions(w)
})

test('removing multiple extinct members cannot rewrite a terminal dissolution', () => {
  const { w, o } = fixture()
  for (const r of w.regions) if (o.members.includes(r.nation)) r.nation = 3
  reconcileInstitutions(w)
  const final = o.events!.at(-1)!
  assert.equal(o.status, 'dissolved')
  assert.equal(final.kind, 'dissolved')
  const frozen = structuredClone(o)
  reconcileInstitutions(w)
  assert.deepEqual(o, frozen)
  validateInstitutions(w)
})
