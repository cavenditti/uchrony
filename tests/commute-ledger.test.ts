/** Compact rows are the sole payroll representation, shared by save and view queries. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { recordCommute, commuteFlows, commutesAt } from '../src/sim/commute-ledger'
import type { World } from '../src/sim/types'

function fixture() {
  return {
    adaptive: { commuteRoutes: { road: { cells: [0, 1], minutes: 12, mode: 'road' } } },
  } as unknown as World
}

test('commute rows aggregate paid workers and wages by residence, firm and stratum', () => {
  const w = fixture()
  recordCommute(w, 7, 3, 'road', 'laborer', 2.5, 5)
  recordCommute(w, 7, 3, 'road', 'laborer', 0.5, 2)
  recordCommute(w, 7, 3, 'road', 'artisan', 1, 4)
  recordCommute(w, 8, 3, 'road', 'laborer', 2, 3)
  assert.equal(w.adaptive!.commutingRows!.length, 2)
  const flows = [...commuteFlows(w)]
  assert.deepEqual(
    flows.map((f) => [f.residence, f.stratum, f.workers, f.wage]),
    [
      [7, 'laborer', 3, 7],
      [7, 'artisan', 1, 4],
      [8, 'laborer', 2, 3],
    ],
  )
  assert(
    flows.every(
      (f) => f.workplace === 'firm:3' && f.route === 'road' && f.minutes === 12 && f.mode === 'road',
    ),
  )
  assert.deepEqual(
    commutesAt(w, 7),
    flows.filter((f) => f.residence === 7),
  )
  assert.deepEqual(commutesAt(w, 99), [])
})

test('restored rows expand without a second stored flow representation', () => {
  const w = fixture()
  recordCommute(w, 7, 3, 'road', 'laborer', 2, 3)
  const restored = JSON.parse(JSON.stringify(w)) as World
  assert.deepEqual([...commuteFlows(restored)], [...commuteFlows(w)])
  assert.deepEqual(commutesAt(restored, 7), commutesAt(w, 7))
  recordCommute(w, 7, 3, 'road', 'laborer', 0, 10)
  assert.equal(w.adaptive!.commutingRows![0][4], 2)
  assert.deepEqual([...commuteFlows({} as World)], [])
})
