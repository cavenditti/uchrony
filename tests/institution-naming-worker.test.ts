import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { defaultModelSettings } from '../src/sim/model-tasks'
import { applyInstitutionTerm } from '../src/sim/institutions'
import { reconcileInstitutions } from '../src/sim/institution-lifecycle'
import { ensureStatecraft } from '../src/sim/statecraft'
import { ensureHistory } from '../src/sim/history'
import { relation, type WorkerRequest, type WorkerResponse } from '../src/sim/types'
import type { DiplomaticOffer } from '../src/sim/statecraft-types'
import type { InstitutionNamingContext } from '../src/sim/institution-naming'

test('production worker schedules event-driven names with the writing budget and permission barrier', async (t) => {
  const messages: WorkerResponse[] = [],
    requests: { url: string; context: InstitutionNamingContext }[] = []
  const worker = {
    onmessage: async (_message: { data: WorkerRequest }) => {},
    postMessage(message: WorkerResponse) {
      messages.push(structuredClone(message))
      if (message.type === 'world')
        void worker.onmessage({ data: { type: 'snapshot-ack', mapKey: message.mapKey } })
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
    for (const [key, descriptor] of descriptors)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
  })
  let now = 100000,
    poll = () => {},
    publish = () => {}
  t.mock.method(Date, 'now', () => now)
  t.mock.method(globalThis, 'setInterval', ((callback: () => void) => {
    poll = callback
    return 0
  }) as typeof setInterval)
  t.mock.method(globalThis, 'setTimeout', ((callback: () => void) => {
    publish = callback
    return 0
  }) as typeof setTimeout)
  const policy = {
    instance: 'naming-test',
    enabled: true,
    forcedOff: false,
    generation: 1,
    dispatched: 0,
    cancelled: 0,
    active: 0,
  }
  const writing = defaultModelSettings()
  writing.backgroundWriting = false
  let complete: ((response: Response) => void) | undefined
  t.mock.method(globalThis, 'fetch', (async (input, init) => {
    const url = String(input)
    if (url === '/api/history/status') return Response.json({ configured: true, policy, writing })
    if (url === '/api/history/policy') return Response.json(policy)
    const body = JSON.parse(String(init?.body))
    requests.push({ url, context: body.context })
    return new Promise<Response>((resolve) => {
      complete = resolve
    })
  }) as typeof fetch)
  const flush = async () => {
    for (let i = 0; i < 8; i++) await new Promise<void>((resolve) => setImmediate(resolve))
  }
  await import('../src/sim/worker')
  const w = generateWorld('institution-worker')
  // Keep this integration fixture focused on background writing, without unrelated government calls.
  for (const agent of ensureStatecraft(w).agents) {
    agent.lastDecision = 0
    agent.nextDecision = w.month + 12
  }
  ensureHistory(w).opportunity = null
  applyInstitutionTerm(
    w,
    {
      kind: 'institution',
      from: 0,
      to: -1,
      amount: 0,
      good: '',
      field: '',
      regions: [],
      duration: 0,
      text: `League of ${w.nations[0].shortName}, ${w.nations[1].shortName}, ${w.nations[2].shortName}`,
      charter: {
        operation: 'found',
        id: 0,
        form: 'defense-league',
        powers: ['defense'],
        rule: 'majority',
        contribution: 0.02,
        exit: 'free',
      },
    },
    { id: 1, parties: [0, 1, 2], visibility: 'public' } as DiplomaticOffer,
  )
  Object.assign(relation(w, 0, 1)!, { treaty: 'war', aggressor: 0, since: 0 })
  reconcileInstitutions(w)
  w.month = 6
  reconcileInstitutions(w)
  await worker.onmessage({ data: { type: 'load', world: w } })
  await flush()
  assert.deepEqual(
    messages.filter((m) => m.type === 'error'),
    [],
  )
  assert.equal(requests.length, 0, 'background writing disabled')
  writing.backgroundWriting = true
  policy.enabled = false
  await worker.onmessage({ data: { type: 'models-changed' } })
  await flush()
  assert.equal(requests.length, 0, 'global LLM switch disabled')
  policy.enabled = true
  await worker.onmessage({ data: { type: 'models-changed' } })
  await flush()
  assert.equal(
    requests.length,
    1,
    JSON.stringify(messages.filter((m) => m.type === 'storyteller' || m.type === 'error')),
  )
  assert.equal(requests[0].url, '/api/history/write/naming')
  const context = requests[0].context
  assert.equal(context.kind, 'institution-naming')
  assert.deepEqual(
    context.targets[0].members.map((n) => n.id),
    [1, 2],
  )
  now += 1000
  poll()
  assert.equal(requests.length, 1, 'one in-flight batch')
  complete!(
    Response.json({
      proposal: {
        names: [
          {
            id: context.targets[0].id,
            name: 'Concord of the Open Hand',
            reason: 'The remaining members renew their common defense.',
            alternatives: [],
          },
        ],
      },
      model: 'test/light',
      policyGeneration: policy.generation,
      policyInstance: policy.instance,
    }),
  )
  await flush()
  publish()
  const latest = messages.filter((m) => m.type === 'world').at(-1)!
  assert.equal(latest.world.institutions!.organizations[0].name, 'Concord of the Open Hand')
  assert.equal(latest.world.modelProvenance!.roles.naming, 1)
  poll()
  assert.equal(requests.length, 1, 'the background cadence prevents another immediate call')
  assert(!messages.some((m) => m.type === 'error'))
})
