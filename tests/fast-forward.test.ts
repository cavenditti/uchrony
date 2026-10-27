import test from 'node:test'
import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'
import { generateWorld } from '../src/sim/generate'
import { prepareSpatialWorld, tick } from '../src/sim/engine'
import { fastForwardMonth } from '../src/sim/fast-forward'
import { validateWorld, restoreWorld } from '../src/sim/persistence'
import { auditLedger } from '../src/sim/ledger'
import { auditBanks } from '../src/sim/banking'
import { auditGoods } from '../src/sim/goods-accounting'
import { population, type World } from '../src/sim/types'
import { packWorldSave } from '../src/sim/save-codec'

function check(w: World) {
  validateWorld(w)
  auditLedger(w)
  auditBanks(w)
  auditGoods(w)
  const census =
    w.regions.reduce((sum, r) => sum + population(r), 0) +
    [...w.armies, ...(w.warfare?.fleets ?? [])].reduce((sum, force) => sum + force.soldiers, 0)
  assert.equal(w.totals.population, census)
  for (const pools of Object.values(w.economy!.households))
    for (const h of Object.values(pools))
      assert(h.employed <= h.laborForce + 1e-6, 'a worker cannot hold more than one paid FTE')
}

test('six-month approximation keeps monthly stock/flow and census invariants and survives save/resume', () => {
  const w = generateWorld('fast-forward-ledgers', 3, 4, undefined, 'regional')
  prepareSpatialWorld(w)
  for (let i = 1; i <= 3; i++) {
    assert.equal(fastForwardMonth(w), false)
    assert.equal(w.month, i)
    check(w)
  }
  const resumed = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(w))))
  for (let i = 4; i <= 12; i++) {
    assert.equal(fastForwardMonth(w), i % 6 === 0)
    fastForwardMonth(resumed)
    assert(
      isDeepStrictEqual(JSON.parse(JSON.stringify(w)), JSON.parse(JSON.stringify(resumed))),
      `complete saved-state continuation at month ${i}`,
    )
    check(w)
  }
  assert.deepEqual(w.fastForward, { months: 12, lastMonth: 12, phase: 0 })
  tick(w)
  assert.equal(w.month, 13)
  assert.equal(w.fastForward?.lastMonth, 12, 'returning to monthly play retains approximation provenance')
  check(w)
})

test('returning to monthly play reconciles an incomplete interval on the next month', () => {
  const w = generateWorld('fast-forward-pause', 3, 4, undefined, 'regional', 'frontier')
  fastForwardMonth(w)
  fastForwardMonth(w)
  assert.equal(w.month, 2)
  assert.equal(w.fastForward?.phase, 2)
  check(w)
  tick(w)
  assert.equal(w.month, 3)
  assert.deepEqual(w.fastForward, { months: 2, lastMonth: 2, phase: 0 })
  check(w)
  assert.throws(() => validateWorld({ ...w, fastForward: { ...w.fastForward, phase: 6 } }), /provenance/)
  assert.throws(() => validateWorld({ ...w, fastForward: { ...w.fastForward, months: 100 } }), /provenance/)
  assert.throws(() => validateWorld({ ...w, fastForward: { ...w.fastForward, phase: 1 } }), /provenance/)
})
