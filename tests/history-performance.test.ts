/** Deterministic work/space contracts avoid flaky wall-clock limits on busy developer machines. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { recordWorldArchive, queryWorldArchive } from '../src/sim/world-archive'
import { packWorldSave } from '../src/sim/save-codec'

test('a century of stable ownership stores sparse changes and bounded reconstruction checkpoints', (t) => {
  const w = generateWorld('century-archive', 3, 8)
  const begin = performance.now()
  for (let month = 0; month < 1200; month++) {
    w.month = month
    recordWorldArchive(w)
  }
  const captureMs = performance.now() - begin
  const a = w.archive!
  assert.equal(a.frames.length, 1200)
  assert.equal(
    a.frames.reduce((n, f) => n + f.provinces.length, 0),
    w.regions.length * 10,
  )
  assert.equal(a.frames.filter((f) => f.checkpoint).length, 10)
  const first = JSON.stringify(a.frames[0]),
    queryStart = performance.now()
  for (let month = 0; month < 1200; month += 7) {
    const result = queryWorldArchive(w, { id: month, month })
    assert.equal(result.provinces.length, w.regions.length)
    assert.equal(result.provinces[0].nation, w.regions[0].nation)
  }
  assert.equal(JSON.stringify(a.frames[0]), first)
  const bytes = JSON.stringify(packWorldSave(w)).length
  assert(bytes < 30 * 1024 * 1024, 'The synthetic century must stay within a bounded portable save.')
  t.diagnostic(
    JSON.stringify({ months: 1200, captureMs, queryMs: performance.now() - queryStart, encodedBytes: bytes }),
  )
})
