import { ensurePopulation } from './population'
import { ensureWarfare } from './navy'
import { generateWorld } from './generate'
import { tick, applyCommand, summarize } from './engine'
import { validateWorld } from './persistence'
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

type Role = 'history' | 'details' | 'decision' | 'strategy' | 'referee'
interface Job {
  key: string
  role: Role
  nation: number
  since: number
  world: World
  controller: AbortController
}
let world: World | null = null,
  connected = false
let models = {
  model: 'deepseek/deepseek-v4.1-flash',
  decisionModel: 'mistralai/ministral-8b-2512',
  strategyModel: 'deepseek/deepseek-v4.1-flash',
  refereeModel: 'deepseek/deepseek-v4.1-flash',
}
const detailQueue = new Map<number, World>(),
  strategicSignals = new Map<number, string>()
const jobs = new Map<string, Job>(),
  retryAt = new Map<string, number>(),
  lastStrategy = new Map<number, number>()
let agentError = ''
const send = (message: WorkerResponse) => self.postMessage(message)
const status = (state: StorytellerStatus['state'], message: string) =>
  send({ type: 'storyteller', status: { state, message, model: models.model } })
function agentStatus() {
  const active: AgentServiceStatus['active'] = [...jobs.values()]
    .filter((job) => ['decision', 'strategy', 'referee'].includes(job.role))
    .map((job) => ({
      nation: job.nation,
      role: job.role as 'decision' | 'strategy' | 'referee',
      since: job.since,
    }))
  send({ type: 'agents', status: { pending: jobs.size, active, ...models, error: agentError } })
}
function publish(message?: string, acknowledgement = false) {
  if (world) send({ type: 'world', world, message, acknowledgement })
}
async function connection() {
  try {
    const response = await fetch('/api/history/status')
    if (!response.ok)
      throw new Error('The model service is unavailable. Local simulation and events are continuing.')
    const config = await response.json()
    models = { ...models, ...config }
    connected = !!config.configured
    status(
      connected ? 'ready' : 'error',
      connected
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
function reset() {
  for (const job of jobs.values()) job.controller.abort()
  jobs.clear()
  detailQueue.clear()
  strategicSignals.clear()
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
  if (!world || jobs.has(key) || jobs.size >= 4 || (retryAt.get(key) ?? 0) > Date.now()) return
  const job: Job = { key, role, nation, since: world.month, world, controller: new AbortController() }
  jobs.set(key, job)
  agentStatus()
  if (role === 'history') status('generating', 'A historical account is being developed in the background.')
  const endpoint =
    role === 'history'
      ? '/api/history/generate'
      : role === 'details'
        ? '/api/history/details'
        : `/api/statecraft/${role}`
  try {
    let repair: unknown = undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context, repair }),
        signal: job.controller.signal,
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'The model request failed.')
      if (world !== job.world || jobs.get(key) !== job) return
      try {
        accept(result.proposal, result.model)
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
    if (role === 'details') send({ type: 'event-detail', event: Number(key.split(':')[1]), state: 'done' })
    publish()
  } catch (error) {
    if (job.controller.signal.aborted || world !== job.world) return
    const message = error instanceof Error ? error.message : 'Model request failed.'
    retryAt.set(key, Date.now() + 20000)
    if (role === 'history') status('error', `${message} Local events are continuing.`)
    else if (role === 'details')
      send({ type: 'event-detail', event: Number(key.split(':')[1]), state: 'error', message })
    else {
      agentError = message
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
  if (!world || !connected) return
  const current = world,
    opportunity = world.historical?.opportunity
  if (opportunity && !jobs.has('history'))
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
  if (ready.length && !jobs.has('referee') && jobs.size < 4 && (retryAt.get('referee') ?? 0) <= Date.now()) {
    const submitted = ready.map((offer) => ({ id: offer.id, digest: offer.digest }))
    ready.forEach((offer) => (offer.reviewAfter = current.month + 3))
    void launch('referee', 'referee', -1, refereeContext(current, ready), (value, model) =>
      acceptRefereeDecision(current, value, submitted, model),
    )
  }
  for (const agent of ensureStatecraft(current).agents) {
    if (jobs.size >= 4) break
    if (
      !current.regions.some((region) => region.nation === agent.nation) ||
      jobs.has(`state:${agent.nation}`)
    )
      continue
    if (current.month < agent.nextDecision && agent.lastDecision === 0) continue
    const urgent =
        /New diplomatic|negotiation requires|Strategic review requested|Decision model requests|wartime/.test(
          agent.escalation,
        ),
      signal = `${agent.escalation}:${Math.max(0, ...current.statecraft!.messages.filter((message) => message.to.includes(agent.nation)).map((message) => message.id))}:${Math.max(0, ...current.statecraft!.offers.filter((offer) => offer.parties.includes(agent.nation)).map((offer) => offer.id))}`
    if (urgent && strategicSignals.get(agent.nation) !== signal) {
      lastStrategy.delete(agent.nation)
      retryAt.delete(`state:${agent.nation}`)
      strategicSignals.set(agent.nation, signal)
    }
    const full =
      (!!agent.escalation || current.month >= agent.nextStrategy) &&
      Date.now() - (lastStrategy.get(agent.nation) ?? 0) >= 30000
    if (!full && current.month < agent.nextDecision) continue
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
          ]),
          armies: context.armies.map((army) => army.id),
          fleets: context.fleets.map((fleet) => fleet.id),
          seenMessage: Math.max(0, ...context.inbox.map((message) => message.id)),
          offers: context.offers.map((offer) => offer.id),
          leaderGeneration: context.character?.leader.generation,
        }),
    )
  }
}
self.onmessage = ({ data }: MessageEvent<WorkerRequest>) => {
  try {
    let message: string | undefined
    if (data.type === 'generate') {
      reset()
      world = generateWorld(data.seed, data.continents, data.nations)
      ensurePopulation(world)
      ensureHistory(world)
      ensureStatecraft(world)
      summarize(world)
      void connection().then(schedule)
    } else if (data.type === 'load') {
      const restored = validateWorld(data.world)
      reset()
      world = restored
      ensureWarfare(world)
      ensurePopulation(world)
      ensureHistory(world)
      ensureStatecraft(world)
      message = 'World restored. Simulation is paused.'
      void connection().then(schedule)
    } else if (data.type === 'step') {
      if (!world) throw new Error('Generate a world first.')
      for (let i = 0; i < Math.min(120, Math.max(1, Math.floor(data.count))); i++) tick(world)
    } else if (data.type === 'command') {
      if (!world) throw new Error('Generate a world first.')
      message = applyCommand(world, data.command)
      summarize(world, false)
    } else if (data.type === 'retry-history') {
      retryAt.clear()
      agentError = ''
      void connection().then(schedule)
    } else if (data.type === 'agent-strategy') {
      const agent = world?.statecraft?.agents.find((entry) => entry.nation === data.nation)
      if (agent) {
        agent.escalation = 'Strategic review requested by the observer.'
        agent.nextDecision = world!.month
        retryAt.delete(`state:${data.nation}`)
        lastStrategy.delete(data.nation)
      }
    } else if (data.type === 'event-details') {
      const current = world,
        event = current?.events.find((entry) => entry.id === data.event)
      if (current && event && !event.expandedAccount) {
        if (!connected)
          send({
            type: 'event-detail',
            event: event.id,
            state: 'error',
            message: 'Connect OpenRouter to expand this historical account. The simulation is continuing.',
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
    })
  }
}
status('connecting', 'Connecting background model services…')

setInterval(schedule, 1000)
