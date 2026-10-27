import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { advanceAlmanac, queryPlaces, writingContext, acceptWriting, placeLabels } from '../src/sim/almanac'
import { recordWorldEvent } from '../src/sim/event-memory'
import { restoreWorld } from '../src/sim/persistence'
import { canonicalHash } from './fixtures/world-hash'
import { validateAlmanac } from '../src/sim/almanac-persistence'

const world = () => generateWorld('Atlas qualification', 2, 4, undefined, 'regional')
test('geographic identities are seeded, connected, stable and never consume simulation randomness', () => {
  const w = world(),
    a = structuredClone(w.almanac),
    rng = w.rng
  const rivers = Object.values(w.almanac!.entries).filter((p) => p.kind === 'river')
  assert.ok(rivers.length > 0)
  assert.ok(Object.values(w.almanac!.entries).some((p) => p.kind === 'peak'))
  for (const river of rivers)
    for (let i = 1; i < river.geometry!.length; i++)
      assert.equal(w.cells[river.geometry![i - 1]].downstream, river.geometry![i])
  advanceAlmanac(w)
  assert.deepEqual(w.almanac, a)
  assert.equal(w.rng, rng)
  assert.deepEqual(world().almanac, a)
  const hash = canonicalHash(w)
  queryPlaces(w, { id: 1, search: 'river' })
  placeLabels(w)
  assert.equal(canonicalHash(w), hash)
})
test('the permanent archive survives recent-feed eviction and save/restore', () => {
  const w = world()
  for (let i = 0; i < 300; i++)
    recordWorldEvent(w, {
      id: w.nextEvent++,
      month: w.month,
      type: 'economy',
      title: `Local development ${i}`,
      detail: 'Recorded production changed.',
      region: 0,
      nation: 0,
    })
  assert.equal(w.events.length, 240)
  assert.ok(Object.values(w.almanac!.facts).some((f) => f.title === 'Local development 0'))
  const restored = restoreWorld(JSON.parse(JSON.stringify(w)))
  assert.deepEqual(restored.almanac, w.almanac)
  const result = queryPlaces(restored, { id: 2, place: 'province:0' })
  assert.ok(result.facts.some((f) => f.title === 'Local development 0'))
})
test('accepted names are atomic, preserve aliases and cannot change populations or random streams', () => {
  const w = world(),
    context = writingContext(w, { id: 'test', task: 'naming', place: 'province:0' }),
    target = context.targets[0]
  const rng = w.rng,
    counts = w.regions.map((r) => r.population),
    original = w.almanac!.entries[target.id].name
  const response = {
    names: [{ id: target.id, name: 'Veloran', reason: 'A local linguistic form.', alternatives: ['Velora'] }],
  }
  acceptWriting(w, context, response, 'test/model')
  assert.equal(w.almanac!.entries[target.id].name, 'Veloran')
  assert.ok(w.almanac!.entries[target.id].names.some((n) => n.name === original))
  assert.deepEqual(
    w.regions.map((r) => r.population),
    counts,
  )
  assert.equal(w.rng, rng)
  const before = canonicalHash(w)
  assert.throws(() =>
    acceptWriting(
      w,
      context,
      {
        names: [
          response.names[0],
          { id: 'province:999999', name: 'Unknown', reason: 'test', alternatives: [] },
        ],
      },
      'test/model',
    ),
  )
  assert.equal(canonicalHash(w), before)
  validateAlmanac(w, w.almanac)
})
test('accounts require existing evidence; traditions remain separate and old accounts retain their date', () => {
  const w = world()
  recordWorldEvent(w, {
    id: w.nextEvent++,
    month: 0,
    type: 'economy',
    title: 'A workshop opened',
    detail: 'An existing firm opened a workshop.',
    region: 0,
  })
  const context = writingContext(w, { id: 'read', task: 'biography', place: 'province:0' }),
    before = canonicalHash(w)
  assert.throws(() =>
    acceptWriting(
      w,
      context,
      { title: 'A past', text: 'Invented evidence.', sources: ['event:999999'] },
      'test/model',
    ),
  )
  assert.equal(canonicalHash(w), before)
  w.month = 12
  acceptWriting(
    w,
    context,
    {
      title: 'A workshop district',
      text: 'The local record describes a workshop opening.',
      sources: [context.facts[0].id],
    },
    'test/model',
  )
  assert.equal(w.almanac!.entries['province:0'].accounts[0].asOf, 0)
  const tradition = writingContext(w, { id: 'story', task: 'tradition', place: 'province:0' })
  acceptWriting(
    w,
    tradition,
    {
      title: 'The patient river',
      text: 'One local tale imagines a river that waits for the harvest.',
      sources: [],
    },
    'test/model',
  )
  assert.equal(w.almanac!.entries['province:0'].accounts[1].status, 'tradition')
  validateAlmanac(w, w.almanac)
  w.almanac!.entries['province:0'].accounts[0].sources = ['missing']
  assert.throws(() => validateAlmanac(w, w.almanac))
})
test('language vocabularies persist and imports reject malformed references', () => {
  const w = world(),
    context = writingContext(w, { id: 'culture', task: 'culture', place: 'province:0' })
  acceptWriting(
    w,
    context,
    {
      roots: ['Ari', 'Bel', 'Cor', 'Dun'],
      endings: ['a', 'en', 'is'],
      convention: 'Local roots preserve river names.',
      demonym: '-an',
    },
    'test/model',
  )
  assert.equal(w.almanac!.languages[context.place.language].model, 'test/model')
  validateAlmanac(w, w.almanac)
  w.almanac!.entries['province:0'].cell = w.cells.length + 1
  assert.throws(() => restoreWorld(w))
})
