import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { StringTable } from '../src/map/string-table'
import { generateWorld } from '../src/sim/generate'
import { buildGeometry } from '../src/map/geometry'
import { freightOverlay } from '../src/map/trade'
import { CELL_SIZE } from '../src/sim/grid'

// Square-grid fingerprints are independently checked against exact land area.
test('bounded map lookups retain exact coastline geometry and freight traversal order', () => {
  const world = generateWorld('Display allocation fidelity', 3, 8, undefined, 'regional')
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  const geometry = buildGeometry(world.cells, world.width, world.height, world.regions.length)
  const area = geometry.coast.reduce(
    (sum, ring) =>
      sum +
      ring.reduce((total, p, i) => {
        const next = ring[(i + 1) % ring.length]
        return total + p.x * next.y - next.x * p.y
      }, 0) /
        2,
    0,
  )
  assert.equal(area, world.cells.filter((c) => c.terrain !== 'water').length * CELL_SIZE ** 2)
  assert.equal(hash(geometry), '147d36bb0a9d4da90fc4103c26743335d282656d1274aa6b5ddf5e5ccfdd00ae')
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
