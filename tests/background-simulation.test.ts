import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { defaultModelSettings } from '../src/sim/model-tasks'
import type { WorkerRequest, WorkerResponse } from '../src/sim/types'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
test('pending external requests never gate months, local events or worker playback; speed does not flood requests', async (t) => {
  // Test scheduler wall time independently of simulation CPU speed and concurrent test load.
  const wallTime = Date.now()
  t.mock.method(Date, 'now', () => wallTime)
  let configured = true
  const requests: string[] = [],
    snapshots: { month: number; local: number; terrain: boolean; mapKey: string }[] = [],
    errors: string[] = []
  const worker = {
    onmessage: (_message: { data: WorkerRequest }) => {},
    postMessage: (message: WorkerResponse): void => {
      if (message.type === 'world') {
        snapshots.push({
          month: message.world.month,
          terrain: !!message.world.cells,
          mapKey: message.mapKey,
          local: message.world.events.filter((event) => event.historical?.source === 'procedural').length,
        })
        worker.onmessage({ data: { type: 'snapshot-ack', mapKey: message.mapKey } })
      }
      if (message.type === 'error') errors.push(message.message)
    },
  }
  const originalSelf = Object.getOwnPropertyDescriptor(globalThis, 'self')
  Object.defineProperty(globalThis, 'self', { value: worker, configurable: true })
  const policy = {
    instance: 'background-test',
    enabled: true,
    forcedOff: false,
    generation: 1,
    dispatched: 0,
    cancelled: 0,
    active: 0,
  }
  const priorEvents = Object.getOwnPropertyDescriptor(globalThis, 'EventSource')
  Object.defineProperty(globalThis, 'EventSource', {
    configurable: true,
    // Match the event-listener API used for policy and model-setting updates.
    value: class extends EventTarget {
      onmessage = null
      onerror = null
    },
  })
  t.after(() => {
    if (priorEvents) Object.defineProperty(globalThis, 'EventSource', priorEvents)
    else Reflect.deleteProperty(globalThis, 'EventSource')
  })
  t.mock.method(globalThis, 'setInterval', (() => 0) as typeof setInterval)
  t.mock.method(globalThis, 'fetch', (async (url: string, options?: RequestInit) => {
    if (url === '/api/history/status')
      return Response.json({
        configured,
        policy: { ...policy, enabled: configured },
        writing: { ...defaultModelSettings(), backgroundWriting: false },
      })
    if (url === '/api/history/policy') return Response.json(policy)
    requests.push(url)
    return new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true })
    })
  }) as typeof fetch)
  const send = (data: WorkerRequest) => worker.onmessage({ data })
  try {
    await import('../src/sim/worker')
    send({ type: 'load', world: generateWorld('pending-models') })
    await wait(0)
    // Step messages await spatial-worker readiness, independently of model jobs.
    await send({ type: 'step', count: 3 })
    assert(requests.length > 0, 'at least one real scheduler request is outstanding')
    await send({ type: 'step', count: 12 })
    await send({ type: 'step', count: 12 })
    assert.equal(snapshots.at(-1)?.month, 27)
    assert(snapshots[0].terrain, 'initial world includes its terrain')
    assert(
      snapshots.slice(1).every((snapshot) => !snapshot.terrain),
      'monthly updates reuse immutable geography',
    )
    assert(snapshots.every((snapshot) => snapshot.mapKey === snapshots[0].mapKey))
    assert(snapshots.at(-1)!.local > 0)
    assert.equal(requests.length, 1, 'fast months cannot bypass the wall-time request budget')
    await send({ type: 'playback', running: true, speed: 60 })
    await wait(350)
    send({ type: 'playback', running: false, speed: 60 })
    const paused = snapshots.at(-1)!.month
    assert(paused > 27, 'automatic playback continues with the model promise unresolved')
    await wait(50)
    assert.equal(snapshots.at(-1)?.month, paused)
    assert.equal(requests.length, 1)
    assert.deepEqual(errors, [])
  } finally {
    send({ type: 'playback', running: false, speed: 60 })
    configured = false
    send({ type: 'load', world: generateWorld('cleanup') })
    await wait(0)
    assert(snapshots.at(-1)?.terrain, 'restoring another world sends its geography again')
    assert.notEqual(snapshots.at(-1)?.mapKey, snapshots[0].mapKey)
    if (originalSelf) Object.defineProperty(globalThis, 'self', originalSelf)
    else Reflect.deleteProperty(globalThis, 'self')
  }
})
