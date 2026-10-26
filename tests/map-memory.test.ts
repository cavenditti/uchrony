import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { StringTable } from '../src/map/string-table'
import { generateWorld } from '../src/sim/generate'
import { buildGeometry } from '../src/map/geometry'
import { freightOverlay } from '../src/map/trade'

// Regression fingerprints were captured from the pre-allocation-change renderer.
test('bounded map lookups retain exact coastline geometry and freight traversal order', () => {
  const world = generateWorld('Display allocation fidelity', 3, 8, undefined, 'regional')
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  assert.equal(
    hash(buildGeometry(world.cells, world.width, world.height, world.regions.length)),
    'b7845fbe1a65b8b05a8e4a25a363f6ce581659eda875d609016fd523d7c38a8c',
  )
  assert.equal(
    hash(freightOverlay(world, 0, null)),
    '90d8011b89c1ced2f32adec0ca7389d68cd7711081dc71bc6dd94278503dc88f',
  )
})

test('sharded string lookups preserve insertion order through replacement and deletion at atlas scale', () => {
  const actual = new StringTable<number>(),
    expected = new Map<string, number>()
  for (let i = 0; i < 260000; i++) {
    const key = `${i % 2048}:${Math.floor(i / 2048)}`
    actual.set(key, i)
    expected.set(key, i)
  }
  for (let i = 0; i < 260000; i += 19) {
    const key = `${i % 2048}:${Math.floor(i / 2048)}`
    assert.equal(actual.delete(key), expected.delete(key))
    actual.set(key, -i)
    expected.set(key, -i)
  }
  actual.set('0:0', 42)
  expected.set('0:0', 42)
  assert.equal(actual.size, expected.size)
  assert.deepEqual([...actual.values()], [...expected.values()])
  for (const [key, value] of expected) assert.equal(actual.get(key), value)
  const shards = (actual as unknown as { shards: Map<string, unknown>[] }).shards
  assert(Math.max(...shards.map((shard) => shard.size)) < 5000)
  actual.clear()
  assert.equal(actual.size, 0)
  assert.equal(actual.has('0:0'), false)
  assert.deepEqual([...actual.values()], [])
})
