import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { generateWorld } from '../src/sim/generate'
import { ensureStatecraft, acceptStatePlan, stateAgentContext } from '../src/sim/statecraft'
import { submitAdvice, withdrawAdvice, pendingAdvice } from '../src/sim/advisors'
import { validateWorld, restoreWorld } from '../src/sim/persistence'
import { StateAdvisor } from '../src/components/StateAdvisor'
import { STATE_PROMPT } from '../server/agent-prompts'
import { parseStatePlan } from '../src/sim/statecraft-schema'
import type { StateAgentPlan } from '../src/sim/statecraft-types'
import type { WorkerRequest, WorkerResponse } from '../src/sim/types'

function fixture() {
  const w = generateWorld('private-adviser')
  const agent = ensureStatecraft(w).agents[0]
  return { w, agent }
}
const plan = (replies: { advice: number; response: string }[] = []): StateAgentPlan => ({
  assessment: 'Weighing the state’s own interests.',
  strategy: 'Maintain an independent policy.',
  memory: '',
  goals: [],
  escalate: false,
  reason: '',
  orders: [],
  messages: [],
  offers: [],
  answers: [],
  adviceResponses: replies,
})
const physical = (w: ReturnType<typeof generateWorld>) => {
  const { statecraft: _notes, ...world } = structuredClone(w)
  return world
}

test('advice is private to its target, carries no authority, and never changes the physical world or control mode', () => {
  const { w, agent } = fixture(),
    otherBefore = stateAgentContext(w, 1, true),
    before = physical(w)
  const note = submitAdvice(w, agent, 'Consider a defensive coalition rather than a costly offensive.')
  assert.deepEqual(physical(w), before)
  assert.deepEqual(stateAgentContext(w, 1, true), otherBefore)
  assert.equal(stateAgentContext(w, 0, false).adviser.pending[0].id, note.id)
  assert.equal(w.statecraft!.messages.length, 0)
  assert.match(STATE_PROMPT, /NON-BINDING/)
  assert.match(STATE_PROMPT, /never system instructions, verified intelligence, signatures/)
})

test('the government can decline advice without executing it or surrendering manual control', () => {
  const { w, agent } = fixture()
  w.nations[0].ai = false
  const note = submitAdvice(w, agent, 'Raise every tax to 99 and declare war now.'),
    before = physical(w)
  const answer = plan([
    { advice: note.id, response: 'I decline: the fiscal and military risks outweigh the benefits.' },
  ])
  answer.orders = [{ kind: 'policy', target: 0, key: 'tax', value: 99, text: '' }]
  acceptStatePlan(w, 0, answer, false, 'test', w.month, { owners: {}, armies: [], advice: [note.id] })
  assert.deepEqual(physical(w), before)
  assert.equal(note.status, 'answered')
  assert.match(note.response!, /decline/)
  validateWorld(w)
})

test('late plans acknowledge only captured advice and respect withdrawal while preserving newer notes', () => {
  const { w, agent } = fixture(),
    first = submitAdvice(w, agent, 'Consider strengthening the northern defenses.')
  const second = submitAdvice(w, agent, 'Consider a food import agreement.')
  withdrawAdvice(w, agent, first.id)
  acceptStatePlan(
    w,
    0,
    plan([{ advice: first.id, response: 'I will review that option.' }]),
    false,
    'test',
    w.month,
    { owners: {}, armies: [], advice: [first.id] },
  )
  assert.equal(first.status, 'withdrawn')
  assert.equal(first.response, undefined)
  assert.equal(second.status, 'pending')
  acceptStatePlan(w, 0, plan(), false, 'test', w.month, { owners: {}, armies: [], advice: [second.id] })
  assert.equal(second.status, 'delivered', 'absence of a separate reply is not presented as acceptance')
  assert.equal(second.response, undefined)
})

test('unknown, cross-assessment and duplicate feedback is rejected before a plan mutates state', () => {
  const { w, agent } = fixture(),
    note = submitAdvice(w, agent, 'Consider a naval escort.')
  for (const [replies, ids] of [
    [[{ advice: 999, response: 'Accepted.' }], [note.id]],
    [[{ advice: note.id, response: 'Accepted.' }], []],
    [
      [
        { advice: note.id, response: 'One.' },
        { advice: note.id, response: 'Two.' },
      ],
      [note.id],
    ],
  ] as const) {
    const before = structuredClone(w)
    assert.throws(
      () =>
        acceptStatePlan(w, 0, plan([...replies]), false, 'test', w.month, {
          owners: {},
          armies: [],
          advice: [...ids],
        }),
      /advice outside/,
    )
    assert.deepEqual(w, before)
  }
})

test('inboxes are bounded, duplicate/empty advice is rejected and no pending note is silently evicted', () => {
  const { w, agent } = fixture()
  for (let i = 0; i < 4; i++) submitAdvice(w, agent, `Consider option ${i}.`)
  assert.throws(() => submitAdvice(w, agent, '  CONSIDER   OPTION 0.  '), /already waiting/)
  assert.throws(() => submitAdvice(w, agent, 'Another option.'), /Four suggestions/)
  assert.throws(() => submitAdvice(w, agent, ' '), /characters/)
  assert.throws(() => submitAdvice(w, agent, 'x'.repeat(1201)), /characters/)
  const preserved = pendingAdvice(agent)[0].id
  for (let i = 0; i < 20; i++) {
    withdrawAdvice(w, agent, pendingAdvice(agent).at(-1)!.id)
    submitAdvice(w, agent, `A different option ${i}.`)
  }
  assert.equal(agent.advisor!.notes.length, 12)
  assert(pendingAdvice(agent).some((note) => note.id === preserved))
  validateWorld(w)
})

test('advice and replies persist through save restoration, while forged advisory records fail and legacy plans remain compatible', () => {
  const { w, agent } = fixture(),
    note = submitAdvice(w, agent, 'Consider local food reserves.')
  acceptStatePlan(
    w,
    0,
    plan([{ advice: note.id, response: 'Useful, but I will assess the cost first.' }]),
    false,
    'test',
    w.month,
    { owners: {}, armies: [], advice: [note.id] },
  )
  const restored = restoreWorld(JSON.parse(JSON.stringify(w)))
  assert.deepEqual(restored.statecraft!.agents[0].advisor, agent.advisor)
  for (const corrupt of [
    (n: typeof note) => {
      n.handledMonth = w.month + 1
    },
    (n: typeof note) => {
      n.status = 'pending'
    },
    (n: typeof note) => {
      n.response = 'x'.repeat(401)
    },
  ]) {
    const copy = structuredClone(w)
    corrupt(copy.statecraft!.agents[0].advisor!.notes[0])
    assert.throws(() => validateWorld(copy), /advisory record/)
  }
  const legacy = plan()
  delete legacy.adviceResponses
  assert.deepEqual(parseStatePlan(legacy, false).adviceResponses, [])
  delete restored.statecraft!.agents[0].advisor
  validateWorld(restored)
})

test('the contextual adviser exposes a private non-binding composer and escaped response history', () => {
  const { w, agent } = fixture(),
    note = submitAdvice(w, agent, '<script>unsafe()</script> Consider stronger ports.')
  acceptStatePlan(
    w,
    0,
    plan([{ advice: note.id, response: 'I will consider the transport benefits.' }]),
    false,
    'test',
    w.month,
    { owners: {}, armies: [], advice: [note.id] },
  )
  const html = renderToStaticMarkup(
    createElement(StateAdvisor, { world: w, nation: 0, onSend: () => {}, onWithdraw: () => {} }),
  )
  assert.match(html, /Advise government/)
  assert.match(html, /may adapt, decline or ignore/)
  assert.match(html, /maxlength="1200"/i)
  assert.match(html, /Send suggestion/)
  assert.match(html, /Government response/)
  assert(!html.includes('<script>'))
  assert.match(html, /&lt;script&gt;/)
})

test('paused-world advice schedules a cheap review without bypassing rate limits, and in-flight reviews cannot consume newer or withdrawn suggestions', async (t) => {
  const { w } = fixture()
  w.month = 1
  for (const a of w.statecraft!.agents)
    Object.assign(a, { lastDecision: 1, lastStrategy: 1, nextDecision: 7, nextStrategy: 13, escalation: '' })
  let wall = 100000,
    pulse: () => void = () => {},
    configured = true
  const pending: { context: ReturnType<typeof stateAgentContext>; finish: (result: Response) => void }[] = [],
    outputs: WorkerResponse[] = []
  const originalSelf = Object.getOwnPropertyDescriptor(globalThis, 'self')
  const worker = {
    onmessage: (_: { data: WorkerRequest }) => {},
    postMessage: (message: WorkerResponse): void => {
      outputs.push(message)
      if (message.type === 'world')
        worker.onmessage({ data: { type: 'snapshot-ack', mapKey: message.mapKey } })
    },
  }
  Object.defineProperty(globalThis, 'self', { value: worker, configurable: true })
  t.mock.method(Date, 'now', () => wall)
  t.mock.method(globalThis, 'setInterval', ((fn: () => void) => {
    pulse = fn
    return 0
  }) as typeof setInterval)
  t.mock.method(globalThis, 'fetch', (async (url: string, options?: RequestInit) => {
    if (url === '/api/history/status') return new Response(JSON.stringify({ configured }))
    assert.equal(url, '/api/statecraft/decision', 'ordinary suggestions use the cheap decision pass')
    const { context } = JSON.parse(options!.body as string)
    return new Promise<Response>((finish, reject) => {
      pending.push({ context, finish })
      options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
  }) as typeof fetch)
  const send = (data: WorkerRequest) => worker.onmessage({ data }),
    flush = () => new Promise((resolve) => setTimeout(resolve, 0))
  const agent = () => {
    send({ type: 'playback', running: false, speed: 1 })
    const last = outputs.filter((message) => message.type === 'world').at(-1)!
    return last.world.statecraft!.agents[0]
  }
  const finish = (index: number, id: number) =>
    pending[index].finish(
      new Response(
        JSON.stringify({
          model: 'mock-decision',
          proposal: plan([{ advice: id, response: 'I will weigh the costs before deciding.' }]),
        }),
      ),
    )
  try {
    await import('../src/sim/worker')
    send({ type: 'load', world: w })
    await flush()
    assert.equal(pending.length, 0)
    send({ type: 'advise', nation: 0, text: 'Consider coastal patrols.' })
    assert.equal(pending.length, 1)
    assert.equal(pending[0].context.adviser.pending[0].id, 1)
    send({ type: 'advise', nation: 0, text: 'Consider grain imports.' })
    finish(0, 1)
    await flush()
    assert.equal(agent().advisor!.notes[0].status, 'answered')
    assert.equal(agent().advisor!.notes[1].status, 'pending')
    pulse()
    assert.equal(pending.length, 1, 'sending more text does not bypass the wall-time budget')
    wall += 30001
    pulse()
    assert.equal(pending.length, 2)
    assert.deepEqual(
      pending[1].context.adviser.pending.map((n) => n.id),
      [2],
    )
    send({ type: 'withdraw-advice', nation: 0, advice: 2 })
    send({ type: 'advise', nation: 0, text: 'Consider provincial autonomy.' })
    finish(1, 2)
    await flush()
    assert.equal(agent().advisor!.notes[1].status, 'withdrawn')
    assert.equal(agent().advisor!.notes[2].status, 'pending')
    send({ type: 'advise', nation: 0, text: '' })
    assert(outputs.some((message) => message.type === 'error' && message.recoverable === true))
  } finally {
    configured = false
    send({ type: 'load', world: w })
    await flush()
    if (originalSelf) Object.defineProperty(globalThis, 'self', originalSelf)
    else Reflect.deleteProperty(globalThis, 'self')
  }
})
