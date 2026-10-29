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
import {
  defaultModelSettings,
  validateModelSettings,
  MODEL_TASKS,
  MODEL_TASK_TIERS,
  DEFAULT_MODELS,
  type ModelOption,
} from '../src/sim/model-tasks'
import {
  assignTier,
  tierChoices,
  tierModel,
  tierTasks,
  MODEL_TIERS,
  RECOMMENDED_MODELS,
} from '../src/sim/model-presets'
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
          reasoning: { mandatory: true },
        },
      ],
    }),
  )
  assert.ok(Math.abs(service.models[0].inputPrice! - 0.1) < 1e-12)
  assert.equal(service.models[0].structured, true)
  assert.equal(service.models[0].reasoningRequired, true)
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
  policy.set(false)
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
  policy.set(false)
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

const catalogModel = (id: string, overrides: Partial<ModelOption> = {}): ModelOption => ({
  id,
  name: id,
  context: 131072,
  outputLimit: 16384,
  json: true,
  structured: true,
  inputPrice: 0.2,
  outputPrice: 0.6,
  ...overrides,
})

test('simplified choices cover every task with two default models and preserve explicit overrides', () => {
  const settings = defaultModelSettings()
  assert.equal(tierModel(settings, 'light'), DEFAULT_MODELS.light)
  assert.equal(tierModel(settings, 'strong'), DEFAULT_MODELS.strong)
  for (const tier of MODEL_TIERS) {
    assert.ok(DEFAULT_MODELS[tier].endsWith(':free'))
    assert.equal(RECOMMENDED_MODELS[tier][0], DEFAULT_MODELS[tier])
  }
  assert.deepEqual(
    new Set([...tierTasks('light'), ...tierTasks('strong')]),
    new Set(Object.keys(MODEL_TASKS)),
  )
  assert.equal(Object.keys(MODEL_TASK_TIERS).length, Object.keys(MODEL_TASKS).length)
  assert.equal(tierModel(settings, 'light'), settings.assignments.naming.model)
  assert.equal(tierModel(settings, 'strong'), settings.assignments.history.model)
  const customized = defaultModelSettings({ OPENROUTER_DECISION_MODEL: 'custom/routine' })
  const snapshot = JSON.stringify(customized)
  assert.equal(tierModel(customized, 'light'), '')
  assert.equal(customized.assignments.decision.model, 'custom/routine')
  tierChoices([], 'light')
  assert.equal(JSON.stringify(customized), snapshot, 'Reading either view cannot rewrite assignments')
})

test('shortlists are bounded and exclude unavailable, incompatible and undersized models', () => {
  for (const tier of MODEL_TIERS) {
    assert.ok(RECOMMENDED_MODELS[tier].length > 0 && RECOMMENDED_MODELS[tier].length <= 8)
    const models = RECOMMENDED_MODELS[tier].map((id) => catalogModel(id))
    const valid = tierChoices([...models, catalogModel('unreviewed/cheap-model')], tier)
    assert.equal(valid.length, models.length)
    assert.equal(new Set(valid.map((m) => m.id)).size, valid.length)
    assert.equal(tierChoices([], tier).length, 0)
    for (const overrides of [
      { structured: false, json: false },
      { context: 16000 },
      { outputLimit: 1000 },
      { outputLimit: undefined },
      { reasoningRequired: true },
    ])
      assert.equal(tierChoices([catalogModel(models[0].id, overrides)], tier).length, 0)
  }
})

test('group edits preserve the other group and advanced preferences, then persist through restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'uchrony-simple-models-'))
  try {
    const settings = defaultModelSettings()
    settings.assignments.naming.preference = 'throughput'
    settings.assignments.strategy.preference = 'latency'
    settings.backgroundWriting = false
    settings.backgroundInterval = 240
    settings.sessionCallLimit = 73
    const before = structuredClone(settings)
    const light = assignTier(settings, 'light', RECOMMENDED_MODELS.light[1])
    assert.deepEqual(settings, before)
    for (const task of tierTasks('strong'))
      assert.deepEqual(light.assignments[task], before.assignments[task])
    const both = assignTier(light, 'strong', RECOMMENDED_MODELS.strong[1])
    for (const task of Object.keys(MODEL_TASKS) as (keyof typeof MODEL_TASKS)[]) {
      assert.equal(both.assignments[task].preference, before.assignments[task].preference)
      assert.equal(both.assignments[task].model, RECOMMENDED_MODELS[MODEL_TASK_TIERS[task]][1])
    }
    assert.equal(both.backgroundWriting, false)
    assert.equal(both.backgroundInterval, 240)
    assert.equal(both.sessionCallLimit, 73)
    const path = join(root, 'models.json'),
      service = new ModelService(path)
    await service.initialize({})
    await service.update(both)
    const restarted = new ModelService(path)
    await restarted.initialize({})
    assert.deepEqual(restarted.snapshot().settings, both)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('two-model assignments route writing and reasoning roles to their chosen providers', async () => {
  process.env.OPENROUTER_API_KEY = 'dummy-test-key'
  const service = new ModelService()
  await service.initialize({})
  await service.update(
    assignTier(
      assignTier(defaultModelSettings(), 'light', RECOMMENDED_MODELS.light[1]),
      'strong',
      RECOMMENDED_MODELS.strong[1],
    ),
  )
  const policy = new LlmPolicy(() => false),
    calls: string[] = []
  const middleware = storytellerMiddleware(
    'test',
    policy,
    async (_url, init) => {
      calls.push(JSON.parse(init!.body as string).model)
      return Response.json({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] })
    },
    service,
  )
  const on = policy.set(true),
    input = { context: {}, policyGeneration: on.generation, policyInstance: on.instance }
  for (const endpoint of ['history/write/naming', 'history/write/biography', 'statecraft/strategy']) {
    assert.equal((await request(middleware, '/api/' + endpoint, input)).code, 200)
  }
  assert.deepEqual(calls, [
    RECOMMENDED_MODELS.light[1],
    RECOMMENDED_MODELS.strong[1],
    RECOMMENDED_MODELS.strong[1],
  ])
})

test('free defaults use compatible formats on cold start and never repair onto a paid model', async () => {
  process.env.OPENROUTER_API_KEY = 'dummy-test-key'
  const service = new ModelService()
  await service.initialize({})
  const policy = new LlmPolicy(() => false),
    calls: any[] = []
  let rejectStrongSchema = true
  const middleware = storytellerMiddleware(
    'test',
    policy,
    async (_url, init) => {
      const call = JSON.parse(init!.body as string)
      calls.push(call)
      if (call.model === DEFAULT_MODELS.strong && rejectStrongSchema) {
        rejectStrongSchema = false
        return new Response('structured schema unavailable', { status: 400 })
      }
      return Response.json({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] })
    },
    service,
  )
  const on = policy.set(true),
    input = { context: {}, policyGeneration: on.generation, policyInstance: on.instance }
  assert.equal((await request(middleware, '/api/history/write/naming', input)).code, 200)
  assert.equal((await request(middleware, '/api/history/write/biography', input)).code, 200)
  assert.deepEqual(
    calls.map((c) => c.model),
    [DEFAULT_MODELS.light, DEFAULT_MODELS.strong, DEFAULT_MODELS.strong],
  )
  assert.deepEqual(
    calls.map((c) => c.response_format.type),
    ['json_object', 'json_schema', 'json_object'],
  )
  assert.ok(calls[0].messages.at(-1).content.includes('"names"'), 'JSON-only requests retain the task schema')
  for (const call of calls)
    assert.equal(call.models, undefined, 'No fallback model array may add paid models')
})

test('JSON-only rejection does not spend a second call on the same unsupported format', async () => {
  process.env.OPENROUTER_API_KEY = 'dummy-test-key'
  const service = new ModelService()
  await service.initialize({})
  const policy = new LlmPolicy(() => false)
  let calls = 0
  const middleware = storytellerMiddleware(
    'test',
    policy,
    async () => {
      calls++
      return new Response('response_format unavailable', { status: 400 })
    },
    service,
  )
  const on = policy.set(true),
    input = { context: {}, policyGeneration: on.generation, policyInstance: on.instance }
  assert.equal((await request(middleware, '/api/history/write/naming', input)).code, 502)
  assert.equal(calls, 1)
})
