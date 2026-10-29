import { queryWorldArchive, recordWorldArchive } from './world-archive'
import { withWorldConfiguration } from './configuration'
import { advanceAlmanac, queryPlaces, writingContext, acceptWriting } from './almanac'
import { defaultModelSettings, isWritingTask, type ModelTask } from './model-tasks'
import type { WritingRequest } from './almanac-types'
import { browserInfluencePool } from './influence-runtime'
import { setInfluenceExecutor } from './settlement-influence'
import { inspectWorld } from './inspection'
import { OFF_POLICY, samePermission, type LlmPolicySnapshot } from './llm-policy'
import { SnapshotMailbox } from './snapshot-mailbox'
import { viewSnapshot } from './view-snapshot'
import { WorldStorage } from '../storage/world-storage'
import { worldBlob } from '../storage/json-blob'
import { browserBackend, diskBackend } from '../storage/backends'
import { restoreSave } from '../storage/autosave'
import { parseSave } from './persistence'
import { MAX_SAVE_BYTES } from '../storage/save-types'
import { ByteStorageClient } from '../storage/byte-client'
import { pendingAdvice, submitAdvice, withdrawAdvice } from './advisors'
import { geographyKey } from '../map/geometry'
import { DEFAULT_WORLD_SCALE, WORLD_SCALES } from './scale'
import { Playback } from './playback'
import { ensurePopulation } from './population'
import { ensureIntelligence } from './intelligence'
import { ensureWarfare } from './navy'
import { generateWorld } from './generate'
import { tick, applyCommand, summarize, prepareSpatialWorld } from './engine'
import { restoreWorld } from './persistence'
import { receiveHistoricalEvent, ensureHistory, historicalContext } from './history'
import {
  ensureStatecraft,
  stateAgentContext,
  acceptStatePlan,
  readyOffers,
  refereeContext,
  acceptRefereeDecision,
} from './statecraft'
import type { World, WorkerRequest, WorkerResponse } from './types'
import type { StorytellerStatus } from './history-types'
import type { AgentServiceStatus } from './statecraft-types'

type Role = ModelTask
interface Job {
  key: string
  role: Role
  nation: number
  since: number
  generation: number
  instance: string
  world: World
  controller: AbortController
}
let llmPolicy = { ...OFF_POLICY }
let world: World | null = null,
  connected = false
let models = {
  model: 'deepseek/deepseek-v4.1-flash',
  decisionModel: 'mistralai/ministral-8b-2512',
  strategyModel: 'deepseek/deepseek-v4.1-flash',
  refereeModel: 'deepseek/deepseek-v4.1-flash',
}
let writingSettings = defaultModelSettings()
let nextWritingAt = 0
const writingQueue = new Map<string, WritingRequest>()
const detailQueue = new Map<number, World>()
const jobs = new Map<string, Job>(),
  retryAt = new Map<string, number>(),
  lastStrategy = new Map<number, number>(),
  lastLaunch = new Map<string, number>(),
  decisionSignals = new Map<number, string>()
let nextBackgroundAt = 0,
  lastHistoryMonth = -Infinity,
  backgroundPublish: ReturnType<typeof setTimeout> | undefined
let agentError = ''
let mapKey = ''
let geographyPublished = false
const send = (message: WorkerResponse) => self.postMessage(message)
const spatialPool = browserInfluencePool()
const spatialReady = spatialPool?.warmup() ?? Promise.resolve()
if (spatialPool) setInfluenceExecutor((input) => spatialPool.solve(input))
const status = (state: StorytellerStatus['state'], message: string) =>
  send({ type: 'storyteller', status: { state, message, model: models.model } })
function agentStatus() {
  const active: AgentServiceStatus['active'] = [...jobs.values()]
    .filter((job) => ['decision', 'strategy'].includes(job.role))
    .map((job) => ({
      nation: job.nation,
      role: job.role as 'decision' | 'strategy',
      since: job.since,
    }))
  send({
    type: 'agents',
    status: {
      pending: active.length,
      active,
      decisionModel: models.decisionModel,
      strategyModel: models.strategyModel,
      error: agentError,
    },
  })
}
// Observer subscription never enters the canonical world or its random stream.
let detailNation: number | null = null
let revision = 0
let playbackIntent = 0
const backends = [diskBackend(), browserBackend()]
const byteStorage = new ByteStorageClient()
const storage = new WorldStorage([byteStorage.backend('disk'), byteStorage.backend('browser')], (status) =>
  send({ type: 'storage', ...status }),
)
const mailbox = new SnapshotMailbox((message, acknowledgement) => {
  if (!world) return
  const dynamic = viewSnapshot(world, detailNation)
  send({
    type: 'world',
    world: geographyPublished ? dynamic : { ...dynamic, cells: world.cells },
    mapKey,
    message,
    acknowledgement,
  })
  geographyPublished = true
})
function publish(message?: string, acknowledgement = false) {
  if (acknowledgement) {
    clearTimeout(backgroundPublish)
    backgroundPublish = undefined
  }
  if (world) {
    if (world.archive) recordWorldArchive(world)
    revision++
    mailbox.publish(message, acknowledgement)
  }
}
function applyLlmPolicy(policy: LlmPolicySnapshot, publishPolicy = true) {
  if (policy.instance === llmPolicy.instance && policy.generation < llmPolicy.generation) return
  const changed =
    policy.instance !== llmPolicy.instance ||
    policy.generation !== llmPolicy.generation ||
    policy.enabled !== llmPolicy.enabled
  llmPolicy = policy
  if (!policy.enabled || changed) {
    for (const job of jobs.values()) job.controller.abort()
    for (const id of detailQueue.keys())
      send({ type: 'event-detail', event: id, state: 'error', message: 'LLM assistance is off.' })
    for (const job of jobs.values()) {
      if (isWritingTask(job.role))
        send({ type: 'world-writing', id: job.key, state: 'error', message: 'Model permission changed.' })
      if (job.role === 'details')
        send({
          type: 'event-detail',
          event: Number(job.key.split(':')[1]),
          state: 'error',
          message: 'Model permission changed.',
        })
    }
    jobs.clear()
    detailQueue.clear()
    for (const request of writingQueue.values())
      send({ type: 'world-writing', id: request.id, state: 'error', message: 'Model permission changed.' })
    writingQueue.clear()
    retryAt.clear()
    agentError = ''
    agentStatus()
  }
  if (publishPolicy) send({ type: 'llm-policy', policy })
  if (!policy.enabled)
    status('ready', 'LLM assistance is off. Native events and government decisions continue.')
}
const policyEvents = new EventSource('/api/history/policy-events')
policyEvents.onmessage = (event) => {
  applyLlmPolicy(JSON.parse(event.data))
  if (llmPolicy.enabled) void connection().then(schedule)
}
policyEvents.addEventListener('models', (event) => {
  writingSettings = JSON.parse((event as MessageEvent).data)
  models = {
    model: writingSettings.assignments.history.model,
    decisionModel: writingSettings.assignments.decision.model,
    strategyModel: writingSettings.assignments.strategy.model,
    refereeModel: writingSettings.assignments.referee.model,
  }
  nextWritingAt = Date.now() + writingSettings.backgroundInterval * 1000
  agentStatus()
})
policyEvents.onerror = () => {
  // Fail closed when this worker can no longer observe the global switch.
  applyLlmPolicy({ ...llmPolicy, enabled: false })
}
async function connection() {
  try {
    const response = await fetch('/api/history/status')
    if (!response.ok)
      throw new Error('The model service is unavailable. Local simulation and events are continuing.')
    const config = await response.json()
    models = { ...models, ...config }
    if (config.writing) writingSettings = config.writing
    connected = !!config.configured
    applyLlmPolicy(config.policy ?? { ...OFF_POLICY, generation: llmPolicy.generation })
    status(
      !llmPolicy.enabled || connected ? 'ready' : 'error',
      !llmPolicy.enabled
        ? 'LLM assistance is off. Native events and government decisions continue.'
        : connected
          ? 'OpenRouter connected. Historical events and state deliberations run in the background.'
          : 'Add OPENROUTER_API_KEY to .env, then retry. The local simulation is continuing.',
    )
    agentStatus()
    return connected
  } catch (error) {
    connected = false
    status(
      'error',
      error instanceof Error ? error.message : 'Model connection failed. The simulation is continuing.',
    )
    return false
  }
}
const playback = new Playback(
  () => {
    if (!world) return false
    tick(world)
    revision++
    return true
  },
  () => publish(),
  (error) => {
    // Reject further use of a partially advanced world. The last completed save
    // remains available; async model jobs cannot apply to this discarded state.
    world = null
    playbackIntent++
    mailbox.reset()
    clearTimeout(backgroundPublish)
    send({
      type: 'error',
      message: `${error instanceof Error ? error.message : 'Simulation stopped.'} Reload to restore the last completed save.`,
    })
  },
)
function reset() {
  geographyPublished = false
  mailbox.reset()
  storage.reset()
  playbackIntent++
  playback.stop()
  for (const job of jobs.values()) job.controller.abort()
  jobs.clear()
  detailQueue.clear()
  writingQueue.clear()
  nextWritingAt = 0
  decisionSignals.clear()
  lastLaunch.clear()
  nextBackgroundAt = 0
  lastHistoryMonth = -Infinity
  clearTimeout(backgroundPublish)
  backgroundPublish = undefined
  retryAt.clear()
  lastStrategy.clear()
  agentError = ''
  agentStatus()
}
async function launch(
  role: Role,
  key: string,
  nation: number,
  context: unknown,
  accept: (value: unknown, model: string) => void,
) {
  if (
    !world ||
    !samePermission(llmPolicy, llmPolicy.generation) ||
    !connected ||
    jobs.has(key) ||
    jobs.size >= 4 ||
    (retryAt.get(key) ?? 0) > Date.now()
  )
    return
  const job: Job = {
    key,
    role,
    nation,
    since: world.month,
    generation: llmPolicy.generation,
    instance: llmPolicy.instance,
    world,
    controller: new AbortController(),
  }
  jobs.set(key, job)
  lastLaunch.set(key, Date.now())
  if (role !== 'details') nextBackgroundAt = Date.now() + 5000
  if (role === 'history') lastHistoryMonth = world.month
  agentStatus()
  if (role === 'history') status('generating', 'A historical account is being developed in the background.')
  const endpoint = isWritingTask(role)
    ? `/api/history/write/${role}`
    : role === 'history'
      ? '/api/history/generate'
      : role === 'details'
        ? '/api/history/details'
        : `/api/statecraft/${role}`
  try {
    let repair: unknown = undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!samePermission(llmPolicy, job.generation, job.instance) || job.controller.signal.aborted) return
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context,
          repair,
          policyGeneration: job.generation,
          policyInstance: job.instance,
        }),
        signal: job.controller.signal,
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'The model request failed.')
      const permission = await fetch('/api/history/policy', { signal: job.controller.signal }).then((r) => {
        if (!r.ok) throw new Error('Could not verify model permission.')
        return r.json()
      })
      applyLlmPolicy(permission)
      if (
        world !== job.world ||
        jobs.get(key) !== job ||
        !samePermission(llmPolicy, job.generation, job.instance) ||
        result.policyGeneration !== job.generation ||
        result.policyInstance !== job.instance
      )
        return
      try {
        withWorldConfiguration(world!, () => accept(result.proposal, result.model))
        if (!isWritingTask(role)) advanceAlmanac(world, true)
        const provenance = (world.modelProvenance ??= {
          accepted: 0,
          lastMonth: world.month,
          roles: {},
          source: 'legacy-unknown',
        })
        provenance.accepted++
        provenance.lastMonth = world.month
        provenance.roles[role] = (provenance.roles[role] ?? 0) + 1
        provenance.source = 'model-assisted'
        break
      } catch (error) {
        if (attempt === 1) throw error
        repair = {
          previous: result.proposal,
          error:
            error instanceof Error ? error.message : 'The response did not match the simulation contract.',
        }
      }
    }
    retryAt.set(
      key,
      Date.now() + (role === 'decision' ? 5000 : role === 'strategy' ? 20000 : role === 'referee' ? 1000 : 0),
    )
    if (role === 'strategy') lastStrategy.set(nation, Date.now())
    if (role === 'history') status('ready', 'A historical draft is ready for a suitable moment.')
    if (isWritingTask(role)) send({ type: 'world-writing', id: key, state: 'done' })
    if (role === 'details') send({ type: 'event-detail', event: Number(key.split(':')[1]), state: 'done' })
    // Coalesce completions; never serialize a multi-megabyte world once per agent reply.
    if (!backgroundPublish)
      backgroundPublish = setTimeout(() => {
        backgroundPublish = undefined
        if (!playback.running) publish()
      }, 500)
  } catch (error) {
    if (job.controller.signal.aborted || world !== job.world) return
    const message = error instanceof Error ? error.message : 'Model request failed.'
    retryAt.set(key, Date.now() + 20000)
    if (isWritingTask(role)) send({ type: 'world-writing', id: key, state: 'error', message })
    if (role === 'history') status('error', `${message} Local events are continuing.`)
    else if (role === 'details')
      send({ type: 'event-detail', event: Number(key.split(':')[1]), state: 'error', message })
    else if (!isWritingTask(role)) {
      agentError =
        role === 'referee'
          ? 'Diplomatic developments are delayed. Existing commitments remain in force.'
          : message
      const agent = world?.statecraft?.agents.find((entry) => entry.nation === nation)
      if (agent && role === 'decision')
        agent.escalation = `The lightweight pass needs strategic review: ${message}`
    }
  } finally {
    if (jobs.get(key) === job) {
      jobs.delete(key)
      agentStatus()
      schedule()
    }
  }
}
function schedule() {
  if (!world || !connected || !llmPolicy.enabled) return
  const current = world,
    now = Date.now(),
    eligible = (key: string, interval: number) =>
      !jobs.has(key) &&
      jobs.size < 4 &&
      now >= (retryAt.get(key) ?? 0) &&
      now - (lastLaunch.get(key) ?? -Infinity) >= interval &&
      now >= nextBackgroundAt,
    opportunity = world.historical?.opportunity
  const requestedWriting = [...writingQueue.values()].find(
    (r) => !jobs.has(r.id) && (retryAt.get(r.id) ?? 0) <= now,
  )
  if (requestedWriting && jobs.size < 4 && now >= nextBackgroundAt) {
    writingQueue.delete(requestedWriting.id)
    startWriting(current, requestedWriting)
  }
  if (writingSettings.backgroundWriting && now >= nextWritingAt && now >= nextBackgroundAt && jobs.size < 3) {
    const pending = Object.values(current.almanac?.entries ?? {}).find(
      (p) =>
        p.naming === 'pending' &&
        !jobs.has(`writing:culture:${p.id}`) &&
        (retryAt.get(`writing:culture:${p.id}`) ?? 0) <= now &&
        !jobs.has(`writing:naming:${p.id}`) &&
        (retryAt.get(`writing:naming:${p.id}`) ?? 0) <= now,
    )
    if (pending) {
      nextWritingAt = now + writingSettings.backgroundInterval * 1000
      const task = current.almanac?.languages[pending.language] ? 'naming' : 'culture'
      startWriting(current, { id: `writing:${task}:${pending.id}`, task, place: pending.id })
    }
  }
  if (opportunity && current.month >= lastHistoryMonth + 24 && eligible('history', 90000))
    void launch('history', 'history', -1, historicalContext(current), (value, model) => {
      receiveHistoricalEvent(current, opportunity.id, value, model)
    })
  if (jobs.size < 4) {
    const next = [...detailQueue].find(
      ([id, owner]) =>
        owner === current && !jobs.has(`details:${id}`) && (retryAt.get(`details:${id}`) ?? 0) <= Date.now(),
    )
    if (next) {
      const [id] = next,
        event = current.events.find((entry) => entry.id === id)
      detailQueue.delete(id)
      if (event)
        void launch(
          'details',
          `details:${id}`,
          -1,
          {
            event,
            nations: current.nations.map((nation) => ({ id: nation.id, name: nation.name })),
            region: event.region === undefined ? null : current.regions[event.region].name,
          },
          (value) => {
            const result = value as { account?: unknown }
            if (typeof result.account !== 'string' || result.account.length > 2400)
              throw new Error('The expanded account is invalid.')
            const recorded = current.events.find((entry) => entry.id === id)
            if (recorded) recorded.expandedAccount = result.account
          },
        )
    }
  }
  const ready = readyOffers(current)
    .filter((offer) => (offer.reviewAfter ?? 0) <= current.month)
    .slice(0, 6)
  if (ready.length && eligible('referee', 5000)) {
    const submitted = ready.map((offer) => ({ id: offer.id, digest: offer.digest }))
    ready.forEach((offer) => (offer.reviewAfter = current.month + 3))
    void launch('referee', 'referee', -1, refereeContext(current, ready), (value, model) =>
      acceptRefereeDecision(current, value, submitted, model),
    )
  }
  for (const agent of [...ensureStatecraft(current).agents].sort(
    (a, b) =>
      Number(pendingAdvice(b).length > 0) - Number(pendingAdvice(a).length > 0) ||
      (lastLaunch.get(`state:${a.nation}`) ?? -Infinity) - (lastLaunch.get(`state:${b.nation}`) ?? -Infinity),
  )) {
    if (jobs.size >= 4) break
    if (
      !current.regions.some((region) => region.nation === agent.nation) ||
      jobs.has(`state:${agent.nation}`)
    )
      continue
    const adviceWaiting = pendingAdvice(agent).length > 0
    if (!adviceWaiting && current.month < agent.nextDecision && agent.lastDecision === 0) continue
    const key = `state:${agent.nation}`
    // Check budgets BEFORE building census, map, agreements and prompts. Clock speed never raises request rate.
    if (!eligible(key, 30000)) continue
    const requestedByObserver = agent.escalation === 'Strategic review requested by the observer.',
      newCrisis =
        current.pressures?.incidents.some(
          (incident) =>
            incident.nations.includes(agent.nation) &&
            incident.month > agent.lastStrategy &&
            incident.expires > current.month,
        ) ||
        current.sovereignty?.provinces.some(
          (report) =>
            report.nation === agent.nation &&
            report.stage === 'contested' &&
            report.warned > agent.lastStrategy,
        ),
      full =
        requestedByObserver ||
        ((!!agent.escalation || current.month >= agent.nextStrategy) &&
          now - (lastStrategy.get(agent.nation) ?? -Infinity) >= (newCrisis ? 60000 : 120000))
    if (!full && !adviceWaiting && current.month < agent.nextDecision) continue
    const nation = current.nations[agent.nation],
      signal = JSON.stringify([
        Math.floor(nation.foodCoverage * 5),
        Math.floor(nation.stability / 15),
        nation.treasury < 0,
        nation.character?.leader.generation,
        current.relations
          .filter((rel) => (rel.a === agent.nation || rel.b === agent.nation) && rel.treaty === 'war')
          .map((rel) => [rel.a, rel.b]),
        current.statecraft!.messages.filter((message) => message.to.includes(agent.nation)).at(-1)?.id,
        current
          .statecraft!.offers.filter(
            (offer) => offer.parties.includes(agent.nation) && offer.status === 'proposed',
          )
          .map((offer) => offer.id),
        agent.escalation,
        pendingAdvice(agent).map((note) => note.id),
        current.intelligence?.services
          .find((s) => s.nation === agent.nation)
          ?.dossiers.map((d) => [d.nation, d.military?.month, d.economy?.month, d.politics?.month]),
      ])
    if (!full && decisionSignals.get(agent.nation) === signal && current.month < agent.lastDecision + 24)
      continue
    decisionSignals.set(agent.nation, signal)
    const context = stateAgentContext(current, agent.nation, full),
      requested = current.month
    void launch(
      full ? 'strategy' : 'decision',
      `state:${agent.nation}`,
      agent.nation,
      context,
      (value, model) =>
        acceptStatePlan(current, agent.nation, value, full, model, requested, {
          owners: Object.fromEntries([
            ...context.provinces.map((province) => [province.id, agent.nation]),
            ...context.map.map((province) => [province.id, province.nation]),
            ...context.affordances.canFoundTargets.map((site) => [site.province, -1]),
          ]),
          armies: context.armies.map((army) => army.id),
          fleets: context.fleets.map((fleet) => fleet.id),
          seenMessage: Math.max(0, ...context.inbox.map((message) => message.id)),
          offers: context.offers.map((offer) => offer.id),
          leaderGeneration: context.character?.leader.generation,
          advice: context.adviser.pending.map((note) => note.id),
        }),
    )
  }
}
function startWriting(current: World, request: WritingRequest) {
  const context = writingContext(current, request)
  send({ type: 'world-writing', id: request.id, state: 'loading' })
  void launch(request.task, request.id, -1, context, (value, model) =>
    acceptWriting(current, context, value, model),
  )
}
self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  try {
    if (data.type === 'places') {
      if (world) send({ type: 'places', result: queryPlaces(world, data.query) })
      return
    }
    if (data.type === 'models-changed') {
      await connection()
      nextWritingAt = 0
      schedule()
      return
    }
    if (data.type === 'world-writing') {
      const r = data.request
      if (!world || !llmPolicy.enabled || !connected) {
        send({
          type: 'world-writing',
          id: r.id,
          state: 'error',
          message: 'Enable LLM assistance and connect a model to request an account.',
        })
        return
      }
      if (writingQueue.size >= 12) {
        send({
          type: 'world-writing',
          id: r.id,
          state: 'error',
          message: 'The reading queue is full. Try again after an account finishes.',
        })
        return
      }
      if (!isWritingTask(r.task) || !world.almanac?.entries[r.place] || (r.question?.length ?? 0) > 500)
        throw new Error('Invalid writing request.')
      writingQueue.set(r.id, r)
      retryAt.delete(r.id)
      send({ type: 'world-writing', id: r.id, state: 'loading' })
      schedule()
      return
    }
    if (data.type === 'view-focus') {
      detailNation = data.nation
      if (world) mailbox.publish()
      return
    }
    if (data.type === 'archive') {
      try {
        if (!world) throw new Error('No world to inspect.')
        if (!world.archive) recordWorldArchive(world)
        send({ type: 'archive', result: queryWorldArchive(world, data.query), mapKey })
      } catch (error) {
        send({
          type: 'archive-error',
          request: data.query.id,
          message: error instanceof Error ? error.message : 'History unavailable.',
        })
      }
      return
    }
    if (data.type === 'inspect') {
      const request = data.request
      try {
        if (!world) throw new Error('No world to inspect.')
        send({
          type: 'inspection',
          snapshot: withWorldConfiguration(world, () => inspectWorld(world!, request)),
        })
      } catch (error) {
        send({
          type: 'inspection-error',
          request: data.request.id,
          message: error instanceof Error ? error.message : 'Inspection unavailable.',
        })
      }
      return
    }
    if (data.type === 'llm-policy') {
      if (!data.enabled) applyLlmPolicy({ ...llmPolicy, enabled: false }, false)
      const response = await fetch('/api/history/policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: data.enabled }),
      })
      const value = await response.json()
      if (!response.ok) throw new Error(value.error || 'Could not change LLM assistance.')
      applyLlmPolicy(value)
      await connection()
      schedule()
      return
    }
    if (data.type === 'storage-port') {
      byteStorage.connect(data.port)
      return
    }
    if (data.type === 'storage-error') {
      byteStorage.interrupted(data.message ? `The save worker stopped: ${data.message}` : undefined)
      return
    }
    if (data.type === 'snapshot-ack') {
      if (data.mapKey === mapKey) mailbox.acknowledge()
      return
    }
    if (data.type === 'save') {
      if (world) void storage.save(world, revision, data.force)
      return
    }
    if (data.type === 'export') {
      if (world)
        send({
          type: 'exported',
          blob: worldBlob(world),
          filename: `uchrony-${world.seed.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 50)}-${world.startYear + Math.floor(world.month / 12)}.json`,
        })
      return
    }
    if (data.type === 'restore') {
      try {
        const saved = await restoreSave(backends, data.legacy)
        data = saved.world
          ? { type: 'load', world: saved.world }
          : { type: 'generate', seed: 'A world unwritten' }
        if (saved.world) send({ type: 'storage', state: 'restored' })
      } catch (error) {
        send({
          type: 'startup-error',
          message: error instanceof Error ? error.message : 'The saved world could not be restored.',
        })
        return
      }
    } else if (data.type === 'import') {
      if (data.file.size > MAX_SAVE_BYTES) throw new Error('The world exceeds the supported save size.')
      data = { type: 'load', world: parseSave(await data.file.text()) }
    }
    const action = data
    if (action.type === 'playback') {
      const intent = ++playbackIntent
      playback.stop()
      if (world && action.running) {
        await spatialReady
        if (intent !== playbackIntent) return
        playback.start(action.speed)
      } else {
        playback.stop()
        publish()
      }
      return
    }
    let message: string | undefined
    if (action.type === 'generate') {
      const scale = action.scale ?? DEFAULT_WORLD_SCALE
      const generated = generateWorld(
        action.seed,
        action.continents,
        action.nations ?? WORLD_SCALES[scale].states,
        action.settings,
        scale,
        action.start ?? 'frontier',
        action.configuration,
      )
      // Prepare the replacement completely before retiring the current world.
      // Validation or initialization failure leaves the current save and state intact.
      prepareSpatialWorld(generated)
      advanceAlmanac(generated, true)
      ensurePopulation(generated)
      ensureHistory(generated)
      ensureStatecraft(generated)
      summarize(generated)
      recordWorldArchive(generated)
      reset()
      world = generated
      mapKey = geographyKey(world.cells)
      void connection().then(schedule)
    } else if (action.type === 'load') {
      const restored = restoreWorld(action.world)
      reset()
      world = restored
      mapKey = geographyKey(world.cells)
      prepareSpatialWorld(world)
      advanceAlmanac(world, true)
      ensureWarfare(world)
      ensurePopulation(world)
      ensureHistory(world)
      ensureStatecraft(world)
      ensureIntelligence(world)
      if (!world.archive) recordWorldArchive(world)
      message = 'World restored. Simulation is paused.'
      void connection().then(schedule)
    } else if (action.type === 'step') {
      const target = world
      await spatialReady
      if (world !== target) return
      if (!world) throw new Error('Generate a world first.')
      for (let i = 0; i < Math.min(120, Math.max(1, Math.floor(action.count))); i++) tick(world)
    } else if (action.type === 'command') {
      if (!world) throw new Error('Generate a world first.')
      message = applyCommand(world, action.command)
      summarize(world, false)
      advanceAlmanac(world, true)
    } else if (action.type === 'retry-history') {
      retryAt.clear()
      lastLaunch.clear()
      nextBackgroundAt = 0
      agentError = ''
      void connection().then(schedule)
    } else if (action.type === 'advise' || action.type === 'withdraw-advice') {
      if (!world) throw new Error('No government is available yet.')
      const agent = ensureStatecraft(world).agents.find((entry) => entry.nation === action.nation)
      if (!agent) throw new Error('That government could not be found.')
      if (action.type === 'advise') {
        submitAdvice(world, agent, action.text)
        decisionSignals.delete(action.nation)
        message = llmPolicy.enabled
          ? 'Suggestion sent privately. The government will weigh it at its next assessment.'
          : 'Suggestion saved. Free-text advice awaits optional model review; native government decisions continue.'
      } else {
        withdrawAdvice(world, agent, action.advice)
        message = 'Undelivered suggestion withdrawn.'
      }
    } else if (action.type === 'agent-strategy') {
      if (!llmPolicy.enabled) throw new Error('LLM assistance is off. Native government decisions continue.')
      const agent = world?.statecraft?.agents.find((entry) => entry.nation === action.nation)
      if (agent) {
        agent.escalation = 'Strategic review requested by the observer.'
        agent.nextDecision = world!.month
        retryAt.delete(`state:${action.nation}`)
        lastStrategy.delete(action.nation)
        lastLaunch.delete(`state:${action.nation}`)
      }
    } else if (action.type === 'event-details') {
      const current = world,
        event = current?.events.find((entry) => entry.id === action.event)
      if (current && event && !event.expandedAccount) {
        if (!connected || !llmPolicy.enabled)
          send({
            type: 'event-detail',
            event: event.id,
            state: 'error',
            message: 'LLM assistance is off or unavailable. The native simulation continues.',
          })
        else {
          detailQueue.set(event.id, current)
          retryAt.delete(`details:${event.id}`)
          send({ type: 'event-detail', event: event.id, state: 'loading' })
        }
      }
    }
    publish(message, true)
    schedule()
  } catch (error) {
    send({
      type: 'error',
      message: error instanceof Error ? error.message : 'The action could not complete.',
      recoverable: [
        'advise',
        'withdraw-advice',
        'agent-strategy',
        'llm-policy',
        'places',
        'world-writing',
        'models-changed',
      ].includes(data.type),
    })
  }
}
status('ready', 'LLM assistance is off. Native simulation is available.')

setInterval(schedule, 1000)
