import test from 'node:test'
import assert from 'node:assert/strict'
import { Playback } from '../src/sim/playback'

test('worker clock targets the selected pace without waiting for rendering or a model', (t) => {
  let now = 0,
    months = 0,
    paints = 0
  t.mock.method(performance, 'now', () => now)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const clock = new Playback(
    () => {
      months++
    },
    () => {
      paints++
    },
    (error) => {
      throw error
    },
  )
  clock.start(60)
  for (let i = 0; i < 100; i++) {
    now += 10
    t.mock.timers.tick(10)
  }
  assert(months >= 59 && months <= 60, String(months))
  assert(paints <= 2, 'world snapshots must be coalesced')
  clock.stop()
  now += 1000
  t.mock.timers.tick(1000)
  assert(months <= 60, 'pause cancels the next slice')
  clock.start(1)
  now += 1000
  t.mock.timers.tick(1000)
  assert(months >= 60 && months <= 61)
  clock.stop()
})

test('an expensive month yields so controls and asynchronous completions can run', (t) => {
  let now = 0,
    months = 0
  t.mock.method(performance, 'now', () => now)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const clock = new Playback(
    () => {
      months++
      now += 80
    },
    () => {},
    (error) => {
      throw error
    },
  )
  clock.start(60)
  now = 20
  t.mock.timers.tick(20)
  assert.equal(months, 1, 'the worker must yield after an expensive tick')
  clock.stop()
  now += 1000
  t.mock.timers.tick(1000)
  assert.equal(months, 1)
})

test('fatal local simulation errors stop playback and report the actual error', (t) => {
  let now = 0,
    failure: unknown
  t.mock.method(performance, 'now', () => now)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const expected = new Error('ledger failure')
  const clock = new Playback(
    () => {
      throw expected
    },
    () => {},
    (error) => {
      failure = error
    },
  )
  clock.start(12)
  now = 100
  t.mock.timers.tick(100)
  assert.equal(failure, expected)
  clock.stop()
})

test('Max has no pacing cap, publishes completed intervals and yields to pause', (t) => {
  let now = 0,
    months = 0,
    paints = 0
  t.mock.method(performance, 'now', () => now)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const clock = new Playback(
    (speed) => {
      assert.equal(speed, 'max')
      months++
      now += 2
      return months % 6 === 0
    },
    () => {
      paints++
      assert.equal(months % 6, 0)
    },
    (error) => {
      throw error
    },
  )
  clock.start('max')
  t.mock.timers.tick(1)
  assert.equal(months, 4, 'eight milliseconds of work yields before the interval ends')
  assert.equal(paints, 0)
  t.mock.timers.tick(1)
  assert.equal(months, 6)
  assert.equal(paints, 1)
  clock.stop()
  t.mock.timers.tick(1000)
  assert.equal(months, 6)
})

test('changing from Max to normal cancels the old clock and restores normal pacing', (t) => {
  let now = 0
  const speeds: unknown[] = []
  t.mock.method(performance, 'now', () => now)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const clock = new Playback(
    (speed) => {
      speeds.push(speed)
    },
    () => {},
    (e) => {
      throw e
    },
  )
  clock.start('max')
  clock.start(1)
  now = 999
  t.mock.timers.tick(999)
  assert.deepEqual(speeds, [])
  now = 1000
  t.mock.timers.tick(1)
  assert.deepEqual(speeds, [1])
  clock.stop()
})
