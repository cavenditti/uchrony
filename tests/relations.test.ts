import test from 'node:test'
import assert from 'node:assert/strict'
import { relation, type Relation, type World } from '../src/sim/types'

const record = (a: number, b: number): Relation => ({
  a,
  b,
  opinion: 0,
  treaty: 'neutral',
  since: 0,
  warExhaustion: 0,
  grievance: 0,
})
test('relation indexing preserves live treaty edits, appended states, array replacement and reordering', () => {
  const w = { relations: [record(0, 1), record(0, 2), record(1, 2)] } as World
  assert.equal(relation(w, 1, 0), w.relations[0])
  w.relations[0].treaty = 'war'
  assert.equal(relation(w, 0, 1)?.treaty, 'war')
  w.relations[0] = { ...record(0, 1), treaty: 'trade' }
  assert.equal(relation(w, 1, 0)?.treaty, 'trade')
  w.relations.push(record(0, 3))
  assert.equal(relation(w, 3, 0), w.relations[3])
  w.relations.reverse()
  assert.equal(relation(w, 0, 1), w.relations[3])
  w.relations.splice(1, 1)
  assert.equal(relation(w, 2, 1), undefined)
  w.relations[0] = record(2, 3)
  assert.equal(relation(w, 0, 3), undefined)
  assert.equal(relation(w, 3, 2), w.relations[0])
  w.relations = structuredClone(w.relations)
  assert.equal(relation(w, 0, 1), w.relations[2])
})
