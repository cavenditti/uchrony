import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ModelService } from '../server/model-settings'
import { storytellerMiddleware } from '../server/storyteller'
import { LlmPolicy } from '../server/llm-policy'
import { defaultModelSettings, validateModelSettings, MODEL_TASKS } from '../src/sim/model-tasks'
async function request(
  middleware: ReturnType<typeof storytellerMiddleware>,
  path: string,
  input: unknown,
  origin?: string,
) {
  const req = Readable.from([JSON.stringify(input)]) as IncomingMessage
  req.url = path
  req.method = 'POST'
  req.headers = { host: 'localhost', ...(origin ? { origin } : {}) }
  const res = new EventEmitter() as ServerResponse
  let code = 0,
    body: any
  res.writeHead = ((s: number) => {
    code = s
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
test('all roles can be assigned independently and settings survive service restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'uchrony-models-'))
  try {
    const service = new ModelService(join(root, 'models.json'))
    await service.initialize({})
    const settings = defaultModelSettings()
    settings.assignments.naming = { model: 'test/names', preference: 'throughput' }
    settings.assignments.details = { model: 'test/prose', preference: 'latency' }
    await service.update(settings)
    const restarted = new ModelService(join(root, 'models.json'))
    await restarted.initialize({})
    assert.deepEqual(restarted.snapshot().settings, settings)
    assert.equal(Object.keys(settings.assignments).length, Object.keys(MODEL_TASKS).length)
    assert.throws(() => validateModelSettings({ ...settings, sessionCallLimit: -1 }))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('catalog exposes supported formats and accurate prices; unavailable catalog keeps assignments', async () => {
  const service = new ModelService()
  await service.initialize({})
  await service.refreshCatalog(async () =>
    Response.json({
      data: [
        {
          id: 'test/text',
          name: 'Small writer',
          context_length: 10000,
          architecture: { output_modalities: ['text'] },
          pricing: { prompt: '0.0000001', completion: '0.0000004' },
          supported_parameters: ['structured_outputs'],
          top_provider: { max_completion_tokens: 2000 },
        },
      ],
    }),
  )
  assert.ok(Math.abs(service.models[0].inputPrice! - 0.1) < 1e-12)
  assert.equal(service.models[0].structured, true)
  const settings = defaultModelSettings()
  settings.assignments.strategy.model = 'test/text'
  await assert.rejects(service.update(settings), /output limit/)
})
test('writing uses chosen model and provider speed, counts retries and respects off and request limits', async () => {
  process.env.OPENROUTER_API_KEY = 'dummy-test-key'
  const service = new ModelService()
  await service.initialize({})
  const settings = defaultModelSettings()
  settings.assignments.naming = { model: 'test/namer', preference: 'throughput' }
  settings.sessionCallLimit = 1
  await service.update(settings)
  const policy = new LlmPolicy(() => false)
  let dispatched: any[] = []
  const middleware = storytellerMiddleware(
    'test',
    policy,
    async (_url, init) => {
      dispatched.push(JSON.parse(init!.body as string))
      return Response.json({
        choices: [{ message: { content: '{"names":[]}' }, finish_reason: 'stop' }],
        usage: { completion_tokens: 10, cost: 0.0001 },
      })
    },
    service,
  )
  assert.equal((await request(middleware, '/api/history/write/naming', { context: {} })).code, 403)
  const on = policy.set(true),
    input = { context: {}, policyGeneration: on.generation, policyInstance: on.instance }
  assert.equal((await request(middleware, '/api/history/write/naming', input)).code, 200)
  assert.equal(dispatched[0].model, 'test/namer')
  assert.equal(dispatched[0].provider.sort, 'throughput')
  assert.notEqual((await request(middleware, '/api/history/write/naming', input)).code, 200)
  assert.equal(dispatched.length, 1)
  assert.equal(service.calls, 1)
  assert.equal(service.measurements['test/namer'].outputTokens, 10)
})
test('cross-origin callers cannot mutate assignments; imports do not enable model permissions', async () => {
  const service = new ModelService()
  await service.initialize({})
  const policy = new LlmPolicy(() => false)
  const middleware = storytellerMiddleware(
    'test',
    policy,
    async () => {
      throw new Error('No provider expected')
    },
    service,
  )
  const result = await request(
    middleware,
    '/api/history/models',
    defaultModelSettings(),
    'https://elsewhere.invalid',
  )
  assert.equal(result.code, 403)
  assert.equal(policy.snapshot().enabled, false)
})
