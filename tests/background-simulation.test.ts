import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import type { WorkerRequest, WorkerResponse } from '../src/sim/types'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
test('pending external requests never gate months, local events or worker playback; speed does not flood requests', async (t) => {
  let configured = true
  const requests: string[] = [],
    snapshots: { month: number; local: number }[] = [],
    errors: string[] = []
  const worker = {
    onmessage: (_message: { data: WorkerRequest }) => {},
    postMessage: (message: WorkerResponse) => {
      if (message.type === 'world')
        snapshots.push({
          month: message.world.month,
          local: message.world.events.filter((event) => event.historical?.source === 'procedural').length,
        })
      if (message.type === 'error') errors.push(message.message)
    },
  }
  const originalSelf = Object.getOwnPropertyDescriptor(globalThis, 'self')
  Object.defineProperty(globalThis, 'self', { value: worker, configurable: true })
  t.mock.method(globalThis, 'setInterval', (() => 0) as typeof setInterval)
  t.mock.method(globalThis, 'fetch', (async (url: string, options?: RequestInit) => {
    if (url === '/api/history/status') return new Response(JSON.stringify({ configured }))
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
    send({ type: 'step', count: 3 })
    assert(requests.length > 0, 'at least one real scheduler request is outstanding')
    send({ type: 'step', count: 12 })
    send({ type: 'step', count: 12 })
    assert.equal(snapshots.at(-1)?.month, 27)
    assert(snapshots.at(-1)!.local > 0)
    assert.equal(requests.length, 1, 'fast months cannot bypass the wall-time request budget')
    send({ type: 'playback', running: true, speed: 60 })
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
    if (originalSelf) Object.defineProperty(globalThis, 'self', originalSelf)
    else Reflect.deleteProperty(globalThis, 'self')
  }
})
