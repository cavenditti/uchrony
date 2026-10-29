import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { defaultModelSettings } from '../src/sim/model-tasks'
import type { WorkerRequest, WorkerResponse } from '../src/sim/types'

test('worker history queries are isolated from live snapshots, errors and simulation time', async (t) => {
  const messages: WorkerResponse[] = []
  const worker = {
    onmessage: (_message: { data: WorkerRequest }) => {},
    postMessage: (message: WorkerResponse) => {
      messages.push(message)
      if (message.type === 'world')
        worker.onmessage({ data: { type: 'snapshot-ack', mapKey: message.mapKey } })
    },
  }
  const descriptors = ['self', 'EventSource'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )
  Object.defineProperty(globalThis, 'self', { value: worker, configurable: true })
  Object.defineProperty(globalThis, 'EventSource', {
    value: class extends EventTarget {},
    configurable: true,
  })
  t.after(() => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  t.mock.method(globalThis, 'setInterval', (() => 0) as typeof setInterval)
  const policy = {
    instance: 'archive-test',
    enabled: false,
    forcedOff: true,
    generation: 1,
    dispatched: 0,
    cancelled: 0,
    active: 0,
  }
  t.mock.method(globalThis, 'fetch', (async () =>
    Response.json({
      configured: false,
      policy,
      writing: { ...defaultModelSettings(), backgroundWriting: false },
    })) as typeof fetch)
  await import('../src/sim/worker')
  await worker.onmessage({ data: { type: 'archive', query: { id: 1, month: 0 } } })
  assert(messages.some((m) => m.type === 'archive-error' && m.request === 1))
  const world = generateWorld('archive-worker')
  world.month = 36
  await worker.onmessage({ data: { type: 'load', world } })
  const snapshots = messages.filter((m) => m.type === 'world')
  assert.equal(snapshots.at(-1)?.world.archive, undefined)
  assert.equal(snapshots.at(-1)?.world.month, 36)
  await worker.onmessage({ data: { type: 'archive', query: { id: 2, month: 0 } } })
  await worker.onmessage({ data: { type: 'archive', query: { id: 3, month: 36 } } })
  const archive = messages.find((m) => m.type === 'archive' && m.result.request === 3)
  assert(archive?.type === 'archive')
  assert.equal(archive.result.since, 36)
  assert.equal(archive.result.month, 36)
  assert.equal(archive.mapKey, snapshots.at(-1)?.mapKey)
  assert.equal(messages.filter((m) => m.type === 'world').length, snapshots.length)
  assert(!messages.some((m) => m.type === 'error'))
})
