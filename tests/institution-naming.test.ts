import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { relation } from '../src/sim/types'
import { applyInstitutionTerm, validateInstitutions } from '../src/sim/institutions'
import {
  recordInstitution,
  reconcileInstitutions,
  removeInstitutionMember,
} from '../src/sim/institution-lifecycle'
import { institutionNamingContext, acceptInstitutionNames } from '../src/sim/institution-naming'
import { advanceAlmanac, writingContext, acceptWriting } from '../src/sim/almanac'
import { restoreWorld } from '../src/sim/persistence'
import { institutionAt } from '../src/sim/world-archive'
import { writingPrompt, writingSchema } from '../server/world-writing'
import { MODEL_TASK_TIERS } from '../src/sim/model-tasks'
import type { DiplomaticClause, DiplomaticOffer } from '../src/sim/statecraft-types'
import type { InstitutionEvent } from '../src/sim/institution-types'

const initial = generateWorld('institution-naming')
function fixture() {
  const w = structuredClone(initial)
  for (const nation of w.nations)
    Object.assign(nation, { name: `State ${nation.id}`, shortName: `State ${nation.id}` })
  for (const [id, name] of ['Veyr', 'Illyra', 'Nordmark'].entries())
    Object.assign(w.nations[id], { name, shortName: name, ai: true })
  const term: DiplomaticClause = {
    kind: 'institution',
    from: 0,
    to: -1,
    amount: 0,
    good: '',
    field: '',
    regions: [],
    duration: 0,
    text: 'League of Veyr, Illyra, Nordmark',
    charter: {
      operation: 'found',
      id: 0,
      form: 'defense-league',
      powers: ['defense'],
      rule: 'majority',
      contribution: 0.02,
      exit: 'notice',
    },
  }
  applyInstitutionTerm(w, term, { id: 1, parties: [0, 1, 2], visibility: 'public' } as DiplomaticOffer)
  return { w, o: w.institutions!.organizations[0], term }
}
function response(context: ReturnType<typeof institutionNamingContext>, name = 'Concord of the Three') {
  return {
    names: context.targets.map((target) => ({
      id: target.id,
      name,
      reason: 'The remaining members continue their shared defense.',
      alternatives: [],
    })),
  }
}
function expelAggressor(w: ReturnType<typeof fixture>['w']) {
  Object.assign(relation(w, 0, 1)!, { treaty: 'war', aggressor: 0, since: w.month })
  reconcileInstitutions(w)
  w.month += 6
  reconcileInstitutions(w)
}

test('expelling Veyr after attacking Illyra reviews the surviving league and preserves its history', () => {
  const { w, o } = fixture()
  advanceAlmanac(w, true)
  expelAggressor(w)
  for (let i = 0; i < 12; i++) recordInstitution(w, o, 'defense', 'Routine defense update.')
  const context = institutionNamingContext(w),
    target = context.targets[0]
  assert.deepEqual(
    target.members.map((n) => n.shortName),
    ['Illyra', 'Nordmark'],
  )
  assert.deepEqual(
    target.excludedMembers.map((n) => n.shortName),
    ['Veyr'],
  )
  assert(target.recentEvents.some((e) => e.kind === 'expelled'))
  const before = structuredClone(o),
    rng = w.rng,
    treasury = w.nations.map((n) => n.treasury)
  assert.throws(
    () => acceptInstitutionNames(w, context, response(context, o.name), 'test/cheap'),
    /nonmember/,
  )
  assert.deepEqual(o, before)
  assert(
    acceptInstitutionNames(w, context, response(context, 'Concord of Illyra and Nordmark'), 'test/cheap'),
  )
  assert.deepEqual(o.members, [1, 2])
  assert.deepEqual(o.charter, before.charter)
  assert.equal(o.treasury, before.treasury)
  assert.deepEqual(
    w.nations.map((n) => n.treasury),
    treasury,
  )
  assert.equal(w.rng, rng)
  assert.equal(institutionAt(o, 0)!.name, 'League of Veyr, Illyra, Nordmark')
  assert.equal(institutionAt(o, 6)!.name, 'Concord of Illyra and Nordmark')
  assert.deepEqual(o.events!.slice(0, -1), before.events)
  advanceAlmanac(w, true)
  const place = w.almanac!.entries[`institution:${o.id}`]
  assert.equal(place.name, o.name)
  assert(place.names.some((alias) => alias.name === before.name))
  assert.equal(institutionNamingContext(w).targets.length, 0)
  validateInstitutions(w)
})

test('a name that still fits is reviewed once, survives reload, and future events reopen it', () => {
  const { w, o } = fixture()
  const context = institutionNamingContext(w),
    count = o.events!.length
  acceptInstitutionNames(w, context, response(context, o.name), 'test/cheap')
  assert.equal(o.events!.length, count)
  assert.equal(institutionNamingContext(w).targets.length, 0)
  const restored = restoreWorld(JSON.parse(JSON.stringify(w)))
  assert.deepEqual(restored.institutions!.organizations[0].nameReview, o.nameReview)
  assert.equal(institutionNamingContext(restored).targets.length, 0)
  expelAggressor(restored)
  assert.equal(institutionNamingContext(restored).targets.length, 1)
})

test('suspensions, constitutional changes and recovery trigger reviews; notice and defense bookkeeping do not', () => {
  const major: InstitutionEvent['kind'][] = [
    'joined',
    'left',
    'amended',
    'expelled',
    'reinstated',
    'crisis',
    'recovered',
    'succession',
  ]
  const { w, o } = fixture()
  for (const kind of [...major, 'defense', 'withdrawal'] as const) {
    const context = institutionNamingContext(w)
    if (context.targets.length) acceptInstitutionNames(w, context, response(context, o.name), 'test/cheap')
    recordInstitution(w, o, kind, 'Recorded change.')
    assert.equal(institutionNamingContext(w).targets.length, major.includes(kind) ? 1 : 0, kind)
  }
  Object.assign(relation(w, 0, 1)!, { treaty: 'war', aggressor: 0, since: 0 })
  reconcileInstitutions(w)
  const suspended = institutionNamingContext(w)
  assert.deepEqual(
    suspended.targets[0].members.map((n) => n.id),
    [1, 2],
  )
  assert.throws(
    () => acceptInstitutionNames(w, suspended, response(suspended, 'Veyr Pact'), 'test/cheap'),
    /suspended/,
  )
})

test('in-flight replies cannot overwrite a newer constitution, explicit rename, or dissolution', () => {
  for (const change of ['expel', 'rename', 'dissolve'] as const) {
    const { w, o } = fixture(),
      context = institutionNamingContext(w)
    if (change === 'expel') expelAggressor(w)
    else {
      if (change === 'rename') o.name = 'Council Name'
      else o.status = 'dissolved'
      recordInstitution(w, o, change === 'rename' ? 'renamed' : 'dissolved', 'Council decision.')
    }
    const before = structuredClone(o)
    assert.equal(acceptInstitutionNames(w, context, response(context), 'test/cheap'), false)
    assert.deepEqual(o, before)
    assert.equal(institutionNamingContext(w).targets.length, change === 'expel' ? 1 : 0)
  }
})

test('member renaming invalidates a delayed naming review without acknowledging it', () => {
  const { w, o } = fixture(),
    context = institutionNamingContext(w)
  w.nations[1].shortName = 'New Illyra'
  assert.equal(acceptInstitutionNames(w, context, response(context), 'test/cheap'), false)
  assert.equal(o.nameReview, undefined)
  assert.equal(institutionNamingContext(w).targets.length, 1)
})

test('legacy stale names are reviewed without inventing earlier membership', () => {
  const { w, o } = fixture()
  o.members = [1, 2]
  delete o.events
  w.month = 20
  const context = institutionNamingContext(w)
  assert.equal(o.events![0].kind, 'baseline')
  assert.equal(o.events![0].month, 20)
  assert(context.targets[0].excludedMembers.some((n) => n.shortName === 'Veyr'))
  assert.equal(institutionAt(o, 0), undefined)
  acceptInstitutionNames(w, context, response(context, 'Northern Concord'), 'test/cheap')
  validateInstitutions(w)
})

test('review batches are bounded and keep confidential institutions out of public contexts and atlas', () => {
  const { w, o, term } = fixture()
  o.visibility = 'secret'
  for (let i = 0; i < 8; i++)
    applyInstitutionTerm(w, { ...term, text: `League ${i}` }, {
      id: i + 2,
      parties: [0, 1, 2],
      visibility: 'public',
    } as DiplomaticOffer)
  const secret = institutionNamingContext(w)
  assert.equal(secret.targets.length, 1)
  assert.equal(secret.targets[0].visibility, 'secret')
  acceptInstitutionNames(w, secret, response(secret, o.name), 'test/cheap')
  const publicContext = institutionNamingContext(w)
  assert.equal(publicContext.targets.length, 6)
  assert(publicContext.targets.every((target) => target.visibility === 'public'))
  advanceAlmanac(w, true)
  assert.equal(w.almanac!.entries[`institution:${o.id}`], undefined)
})

test('malformed, duplicate and outsider names reject the whole batch before mutation', () => {
  const { w, o, term } = fixture()
  applyInstitutionTerm(w, { ...term, text: 'Other League' }, {
    id: 2,
    parties: [0, 1, 2],
    visibility: 'public',
  } as DiplomaticOffer)
  const context = institutionNamingContext(w),
    before = structuredClone(w.institutions)
  for (const invalid of [
    { names: [] },
    response(context, 'Duplicate Pact'),
    { names: [response(context).names[0], response(context).names[0]] },
    { names: [response(context).names[0], { ...response(context).names[1], name: '<b>Bad</b>' }] },
    { names: [response(context).names[0], { ...response(context).names[1], id: 'institution:999' }] },
    response(context, w.nations[3].shortName),
  ]) {
    assert.throws(() => acceptInstitutionNames(w, context, invalid, 'test/cheap'))
    assert.deepEqual(w.institutions, before)
  }
  assert.equal(o.nameReview, undefined)
})

test('public institutions cannot be renamed by generic atlas batches, including older in-flight batches', () => {
  const { w, o } = fixture()
  advanceAlmanac(w, true)
  const place = w.almanac!.entries[`institution:${o.id}`]
  place.naming = 'pending' // Simulate an old worker's already captured batch.
  const context = writingContext(w, { id: 'old', task: 'naming', place: place.id })
  assert(!context.targets.some((target) => target.id === place.id))
  context.targets = [place]
  acceptWriting(
    w,
    context,
    { names: [{ id: place.id, name: 'Wrong Old Name', reason: 'Old reply.', alternatives: [] }] },
    'test/cheap',
  )
  assert.equal(place.name, o.name)
  assert.notEqual(o.name, 'Wrong Old Name')
})

test('review cursors are validated and journal replacement invalidates the polling cache', () => {
  const { w, o } = fixture()
  institutionNamingContext(w)
  o.events = [...o.events!, { ...o.events![0], id: 2, kind: 'renamed' }]
  assert.equal(institutionNamingContext(w).targets.length, 0)
  for (const invalid of [
    null,
    { event: 999, model: 'test' },
    { event: -1, model: 'test' },
    { event: 1, model: '' },
  ]) {
    o.nameReview = invalid as NonNullable<typeof o.nameReview>
    assert.throws(() => validateInstitutions(w), /history/)
  }
})

test('departure after notice queues a review only when membership changes', () => {
  const { w, o, term } = fixture()
  acceptInstitutionNames(
    w,
    institutionNamingContext(w),
    response(institutionNamingContext(w), o.name),
    'test/cheap',
  )
  applyInstitutionTerm(w, { ...term, charter: { ...term.charter!, operation: 'withdraw', id: o.id } }, {
    id: 2,
    parties: [0],
    visibility: 'public',
  } as DiplomaticOffer)
  assert.equal(institutionNamingContext(w).targets.length, 0)
  w.month = 6
  reconcileInstitutions(w)
  assert.equal(institutionNamingContext(w).targets.length, 1)
  removeInstitutionMember(w, o, 1, 'left', 'Withdrawn.')
  assert.equal(o.status, 'dissolved')
  assert.equal(institutionNamingContext(w).targets.length, 0)
})

test('institution review reuses the lightweight naming schema with an explicit event-aware prompt', () => {
  assert.equal(MODEL_TASK_TIERS.naming, 'light')
  assert.equal(writingSchema('naming').properties.names!.maxItems, 20)
  const prompt = writingPrompt('naming')
  for (const phrase of [
    'institution-naming',
    'current members',
    'Keep the exact current name',
    'excluded',
    'confidential',
  ])
    assert(prompt.includes(phrase))
})

test('scheduler polling scans only newly appended defense records after warming the journal cache', () => {
  const { w, o } = fixture(),
    context = institutionNamingContext(w)
  acceptInstitutionNames(w, context, response(context, o.name), 'test/cheap')
  const first = o.events![0]
  for (let i = 0; i < 20000; i++) o.events!.push({ ...first, id: i + 2, kind: 'defense' })
  let reads = 0
  o.events = new Proxy(o.events!, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++
      return Reflect.get(target, key, receiver)
    },
  })
  assert.equal(institutionNamingContext(w).targets.length, 0)
  assert(reads > 20000)
  reads = 0
  for (let i = 0; i < 100; i++) assert.equal(institutionNamingContext(w).targets.length, 0)
  assert.equal(reads, 0)
  o.events.push({ ...first, id: o.events.length + 1, kind: 'defense' })
  assert.equal(institutionNamingContext(w).targets.length, 0)
  assert(reads < 5)
})
