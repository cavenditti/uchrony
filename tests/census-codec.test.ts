import { encodeSaveBlock, decodeSaveBlock, packWorldSave } from '../src/sim/save-codec'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { encodeCohorts, decodeCohorts, packWorldCensus } from '../src/sim/census-codec'
import { generateWorld } from '../src/sim/generate'
import { tick } from '../src/sim/engine'
import { parseSave, restoreWorld } from '../src/sim/persistence'
import { worldBlob } from '../src/storage/json-blob'
import { DiskAutosaves } from '../server/autosave'
import { createHash } from 'node:crypto'
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

test('dated census encoding is exact for signed dates, large counts, empty lists and sparse bins', () => {
  for (const bins of [
    [],
    [
      [-100000, 0, 1000000000],
      [500, 1, 0],
      [-5, 129, 8192],
    ],
    Array.from({ length: 2641 }, (_, i) => [i - 2640, i % 17, Math.floor(i / 9)]),
  ] as [number, number, number][][])
    assert.deepEqual(decodeCohorts(encodeCohorts(bins)), bins)
  for (const data of ['wrong', 'cohorts-v1:AAAB', 'cohorts-v1:////', 'cohorts-v1:'])
    assert.throws(() => decodeCohorts(data))
  assert.throws(() => encodeCohorts([[0, -1, 0]]))
})

test('packed district exports and disk checkpoints restore an identical continuation', async () => {
  const w = generateWorld('Lossless local census')
  tick(w)
  tick(w)
  const before = digest(w),
    blob = worldBlob(w),
    text = await blob.text()
  assert(text.includes('district-blocks-v2'))
  assert(blob.size < Buffer.byteLength(JSON.stringify(w)) * 0.8)
  assert.equal(digest(w), before)
  const restored = parseSave(text)
  assert.equal(digest(restored), before)
  const directory = await mkdtemp(join(tmpdir(), 'uchrony-packed-')),
    store = new DiskAutosaves(directory),
    slot = '6f290813-8285-4bf0-bc84-97e5b781bf73'
  try {
    await store.write(slot, { version: 1, savedAt: Date.now(), world: w })
    const disk = (await store.read(slot)).save!.world
    assert.equal(digest(disk), before)
    tick(w)
    tick(restored)
    tick(disk)
    assert.equal(digest(restored), digest(w))
    assert.equal(digest(disk), digest(w))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
  const bad = packWorldCensus(w) as any
  const group = bad.regions[0].communities[0],
    keys = bad.censusEncoding.schemas[group[0]]
  group[keys.indexOf('ageCohorts') + 1] = 'cohorts-v1:AAAB'
  assert.throws(() => restoreWorld(bad))
})

test('bounded economic tables retain all records and key order, read v1 saves and reject forged tables', () => {
  const w = generateWorld('Bounded economic serialization')
  tick(w)
  const expected = digest(w),
    packed = packWorldSave(w) as any
  assert.equal(packed.worldEncoding, 'district-blocks-v2')
  assert(packed.economy.fields.households.blocks.length > 1)
  for (const block of packed.economy.fields.households.blocks)
    assert((decodeSaveBlock(block) as unknown[]).length <= 256)
  assert.equal(digest(restoreWorld(JSON.parse(JSON.stringify(packed)))), expected)
  const old = {
    ...packed,
    worldEncoding: 'district-blocks-v1',
    economy: encodeSaveBlock(w.economy),
    localEconomy: encodeSaveBlock(w.localEconomy),
  }
  assert.equal(digest(restoreWorld(JSON.parse(JSON.stringify(old)))), expected)
  const duplicate = structuredClone(packed)
  duplicate.economy.fields.households.blocks.push(duplicate.economy.fields.households.blocks[0])
  assert.throws(() => restoreWorld(duplicate), /record identities/)
  const missing = structuredClone(packed)
  missing.economy.keys.pop()
  assert.throws(() => restoreWorld(missing), /key order/)
  const oversized = structuredClone(packed)
  oversized.localEconomy.fields.units.blocks[0].bytes = 2 ** 40
  assert.throws(() => restoreWorld(oversized), /expansion/)
  const inherited = structuredClone(packed)
  inherited.economy.fields.constructor = inherited.economy.fields.households
  assert.throws(() => restoreWorld(inherited), /economic save field/)
  assert.equal(digest(w), expected)
})

test('compressed save blocks reject truncation, corrupt bytes and unsafe expansion lengths', () => {
  const value = { note: 'same values '.repeat(100), integers: [0, 1, 1000000] },
    block = encodeSaveBlock(value)
  assert.deepEqual(decodeSaveBlock(block), value)
  assert.throws(() => decodeSaveBlock({ ...block, bytes: block.bytes + 1 }))
  assert.throws(() => decodeSaveBlock({ ...block, bytes: 2 ** 40 }))
  assert.throws(() => decodeSaveBlock({ ...block, data: block.data.slice(0, -8) }))
  const bytes = Buffer.from(block.data, 'base64')
  bytes[bytes.length - 8] ^= 1
  assert.throws(() => decodeSaveBlock({ ...block, data: bytes.toString('base64') }), /checksum/)
})
