import { ensurePopulation, returnArmyPeople, identityDistribution } from './population'
import { populationIdentitySummary } from './identities'
import { characterContext } from './character'
import { allForces } from './forces'
import { portAt } from './navy'
import { hashSeed } from './random'
import { makeNation } from './generate'
import { applyCommand, summarize } from './engine'
import { ensureHistory, applyRefereeEffects } from './history'
import { validateHistoricalEffect } from './history-schema'
import { parseReferee, parseStatePlan } from './statecraft-schema'
import { agreementTerms, currentAgreements } from './agreements'
import {
  agreementReference,
  agreementReferenceIndex,
  retainAgreementReferences,
} from './agreement-references'
import { FIELDS, clamp, population, relation, type Command, type Policies, type World } from './types'
import type {
  DiplomaticClause,
  DiplomaticOffer,
  DomesticOrder,
  Statecraft,
  StateAgentPlan,
  RefereeDecision,
  Visibility,
} from './statecraft-types'

export function ensureStatecraft(world: World): Statecraft {
  world.statecraft ??= {
    nextId: 1,
    revision: 0,
    agents: [],
    messages: [],
    offers: [],
    rulings: [],
    audit: [],
  }
  const state = world.statecraft
  for (const nation of world.nations)
    if (!state.agents.some((agent) => agent.nation === nation.id))
      state.agents.push({
        nation: nation.id,
        assessment: 'A new government is assessing its circumstances.',
        strategy: 'Preserve the state, sustain its population, and establish diplomatic relations.',
        memory: '',
        goals: [],
        nextDecision: world.month + 1,
        nextStrategy: world.month + 1,
        lastDecision: 0,
        lastStrategy: 0,
        lastModel: '',
        escalation: 'Initial strategic assessment',
        integrity: 100,
        lastMessage: 0,
      })
  return state
}
const alive = (world: World, id: number) =>
  !!world.nations[id] && world.regions.some((region) => region.nation === id)
function log(world: World, title: string, detail: string, nation: number, visibility: Visibility = 'public') {
  if (visibility === 'secret') return
  world.events.unshift({
    id: world.nextEvent++,
    month: world.month,
    type: 'diplomacy',
    title,
    detail,
    nation,
  })
  world.events = world.events.slice(0, 240)
}
function sanction(world: World, nation: number, message: string, severity = 1) {
  const state = ensureStatecraft(world),
    agent = state.agents.find((entry) => entry.nation === nation)!
  severity = clamp(Math.round(severity), 1, 3)
  agent.integrity = Math.max(0, agent.integrity - severity * 5)
  world.nations[nation].legitimacy = Math.max(0, world.nations[nation].legitimacy - severity)
  agent.escalation = `Authority violation: ${message}. The referee has applied institutional consequences. Never repeat this attempt.`
  state.audit.unshift({
    id: state.nextId++,
    month: world.month,
    nation,
    visibility: 'secret',
    message,
    severity,
  })
  state.audit = state.audit.slice(0, 240)
  state.revision++
}
function notifyParties(world: World, offer: DiplomaticOffer, reason: string) {
  for (const id of offer.parties) {
    if (id === offer.author && reason.startsWith('New diplomatic proposal:')) continue
    const agent = ensureStatecraft(world).agents.find((entry) => entry.nation === id)
    if (agent) {
      agent.escalation = reason
      agent.nextDecision = Math.min(agent.nextDecision, world.month)
    }
  }
}

function validateTerms(world: World, terms: DiplomaticClause[], parties: number[], resolved = false) {
  let creation = false
  const requireParty = (id: number) => {
    if (id === -1 && creation && resolved) return
    if (!world.nations[id] || !parties.includes(id))
      throw new Error('A state cannot dispose of a non-signatory state’s assets or authority.')
  }
  for (const term of terms) {
    requireParty(term.from)
    if (term.to !== -1) {
      if (!world.nations[term.to]) throw new Error('Unknown diplomatic counterpart.')
      if (!['war', 'custom', 'guarantee'].includes(term.kind)) requireParty(term.to)
    } else if (!['create', 'custom'].includes(term.kind) && !creation)
      throw new Error('A new state must be constituted before it can receive assets.')
    if (term.kind === 'create') {
      if (!term.text.trim() || !term.regions.length)
        throw new Error('State creation needs a name and territory.')
      creation = true
    }
    if (['cede', 'create'].includes(term.kind)) {
      if (!term.regions.length || new Set(term.regions).size !== term.regions.length)
        throw new Error('Territorial terms need distinct provinces.')
      for (const id of term.regions)
        if (!world.regions[id] || world.regions[id].nation !== term.from)
          throw new Error('A state may only offer territory it currently controls.')
    }
    if (
      ['payment', 'tribute', 'goods', 'research'].includes(term.kind) &&
      (term.amount <= 0 || term.from === term.to)
    )
      throw new Error('Transfers need a positive amount and distinct parties.')
    if (term.kind === 'goods' && !term.good) throw new Error('A supply obligation needs a good.')
    if (term.kind === 'research' && (!term.field || term.amount > 30))
      throw new Error('Research cooperation needs a field and at most 30 knowledge units monthly.')
    if (term.kind === 'merge' && term.from === term.to) throw new Error('A state cannot merge with itself.')
  }
}
function fingerprint(offer: Pick<DiplomaticOffer, 'title' | 'parties' | 'terms' | 'visibility'>, id: number) {
  return `${id}:${hashSeed(JSON.stringify([offer.title, offer.visibility, offer.parties, offer.terms])).toString(16)}`
}
function executeOrder(world: World, nation: number, order: DomesticOrder) {
  const n = world.nations[nation]
  if (!n.ai) return // Human policy interventions remain authoritative.
  let command: Command
  if (order.kind === 'commission') {
    if (world.regions[order.target]?.nation !== nation || !['warship', 'transport'].includes(order.key))
      throw new Error('Commission ships at an owned port, specifying warship or transport.')
    command = {
      type: 'commission',
      nation,
      region: order.target,
      warships: order.key === 'warship' ? order.value : 0,
      transports: order.key === 'transport' ? order.value : 0,
    }
  } else if (order.kind === 'naval') {
    if (
      !world.warfare?.fleets.some((f) => f.id === order.target && f.nation === nation) ||
      !['patrol', 'escort', 'blockade', 'transport', 'return'].includes(order.key)
    )
      throw new Error('Naval orders require an owned fleet and a supported mission.')
    command = {
      type: 'fleet-order',
      fleet: order.target,
      target: order.value,
      mission: order.key as 'patrol' | 'escort' | 'blockade' | 'transport' | 'return',
    }
  } else if (order.kind === 'embark') {
    if (
      !world.armies.some((a) => a.id === order.target && a.nation === nation) ||
      !world.warfare?.fleets.some((f) => f.id === order.value && f.nation === nation)
    )
      throw new Error('Embarkation requires an army and fleet under your command.')
    command = { type: 'embark', army: order.target, fleet: order.value }
  } else if (order.kind === 'army') {
    if (!world.armies.some((a) => a.id === order.target && a.nation === nation))
      throw new Error('Standing orders require an owned army.')
    command = {
      type: 'army-orders',
      army: order.target,
      stance: order.key as 'march' | 'hold' | 'entrench',
      conduct: order.text as 'restrained' | 'requisition',
    }
  } else if (order.kind === 'identity') {
    if (!['culture', 'language', 'belief'].includes(order.key))
      throw new Error('Unknown official identity field.')
    command = {
      type: 'identity-policy',
      nation,
      key: order.key as 'culture' | 'language' | 'belief',
      identity: order.target,
    }
  } else if (order.kind === 'policy') {
    const key = order.key as keyof Policies
    if (!Object.hasOwn(n.policies, key)) throw new Error('Unknown domestic policy.')
    let value: Policies[keyof Policies] = order.value
    if (key === 'migration') {
      if (!['open', 'controlled', 'closed'].includes(order.text)) throw new Error('Unknown migration rule.')
      value = order.text as Policies['migration']
    } else if (['citizenship', 'languagePolicy', 'beliefPolicy'].includes(key)) {
      const allowed: Record<string, string[]> = {
        citizenship: ['civic', 'pluralist', 'heritage'],
        languagePolicy: ['local', 'common', 'multilingual'],
        beliefPolicy: ['protected', 'favored', 'restricted'],
      }
      if (!allowed[key].includes(order.text)) throw new Error('Unknown identity policy.')
      value = order.text as Policies[keyof Policies]
    } else if (key === 'priority') {
      if (!['balanced', 'agriculture', 'industry', 'military'].includes(order.text))
        throw new Error('Unknown production priority.')
      value = order.text as Policies['priority']
    }
    command = { type: 'policy', nation, key, value }
  } else if (order.kind === 'research') {
    if (!FIELDS.includes(order.text as (typeof FIELDS)[number])) throw new Error('Unknown research field.')
    command = { type: 'research', nation, field: order.text as (typeof FIELDS)[number] }
  } else if (order.kind === 'move') {
    if (
      !world.armies.some((army) => army.id === order.target && army.nation === nation) ||
      !world.regions[order.value]
    )
      throw new Error('An agent may only command its own armies toward real provinces.')
    command = { type: 'move', army: order.target, target: order.value }
  } else {
    if (world.regions[order.target]?.nation !== nation)
      throw new Error('An agent may only recruit or invest in its own provinces.')
    if (order.kind === 'recruit') command = { type: 'recruit', nation, region: order.target }
    else {
      if (!['farm', 'industry', 'road', 'school'].includes(order.text))
        throw new Error('Unknown improvement.')
      command = {
        type: 'build',
        region: order.target,
        building: order.text as 'farm' | 'industry' | 'road' | 'school',
      }
    }
  }
  try {
    applyCommand(world, command)
  } finally {
    n.ai = true
  }
}

export function acceptStatePlan(
  world: World,
  nation: number,
  input: unknown,
  strategic: boolean,
  model: string,
  requestedMonth: number,
  knowledge?: {
    owners: Record<number, number>
    armies: number[]
    fleets?: number[]
    seenMessage?: number
    offers?: number[]
    leaderGeneration?: number
  },
) {
  const plan: StateAgentPlan = parseStatePlan(input, strategic),
    state = ensureStatecraft(world),
    agent = state.agents.find((entry) => entry.nation === nation)!
  if (!alive(world, nation)) return
  if (
    knowledge?.leaderGeneration !== undefined &&
    knowledge.leaderGeneration !== world.nations[nation].character?.leader.generation
  ) {
    agent.escalation =
      'Strategic review requested: leadership changed during deliberation. Reassess the inherited situation.'
    agent.nextDecision = world.month
    return
  }
  agent.assessment = plan.assessment
  agent.memory = plan.memory
  agent.goals = plan.goals
  if (strategic || !agent.strategy) agent.strategy = plan.strategy
  agent.lastDecision = world.month
  agent.lastModel = model
  agent.nextDecision = world.month + 3
  if (strategic) {
    agent.lastStrategy = world.month
    agent.nextStrategy = world.month + 12
    agent.escalation = ''
  } else if (plan.escalate)
    agent.escalation = `Decision model requests strategic review: ${plan.reason || 'A strategic assessment is needed.'}`
  for (const order of plan.orders) {
    try {
      executeOrder(world, nation, order)
    } catch (error) {
      const stale =
        knowledge &&
        ((['build', 'recruit', 'commission'].includes(order.kind) &&
          knowledge.owners[order.target] === nation &&
          world.regions[order.target]?.nation !== nation) ||
          (order.kind === 'move' &&
            knowledge.armies.includes(order.target) &&
            !world.armies.some((army) => army.id === order.target && army.nation === nation)))
      const changedReadiness =
        error instanceof Error &&
        /Shipbuilding needs|does not have enough transport|must share an accessible|blockade requires war|fleets need port access|landing needs military|no navigable sea|already operates eight/.test(
          error.message,
        )
      const lostFleet =
        order.kind === 'naval' &&
        knowledge?.fleets?.includes(order.target) &&
        !world.warfare?.fleets.some((f) => f.id === order.target && f.nation === nation)
      if (stale || changedReadiness || lostFleet)
        agent.escalation = 'The world changed during deliberation; update the planned domestic action.'
      else sanction(world, nation, error instanceof Error ? error.message : 'Invalid domestic authority.')
    }
  }
  for (const message of plan.messages) {
    if (
      message.to.some((id) => !alive(world, id) || id === nation) ||
      new Set(message.to).size !== message.to.length
    ) {
      sanction(world, nation, 'Invalid or forged diplomatic recipients.')
      continue
    }
    if (
      message.offer &&
      !state.offers.some(
        (offer) =>
          offer.id === message.offer && (offer.visibility === 'public' || offer.parties.includes(nation)),
      )
    ) {
      sanction(
        world,
        nation,
        'A message referenced a confidential or nonexistent offer outside this state’s knowledge.',
      )
      continue
    }
    state.messages.push({ id: state.nextId++, month: world.month, from: nation, ...message })
    for (const recipient of message.to) {
      const target = state.agents.find((entry) => entry.nation === recipient)!
      target.nextDecision = Math.min(target.nextDecision, world.month)
      if (message.offer) target.escalation = 'A diplomatic negotiation requires a strategic response.'
    }
  }
  state.messages = state.messages.slice(-360)
  for (const draft of plan.offers) {
    try {
      if (
        !draft.parties.includes(nation) ||
        draft.parties.some((id) => !alive(world, id)) ||
        new Set(draft.parties).size !== draft.parties.length
      )
        throw new Error('Every offer needs its real author and distinct living parties.')
      validateTerms(world, draft.terms, draft.parties)
      if (
        draft.supersedes &&
        !state.offers.some(
          (offer) =>
            offer.id === draft.supersedes &&
            (offer.visibility === 'public' || offer.parties.includes(nation)),
        )
      )
        throw new Error('A counteroffer must reference a known proposal.')
      const id = state.nextId++,
        digest = fingerprint(draft, id),
        offer: DiplomaticOffer = {
          id,
          author: nation,
          month: world.month,
          title: draft.title,
          visibility: draft.visibility,
          parties: draft.parties,
          terms: draft.terms,
          digest,
          signatures: [{ nation, digest, month: world.month }],
          status: 'proposed',
          supersedes: draft.supersedes,
          expires: world.month + draft.duration,
          activated: 0,
          ends: 0,
          ruling: '',
          resolved: [],
          breaches: 0,
          delivered: 0,
        }
      state.offers.push(offer)
      notifyParties(world, offer, `New diplomatic proposal: ${offer.title}`)
    } catch (error) {
      const stale =
        knowledge &&
        draft.terms.some((term) =>
          term.regions.some(
            (id) => knowledge.owners[id] === term.from && world.regions[id]?.nation !== term.from,
          ),
        )
      if (stale) agent.escalation = 'Territorial control changed during negotiation; draft fresh terms.'
      else sanction(world, nation, error instanceof Error ? error.message : 'Invalid offer authority.')
    }
  }
  for (const answer of plan.answers) {
    const offer = state.offers.find((entry) => entry.id === answer.offer)
    if (
      offer &&
      offer.status !== 'proposed' &&
      offer.parties.includes(nation) &&
      offer.digest === answer.digest
    )
      continue
    if (!offer || !offer.parties.includes(nation) || offer.digest !== answer.digest) {
      sanction(world, nation, 'Attempted to change consent for unknown, altered or unauthorized terms.')
      continue
    }
    if (answer.answer === 'accept') {
      if (!offer.signatures.some((signature) => signature.nation === nation))
        offer.signatures.push({ nation, digest: offer.digest, month: world.month })
    } else if (answer.answer === 'withdraw' && offer.author !== nation)
      sanction(world, nation, 'Only the author can withdraw its proposal.')
    else {
      offer.status = answer.answer === 'withdraw' ? 'withdrawn' : 'rejected'
      offer.ruling = answer.reason
      notifyParties(world, offer, `Proposal ${offer.status}: ${offer.title}`)
    }
  }
  agent.lastMessage = Math.max(agent.lastMessage, knowledge?.seenMessage ?? 0)
  agent.seenOffers = [...new Set([...(agent.seenOffers ?? []), ...(knowledge?.offers ?? [])])].slice(-240)
  if (
    state.messages.some((message) => message.id > agent.lastMessage && message.to.includes(nation)) ||
    state.offers.some(
      (offer) =>
        offer.status === 'proposed' &&
        offer.author !== nation &&
        offer.parties.includes(nation) &&
        knowledge?.offers &&
        !knowledge.offers.includes(offer.id),
    )
  ) {
    agent.escalation = 'New diplomatic correspondence arrived during deliberation.'
    agent.nextDecision = world.month
  }
  // requestedMonth is retained in the narrative memory to make deliberation lag explicit.
  if (world.month > requestedMonth + 3)
    agent.assessment += ` (Deliberation began in month ${requestedMonth}; actions were checked again in month ${world.month}.)`
  state.revision++
  summarize(world, false)
}

export function readyOffers(world: World) {
  return ensureStatecraft(world).offers.filter(
    (offer) =>
      offer.status === 'proposed' &&
      (offer.reviewAfter ?? 0) <= world.month &&
      offer.parties.every((id) =>
        offer.signatures.some((signature) => signature.nation === id && signature.digest === offer.digest),
      ),
  )
}
function transferProvince(world: World, id: number, from: number, to: number) {
  const province = world.regions[id]
  if (!province || province.nation !== from)
    throw new Error('The territorial situation changed during negotiations.')
  province.nation = to
  province.unrest = clamp(province.unrest + 8, 0, 100)
}
function normalizeStates(world: World) {
  for (const nation of world.nations) {
    const provinces = world.regions.filter((region) => region.nation === nation.id)
    if (provinces.length && !provinces.some((region) => region.id === nation.capital))
      nation.capital = provinces.sort((a, b) => population(b) - population(a))[0].id
    if (!provinces.length)
      for (const army of allForces(world).filter((entry) => entry.nation === nation.id)) {
        returnArmyPeople(world, army, world.regions[army.region])
      }
  }
  for (const army of world.armies) {
    const at = world.regions[army.region]
    if (
      at.nation !== army.nation &&
      relation(world, at.nation, army.nation)?.treaty !== 'war' &&
      relation(world, at.nation, army.nation)?.treaty !== 'alliance'
    ) {
      army.region = world.nations[army.nation].capital
      army.target = null
    }
  }
  world.armies = world.armies.filter((army) => army.soldiers > 0)
  if (world.warfare) {
    world.warfare.fleets = world.warfare.fleets.filter((f) => f.soldiers > 0)
    world.warfare.revision++
  }
  ensurePopulation(world)
  ensureHistory(world)
}
function applyTerms(world: World, offer: DiplomaticOffer, terms: DiplomaticClause[]) {
  let created = -1
  const resolve = (id: number) => (id === -1 ? created : id)
  for (const term of terms) {
    const from = resolve(term.from)
    let to = resolve(term.to)
    if (term.kind === 'create') {
      if (world.nations.length >= 64)
        throw new Error('The simulation currently supports at most 64 historical state identities.')
      const founder = world.nations[from],
        nation = makeNation(world.nations.length, term.regions[0])
      nation.name = term.text
      nation.shortName = term.text.slice(0, 40)
      nation.treasury = 0
      nation.debt = 0
      nation.policies = { ...founder.policies }
      nation.technologies = { ...founder.technologies }
      nation.researchFocus = founder.researchFocus
      world.nations.push(nation)
      created = nation.id
      to = created
      for (const other of world.nations.slice(0, -1))
        world.relations.push({
          a: other.id,
          b: created,
          opinion: 0,
          treaty: 'neutral',
          since: world.month,
          warExhaustion: 0,
          grievance: 0,
        })
      for (const id of term.regions) transferProvince(world, id, from, to)
      const funding = term.amount
      if (founder.treasury < funding) throw new Error('The founder cannot fund the new state as agreed.')
      founder.treasury -= funding
      nation.treasury += funding
    } else if (term.kind === 'cede') {
      for (const id of term.regions) transferProvince(world, id, from, to)
    } else if (term.kind === 'merge') {
      if (!world.nations[to] || from === to) throw new Error('Invalid successor state.')
      for (const region of world.regions.filter((entry) => entry.nation === from))
        transferProvince(world, region.id, from, to)
      for (const army of allForces(world)) if (army.nation === from) army.nation = to
      world.nations[to].treasury += world.nations[from].treasury
      world.nations[from].treasury = 0
      world.nations[to].debt += world.nations[from].debt
      world.nations[from].debt = 0
      if (term.text.trim()) {
        world.nations[to].name = term.text
        world.nations[to].shortName = term.text.slice(0, 40)
      }
    } else if (term.kind === 'payment') {
      if (world.nations[from].treasury < term.amount)
        throw new Error('A signatory no longer has the promised funds.')
      world.nations[from].treasury -= term.amount
      world.nations[to].treasury += term.amount
    } else if (['trade', 'alliance', 'peace', 'war'].includes(term.kind)) {
      const rel = relation(world, from, to)
      if (!rel) throw new Error('A diplomatic counterpart no longer exists.')
      if (term.kind === 'war') {
        rel.treaty = 'war'
        rel.opinion = Math.min(-50, rel.opinion)
        rel.warExhaustion = 0
      } else if (term.kind === 'peace') {
        rel.treaty = 'truce'
        rel.warExhaustion = 0
        for (const army of world.armies) if ([from, to].includes(army.nation)) army.target = null
      } else if (offer.visibility === 'public') rel.treaty = term.kind as 'trade' | 'alliance'
      rel.since = world.month
    }
    // Recurring clauses retain concrete successor IDs after creation.
    term.from = from
    term.to = to
  }
  normalizeStates(world)
}

export function acceptRefereeDecision(
  world: World,
  input: unknown,
  submitted: { id: number; digest: string }[],
  model: string,
) {
  const decision: RefereeDecision = parseReferee(input),
    state = ensureStatecraft(world),
    seen = new Set<number>()
  for (const ruling of decision.rulings) {
    const offer = state.offers.find((entry) => entry.id === ruling.offer)
    if (
      seen.has(ruling.offer) ||
      !offer ||
      !submitted.some((entry) => entry.id === offer.id && entry.digest === ruling.digest) ||
      ruling.digest !== offer.digest ||
      offer.status !== 'proposed'
    )
      continue
    seen.add(ruling.offer)
    if (
      !offer.parties.every((id) =>
        offer.signatures.some((signature) => signature.nation === id && signature.digest === offer.digest),
      )
    )
      continue
    let verdict = ruling.verdict,
      reasoning = ruling.reasoning
    let appliedEffects: typeof ruling.effects = []
    try {
      // Re-check live ownership, consent and funds, independent of model approval.
      validateTerms(world, offer.terms, offer.parties)
      const resolved = offer.terms
        .filter((term) => term.kind !== 'custom')
        .map((term) => structuredClone(term))
      if (ruling.resolved.length && !offer.terms.some((term) => term.kind === 'custom'))
        throw new Error('The referee cannot rewrite signed standard terms.')
      validateTerms(world, ruling.resolved, offer.parties, true)
      resolved.push(...ruling.resolved.map((term) => structuredClone(term)))
      const effects = ruling.effects.map((effect) => validateHistoricalEffect(world, effect))
      if (effects.some((effect) => effect.stat === 'treasury'))
        throw new Error(
          'Financial consequences must use explicit, conserved transfers, not treasury multipliers.',
        )
      if (effects.some((effect) => effect.scope === 'nation' && !offer.parties.includes(effect.target)))
        throw new Error('National authority changes require a participating government.')
      if (verdict === 'approve') {
        const trial: World = {
          ...world,
          nations: structuredClone(world.nations),
          regions: structuredClone(world.regions),
          relations: structuredClone(world.relations),
          armies: structuredClone(world.armies),
          warfare: structuredClone(world.warfare),
          historical: structuredClone(world.historical),
          events: [...world.events],
        }
        applyTerms(trial, offer, resolved)
        const before =
            world.regions.reduce((sum, region) => sum + population(region), 0) +
            allForces(world).reduce((sum, army) => sum + army.soldiers, 0),
          after =
            trial.regions.reduce((sum, region) => sum + population(region), 0) +
            allForces(trial).reduce((sum, army) => sum + army.soldiers, 0)
        if (before !== after) throw new Error('Settlement would violate population accounting.')
        const fundsBefore = world.nations.reduce((sum, nation) => sum + nation.treasury, 0),
          fundsAfter = trial.nations.reduce((sum, nation) => sum + nation.treasury, 0)
        if (Math.abs(fundsAfter - fundsBefore) > 1e-6)
          throw new Error('Settlement would create or destroy treasury funds.')
        world.nations = trial.nations
        world.regions = trial.regions
        world.relations = trial.relations
        world.armies = trial.armies
        world.warfare = trial.warfare
        world.historical = trial.historical
        offer.status = 'ratified'
        offer.activated = world.month
        offer.resolved = resolved
        const ongoing = resolved.filter((term) =>
          [
            'tribute',
            'goods',
            'trade',
            'alliance',
            'peace',
            'nonaggression',
            'access',
            'guarantee',
            'research',
          ].includes(term.kind),
        )
        offer.ends =
          ongoing.length === 0
            ? world.month + 1
            : ongoing.some((term) => term.duration === 0)
              ? 0
              : world.month + Math.max(...ongoing.map((term) => term.duration))
        appliedEffects = effects
        applyRefereeEffects(
          world,
          effects,
          offer.title,
          reasoning,
          offer.author,
          offer.visibility === 'secret',
        )
        ensureStatecraft(world)
      } else if (verdict === 'reject') offer.status = 'rejected'
      else offer.expires = Math.max(offer.expires, world.month + 3)
      for (const violation of ruling.misconduct)
        if (offer.parties.includes(violation.nation))
          sanction(world, violation.nation, violation.reason, violation.severity)
    } catch (error) {
      verdict = 'defer'
      reasoning = `Live-state verification: ${error instanceof Error ? error.message : 'The proposal must be renegotiated.'}`
      notifyParties(world, offer, reasoning)
    }
    offer.ruling = reasoning
    state.rulings.unshift({
      id: state.nextId++,
      month: world.month,
      offer: offer.id,
      visibility: offer.visibility,
      parties: offer.parties,
      verdict,
      reasoning,
      model,
      effects: appliedEffects,
    })
    if (verdict !== 'approve')
      log(world, `${offer.title}: ${verdict}`, reasoning, offer.author, offer.visibility)
    notifyParties(world, offer, `Referee ${verdict}: ${offer.title}`)
  }
  state.rulings = state.rulings.slice(0, 180)
  state.revision++
  summarize(world, false)
}

export function advanceStatecraft(world: World) {
  const state = ensureStatecraft(world)
  for (const offer of state.offers) {
    if (
      offer.status === 'proposed' &&
      (offer.parties.some((id) => !alive(world, id)) ||
        (offer.expires < world.month &&
          !offer.parties.every((id) =>
            offer.signatures.some(
              (signature) => signature.nation === id && signature.digest === offer.digest,
            ),
          ) &&
          offer.parties.every(
            (id) =>
              id === offer.author ||
              state.agents.find((agent) => agent.nation === id)?.seenOffers?.includes(offer.id),
          )))
    ) {
      offer.status = 'expired'
      state.revision++
    }
    if (offer.status === 'ratified' && offer.ends && offer.ends <= world.month) {
      offer.status = 'expired'
      state.revision++
      notifyParties(world, offer, `Agreement expired: ${offer.title}`)
    }
  }
  for (const offer of state.offers)
    for (const term of offer.resolved)
      if (
        offer.visibility === 'public' &&
        ['trade', 'alliance'].includes(term.kind) &&
        (offer.status !== 'ratified' || (term.duration > 0 && offer.activated + term.duration <= world.month))
      ) {
        const rel = relation(world, term.from, term.to)
        if (
          rel?.treaty === term.kind &&
          !agreementTerms(world, term.kind).some(
            ({ offer: other, term: active }) =>
              other.id !== offer.id &&
              [active.from, active.to].includes(term.from) &&
              [active.from, active.to].includes(term.to),
          )
        )
          rel.treaty = 'neutral'
      }
  for (const { offer, term } of agreementTerms(world)) {
    if (!alive(world, term.from) || !alive(world, term.to)) continue
    if (term.kind === 'tribute') {
      const amount = Math.min(world.nations[term.from].treasury, term.amount)
      world.nations[term.from].treasury -= amount
      world.nations[term.to].treasury += amount
      if (amount + 1e-6 < term.amount) {
        offer.breaches++
        if (offer.breaches % 3 === 1) notifyParties(world, offer, `Obligation shortfall: ${offer.title}`)
      }
    } else if (term.kind === 'research' && term.field)
      world.nations[term.to].researchProgress[term.field] += Math.min(
        term.amount,
        world.nations[term.from].budget.research / 20,
      )
  }
  if (state.offers.length > 240) {
    state.offers = retainAgreementReferences(state)
  }
}

export function stateAgentContext(world: World, nation: number, strategic: boolean) {
  const state = ensureStatecraft(world),
    n = world.nations[nation],
    agent = state.agents.find((entry) => entry.nation === nation)!,
    visible = state.offers.filter((offer) => offer.visibility === 'public' || offer.parties.includes(nation)),
    inbox = state.messages
      .filter(
        (message) =>
          message.visibility === 'public' || message.to.includes(nation) || message.from === nation,
      )
      .slice(-(strategic ? 24 : 6))
  const { character: _profile, personality: _legacyPersonality, ...government } = n
  const currentOffers = visible
    .filter((offer) => offer.status === 'proposed' || offer.status === 'ratified')
    .slice(-30)
  const referenceTexts = [
    agent.assessment,
    agent.strategy,
    agent.memory,
    ...agent.goals,
    ...inbox.flatMap((message) => [message.subject, message.body, agreementReference(message.offer)]),
    ...currentOffers.flatMap((offer) => [
      offer.title,
      offer.ruling,
      agreementReference(offer.supersedes),
      ...offer.terms.map((term) => term.text),
    ]),
  ]
  return {
    month: world.month,
    nation,
    strategic,
    government,
    character: characterContext(n),
    agent: {
      strategy: agent.strategy,
      memory: agent.memory,
      goals: agent.goals,
      integrity: agent.integrity,
      escalation: agent.escalation,
    },
    populationIdentity: populationIdentitySummary(world, nation),
    society: ensureHistory(world).societies.find((entry) => entry.nation === nation),
    provinces: world.regions
      .filter((region) => region.nation === nation)
      .map((region) => ({
        id: region.id,
        name: region.name,
        people: population(region),
        food: region.foodCoverage,
        unrest: region.unrest,
        infrastructure: region.infrastructure,
        industry: region.industry,
        stocks: region.stocks,
        port: !!portAt(world, region.id),
      })),
    // Leaders receive operational forces and the summarized census, not every troop community.
    armies: world.armies
      .filter((army) => army.nation === nation)
      .map(({ communities: _census, ...army }) => army),
    fleets:
      world.warfare?.fleets
        .filter((f) => f.nation === nation)
        .map(({ communities: _crew, ...fleet }) => fleet) ?? [],
    foreignStates: world.nations
      .filter((entry) => entry.id !== nation && alive(world, entry.id))
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        government: entry.government,
        character: characterContext(entry, true),
        population: entry.population,
        stability: entry.stability,
        armySize: world.armies
          .filter((army) => army.nation === entry.id)
          .reduce((sum, army) => sum + army.soldiers, 0),
        navy:
          world.warfare?.fleets
            .filter((f) => f.nation === entry.id)
            .map((f) => ({
              id: f.id,
              cell: f.cell,
              warships: f.warships,
              transports: f.transports,
              hull: f.hull,
            })) ?? [],
        relation: relation(world, nation, entry.id),
      })),
    map: strategic
      ? world.regions.map((region) => ({
          id: region.id,
          name: region.name,
          nation: region.nation,
          neighbors: region.neighbors,
          coastal: region.coastal,
        }))
      : [],
    inbox,
    offers: currentOffers.map((offer) => ({ ...offer, reference: agreementReference(offer.id) })),
    agreementReferences: agreementReferenceIndex(visible, referenceTexts),
    recentPublicHistory: world.events
      .filter((event) => event.nation === nation || event.type === 'war' || event.type === 'peace')
      .slice(0, 8),
    rulings: state.rulings
      .filter((ruling) => ruling.visibility === 'public' || ruling.parties.includes(nation))
      .slice(0, 8),
    warnings: state.audit.filter((entry) => entry.nation === nation).slice(0, 4),
  }
}
export function refereeContext(world: World, offers: DiplomaticOffer[]) {
  return {
    month: world.month,
    submitted: offers.map((offer) => ({ ...offer, reference: agreementReference(offer.id) })),
    agreementReferences: agreementReferenceIndex(
      ensureStatecraft(world).offers,
      offers.flatMap((offer) => [
        offer.title,
        offer.ruling,
        agreementReference(offer.supersedes),
        ...offer.terms.map((term) => term.text),
      ]),
    ),
    groundTruth: {
      nations: world.nations.map((nation) => ({ ...nation, character: characterContext(nation) })),
      identities: world.nations
        .filter((nation) => alive(world, nation.id))
        .map((nation) => ({ nation: nation.id, ...populationIdentitySummary(world, nation.id) })),
      provinces: world.regions.map((region) => ({
        id: region.id,
        name: region.name,
        nation: region.nation,
        cultures: identityDistribution(region.communities ?? [], 'culture').slice(0, 3),
        socialCohesion: region.populationDynamics?.cohesion,
        population: population(region),
        coastal: region.coastal,
        terrain: region.terrain,
        neighbors: region.neighbors,
        unrest: region.unrest,
        infrastructure: region.infrastructure,
        stocks: region.stocks,
      })),
      armies: world.armies.map(({ communities: _census, ...army }) => army),
      fleets: world.warfare?.fleets.map(({ communities: _crew, ...fleet }) => fleet) ?? [],
      relations: world.relations,
    },
    agreements: currentAgreements(world).map((offer) => ({
      ...offer,
      reference: agreementReference(offer.id),
    })),
    messages: ensureStatecraft(world).messages.slice(-40),
    institutions: world.historical?.societies,
    recentHistory: world.events.slice(0, 12),
  }
}
