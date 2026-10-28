import test from 'node:test'
import assert from 'node:assert/strict'
import { urbanMetrics } from '../src/sim/urban-metrics'
import { urbanFixture, URBAN_SCENARIOS } from './fixtures/urban-evolution'

for (const scenario of URBAN_SCENARIOS)
  test(`urban baseline: ${scenario} is reproducible and read-only`, () => {
    const { w } = urbanFixture(scenario)
    const before = JSON.stringify(w)
    const first = urbanMetrics(w)
    assert.deepEqual(first, urbanMetrics(urbanFixture(scenario).w))
    assert.equal(first.residents, 96)
    assert.equal(first.capacity, 192)
    assert.equal(first.buildings, 24)
    assert.equal(first.footprintArea, 8640)
    assert.equal(JSON.stringify(w), before)
  })
