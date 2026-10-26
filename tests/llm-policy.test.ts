import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { LlmPolicy } from '../server/llm-policy'
import { storytellerMiddleware } from '../server/storyteller'

async function request(middleware: ReturnType<typeof storytellerMiddleware>, path: string, input?: unknown) {
  const req = Readable.from(input === undefined ? [] : [JSON.stringify(input)]) as IncomingMessage
  req.url = path
  req.method = input === undefined ? 'GET' : 'POST'
  req.headers = { host: 'localhost' }
  const res = new EventEmitter() as ServerResponse
  let code = 0,
    body: any
  res.writeHead = ((status: number) => {
    code = status
    return res
  }) as typeof res.writeHead
  res.end = ((data: string) => {
    body = JSON.parse(data)
    return res
  }) as typeof res.end
  await middleware(req, res, () => {
    throw new Error('Unexpected next')
  })
  return { code, body }
}
const endpoints = [
  'history/generate',
  'history/details',
  'statecraft/decision',
  'statecraft/strategy',
  'statecraft/referee',
]

test('production endpoints default off with credentials; manual roles cannot enable calls', async () => {
  process.env.OPENROUTER_API_KEY = 'dummy-test-key'
  let calls = 0
  const policy = new LlmPolicy(() => false)
  const middleware = storytellerMiddleware('test', policy, async () => {
    calls++
    throw new Error('No network permitted')
  })
  for (const endpoint of endpoints) {
    const result = await request(middleware, `/api/${endpoint}`, { context: {}, policyGeneration: 0 })
    assert.equal(result.code, 403)
  }
  assert.equal(calls, 0)
  assert.equal((await request(middleware, '/api/history/status')).body.policy.enabled, false)
})

test('off barrier aborts requests and rejects old generations after re-enabling', () => {
  const policy = new LlmPolicy(() => false)
  const on = policy.set(true),
    controller = new AbortController()
  policy.begin(on.generation, controller)
  policy.set(false)
  assert.equal(controller.signal.aborted, true)
  policy.set(true)
  assert.equal(policy.allowed(on.generation), false)
  assert.throws(() => policy.dispatch(on.generation, controller, async () => 'paid'))
  assert.equal(policy.snapshot().dispatched, 0)
  assert.equal(policy.snapshot().cancelled, 1)
})

test('server override cannot be enabled by a tab or imported content', async () => {
  const policy = new LlmPolicy(() => true)
  const result = await request(storytellerMiddleware('test', policy), '/api/history/policy', {
    enabled: true,
  })
  assert.equal(result.code, 400)
  assert.equal(policy.snapshot().enabled, false)
})

test('disable during provider response prevents schema repair and stale result publication', async () => {
  const policy = new LlmPolicy(() => false),
    on = policy.set(true)
  let calls = 0
  const middleware = storytellerMiddleware('test', policy, async () => {
    calls++
    policy.set(false)
    return new Response('unsupported response_format schema', { status: 400 })
  })
  const result = await request(middleware, '/api/history/generate', {
    context: {},
    policyGeneration: on.generation,
    policyInstance: on.instance,
  })
  assert.equal(calls, 1)
  assert.notEqual(result.code, 200)
  assert.equal(policy.snapshot().active, 0)
})

test('two tab clients share one policy; earlier generation cannot dispatch', async () => {
  const policy = new LlmPolicy(() => false)
  let calls = 0
  const middleware = storytellerMiddleware('test', policy, async () => {
    calls++
    return Response.json({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] })
  })
  const first = await request(middleware, '/api/history/policy', { enabled: true })
  await request(middleware, '/api/history/policy', { enabled: false })
  await request(middleware, '/api/history/policy', { enabled: true })
  const stale = await request(middleware, '/api/statecraft/decision', {
    context: {},
    policyGeneration: first.body.generation,
    policyInstance: first.body.instance,
  })
  assert.equal(stale.code, 409)
  assert.equal(calls, 0)
  const current = policy.snapshot()
  const accepted = await request(middleware, '/api/statecraft/decision', {
    context: {},
    policyGeneration: current.generation,
    policyInstance: current.instance,
  })
  assert.equal(accepted.code, 200)
  assert.equal(accepted.body.policyGeneration, current.generation)
  assert.equal(calls, 1)
})

test('a restarted server rejects a previous instance even when its generation matches', async () => {
  const earlier = new LlmPolicy(() => false).set(true)
  const restarted = new LlmPolicy(() => false)
  const current = restarted.set(true)
  assert.equal(current.generation, earlier.generation)
  let calls = 0
  const middleware = storytellerMiddleware('test', restarted, async () => {
    calls++
    return Response.json({})
  })
  const stale = await request(middleware, '/api/history/generate', {
    context: {},
    policyGeneration: earlier.generation,
    policyInstance: earlier.instance,
  })
  assert.equal(stale.code, 409)
  assert.equal(calls, 0)
})
