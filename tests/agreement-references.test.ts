import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AgreementText } from '../src/components/AgreementReference'
import {
  agreementReference,
  referencedAgreementIds,
  splitAgreementReferences,
  retainAgreementReferences,
  agreementReferenceIndex,
} from '../src/sim/agreement-references'
import type { DiplomaticOffer, Statecraft } from '../src/sim/statecraft-types'
import type { World } from '../src/sim/types'
import { hashSeed } from '../src/sim/random'
import { generateWorld } from '../src/sim/generate'
import { ensureStatecraft, stateAgentContext } from '../src/sim/statecraft'
import { validateWorld } from '../src/sim/persistence'
import { validateStatecraft } from '../src/sim/statecraft-persistence'
import { intelligenceService } from '../src/sim/intelligence'

function offer(
  id: number,
  title = `Coastal compact ${id}`,
  extra: Partial<DiplomaticOffer> = {},
): DiplomaticOffer {
  const value: DiplomaticOffer = {
    id,
    title,
    author: 0,
    month: 0,
    visibility: 'public',
    parties: [0, 1],
    terms: [
      { kind: 'payment', from: 0, to: 1, amount: 1, good: '', field: '', regions: [], duration: 0, text: '' },
    ],
    digest: '',
    signatures: [],
    status: 'rejected',
    supersedes: 0,
    expires: 12,
    activated: 0,
    ends: 0,
    ruling: '',
    resolved: [],
    breaches: 0,
    delivered: 0,
    ...extra,
  }
  value.digest = `${id}:${hashSeed(JSON.stringify([value.title, value.visibility, value.parties, value.terms])).toString(16)}`
  value.signatures = [{ nation: 0, digest: value.digest, month: 0 }]
  return value
}
function ledger(offers: DiplomaticOffer[]): Statecraft {
  return { nextId: 500, revision: 0, offers, messages: [], agents: [], rulings: [], audit: [] }
}
function render(text: string, offers: DiplomaticOffer[], nation = 0, confidential = false) {
  return renderToStaticMarkup(
    createElement(AgreementText, {
      text,
      world: { startYear: 1200, statecraft: ledger(offers) } as World,
      nation,
      confidential,
      onOpen: () => {},
    }),
  )
}

test('large diplomatic ledgers retain valid signed records while keeping bounded imports', () => {
  const w = generateWorld('Diplomatic capacity', 3, 8, undefined, 'regional')
  w.nations = Array.from({ length: 64 }, (_, id) => ({ ...w.nations[id % 8], id }))
  const state = ensureStatecraft(w)
  state.offers = Array.from({ length: 4315 }, (_, i) =>
    offer(i + 1, `Active record ${i + 1}`, { status: 'proposed' }),
  )
  state.nextId = 10000
  validateStatecraft(w)
  state.offers[0].digest = 'corrupted signature'
  assert.throws(() => validateStatecraft(w), /Invalid statecraft save/)
  state.offers = Array.from({ length: 8065 }, (_, i) => offer(i + 1))
  assert.throws(() => validateStatecraft(w), /invalid collections/)
})

test('canonical and legacy references preserve surrounding prose and ordinary numbers', () => {
  const text =
    'In 1240, revise [[agreement:8]], offer #21 and treaty No. 34. An agreement 12-month extension, proposal 1200 crowns and offer 1e6 are durations or amounts.'
  assert.deepEqual(referencedAgreementIds(text), [8, 21, 34])
  assert.equal(
    splitAgreementReferences(text)
      .map((p) => p.text)
      .join(''),
    text,
  )
  assert.equal(agreementReference(8), '[[agreement:8]]')
  assert.deepEqual(referencedAgreementIds('agreement #42 months ago and [[agreement:1000000000001]]'), [42])
})

test('links use actual titles even for agreements outside the newest twelve', () => {
  const offers = Array.from({ length: 30 }, (_, i) => offer(i + 1))
  offers[0] = offer(1, 'The Northern Passage Accord')
  const html = render('Continue [[agreement:1]] and agreement #30.', offers)
  assert.match(html, /href="#agreement-1"/)
  assert.match(html, />The Northern Passage Accord<\/a>/)
  assert.match(html, /href="#agreement-30"/)
  assert.doesNotMatch(html, /agreement #30|\[\[agreement:1\]\]/)
})

test('hidden, foreign-secret and missing references reveal no agreement titles', () => {
  const secret = offer(21, 'Secret maritime partition', { visibility: 'secret' })
  for (const [nation, confidential] of [
    [0, false],
    [2, true],
  ] as const) {
    const html = render('See [[agreement:21]].', [secret], nation, confidential)
    assert.doesNotMatch(html, /Secret maritime partition|href=|agreement-21/)
    assert.match(html, /Agreement unavailable/)
  }
  assert.match(render('See [[agreement:21]].', [secret], 1, true), /Secret maritime partition/)
  assert.match(render('See [[agreement:99]].', [secret], 1, true), /Agreement unavailable/)
})

test('untrusted reference labels and prose remain escaped text, with local links only', () => {
  const html = render('<img src=x onerror=alert(1)> [[agreement:8]] [[agreement:javascript:alert(1)]]', [
    offer(8, '<script>bad()</script>'),
  ])
  assert.doesNotMatch(html, /<img|<script|href="javascript/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /href="#agreement-8"/)
})

test('archive trimming retains cited ancestors and counteroffers without mutating signed records', () => {
  const offers = Array.from({ length: 270 }, (_, i) => offer(i + 1, `Record ${i + 1}`, { month: i }))
  offers[0].supersedes = 2
  offers[1].supersedes = 1
  offers[269] = offer(270, 'Record 270', {
    month: 269,
    terms: [{ ...offers[269].terms[0], text: 'This revises [[agreement:1]].' }],
  })
  const state = ledger(offers),
    before = JSON.stringify(state)
  const retained = retainAgreementReferences(state)
  assert(retained.some((o) => o.id === 1))
  assert(retained.some((o) => o.id === 2))
  assert(!retained.some((o) => o.id === 3))
  assert.equal(JSON.stringify(state), before)
  assert(retained.indexOf(offers[0]) < retained.indexOf(offers[269]))
})

test('agent citation catalogs include older visible sources and preserve valid signed saves', () => {
  const w = generateWorld('Agreement references'),
    state = ensureStatecraft(w)
  state.offers = [
    offer(8, 'Public harbor accord'),
    offer(21, 'Private naval understanding', { visibility: 'secret' }),
  ]
  state.nextId = 30
  state.agents.find((a) => a.nation === 2)!.memory = 'Review [[agreement:8]] and [[agreement:21]].'
  const before = JSON.stringify(state.offers)
  assert(!stateAgentContext(w, 2, true).agreementReferences.some((entry) => entry.id === 8))
  intelligenceService(w, 2).agreements.push({ offer: structuredClone(state.offers[0]), month: 0 })
  const context = stateAgentContext(w, 2, true)
  assert(context.agreementReferences.some((entry) => entry.id === 8 && entry.reference === '[[agreement:8]]'))
  assert(!context.agreementReferences.some((entry) => entry.id === 21))
  render('Public agreement #8 and [[agreement:21]].', state.offers, 2, true)
  assert.equal(JSON.stringify(state.offers), before)
  validateWorld(w)
  const many = Array.from({ length: 180 }, (_, i) => offer(i + 1, `Past source ${i + 1}`, { month: i }))
  const catalog = agreementReferenceIndex(many, ['Inherited commitment in [[agreement:1]].'])
  assert(catalog.some((entry) => entry.id === 1))
  assert(catalog.length <= 120)
})
