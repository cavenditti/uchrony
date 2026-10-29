import { reconcileInstitutions } from './institution-lifecycle'
import {
  reserveCabinetOrder,
  setCabinetAgenda,
  STRATEGIC_POSTURES,
  type StrategicPosture,
} from './cabinet-state'
import { knownMap } from './intelligence'
/** Consent and live resource checks precede an isolated trial; only a conserved
 * settlement is committed. Prompt projection lives in statecraft-context. */
import { deliverAdvice, validateAdviceReplies } from './advisors'
import { retainAgreementReferences } from './agreement-references'
import { agreementTerms, diplomaticAccess } from './agreements'
import { applyCommand } from './commands'
import {
  admitDiplomaticConsent,
  admitDiplomaticMessage,
  DiplomaticFriction,
  hasActiveReplacement,
  openDiplomaticProposal,
  rememberProposal,
} from './diplomatic-friction'
import { aggregateDistricts, linkDistrictPeople } from './districts'
import { recordWorldEvent } from './event-memory'
import { allForces } from './forces'
import { makeNation } from './generate'
import { applyRefereeEffects, ensureHistory } from './history'
import { validateHistoricalEffect } from './history-schema'
import {
  applyInstitutionTerm,
  collectiveDefense,
  collectiveDefenseBeneficiary,
  foreignPolicyMandate,
  institutionalFunds,
  transferInstitutionMembership,
  validateInstitutionTerm,
} from './institutions'
import { INTELLIGENCE_PRIORITIES, type IntelligencePriority } from './intelligence'
import { publicTransfer, transferDebt } from './ledger'
import { inWorldText } from './narrative'
import { POLICY_RULES, policyCommandValue } from './policy-rules'
import { ensurePopulation, returnArmyPeople } from './population'
import { previousResearchOutput } from './public-services'
import { hashSeed } from './random'
import { commitSettlementTrialWorld, createSettlementTrialWorld } from './settlement-trial'
import { parseReferee, parseStatePlan } from './statecraft-schema'
import type {
  DiplomaticClause,
  DiplomaticOffer,
  DomesticOrder,
  RefereeDecision,
  StateAgentPlan,
  Statecraft,
  Visibility,
} from './statecraft-types'
import {
  clamp,
  FIELDS,
  MAX_STATE_IDENTITIES,
  population,
  relation,
  type Command,
  type Policies,
  type World,
} from './types'
import { summarize } from './world-summary'
export { admitDiplomaticConsent } from './diplomatic-friction'
export { refereeContext, stateAgentContext } from './statecraft-context'

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
  recordWorldEvent(world, {
    id: world.nextEvent++,
    month: world.month,
    type: 'diplomacy',
    title,
    detail,
    nation,
  })
}
function sanction(world: World, nation: number, message: string, severity = 1) {
  const state = ensureStatecraft(world),
    agent = state.agents.find((entry) => entry.nation === nation)!
  severity = clamp(Math.round(severity), 1, 3)
  agent.integrity = Math.max(0, agent.integrity - severity * 5)
  world.nations[nation].legitimacy = Math.max(0, world.nations[nation].legitimacy - severity)
  agent.escalation = `Diplomatic credibility damaged: ${inWorldText(message)}. Domestic institutions and counterparts have lost confidence in these commitments.`
  state.audit.unshift({
    id: state.nextId++,
    month: world.month,
    nation,
    visibility: 'secret',
    message: inWorldText(message),
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
    if (term.kind === 'institution' || term.kind === 'devolution') {
      validateInstitutionTerm(world, term, parties)
      continue
    }
    if (
      term.kind === 'war' &&
      !collectiveDefense(world, term.from, term.to) &&
      !world.relations.some(
        (rel) =>
          rel.treaty === 'war' &&
          rel.aggressor === term.to &&
          [rel.a, rel.b].includes(term.from) &&
          [rel.a, rel.b].includes(term.to),
      ) &&
      !foreignPolicyMandate(world, term.from, parties)
    )
      throw new Error(
        'Foreign policy is delegated; the charter requires member authorization for an offensive war.',
      )
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
  if (order.kind === 'strategy') {
    if (!STRATEGIC_POSTURES.includes(order.key as StrategicPosture))
      throw new Error('Unknown strategic posture.')
    const military = order.key === 'prepare-war' || order.key === 'wage-war'
    if (
      military &&
      (order.target === nation ||
        !alive(world, order.target) ||
        !knownMap(world, nation).some((r) => r.nation === order.target))
    )
      throw new Error('Choose a known living rival for the campaign.')
    if (!military && order.target !== -1 && !world.regions[order.target])
      throw new Error('Choose a real province or -1.')
    setCabinetAgenda(
      world,
      n,
      order.key as StrategicPosture,
      order.target === -1 ? null : order.target,
      'model',
    )
    return `Cabinet directed to ${order.key}. Routine economic and security work continues.`
  } else if (order.kind === 'found') {
    const province = world.cells[order.target]?.region
    if (
      !Number.isInteger(order.target) ||
      province === undefined ||
      !knownMap(world, nation).some((r) => r.id === province)
    )
      throw new Error('Founding requires surveyed land.')
    if (![nation, -1].includes(world.regions[province].nation))
      throw new Error('That land belongs to another state.')
    command = { type: 'found-settlement', nation, cell: order.target, pioneer: true }
  } else if (order.kind === 'intelligence') {
    if (!INTELLIGENCE_PRIORITIES.includes(order.key as IntelligencePriority))
      throw new Error('Unknown intelligence collection priority.')
    command = {
      type: 'intelligence',
      nation,
      budgetShare: order.value / 100,
      priority: order.key as IntelligencePriority,
      focus: order.target === -1 ? null : order.target,
    }
  } else if (order.kind === 'commission') {
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
  } else if (order.kind === 'annex') {
    if (world.regions[order.target]?.control?.nation !== nation)
      throw new Error('Annexation requires your own military control.')
    command = { type: 'annex', nation, region: order.target }
  } else if (order.kind === 'army') {
    if (!world.armies.some((a) => a.id === order.target && a.nation === nation))
      throw new Error('Standing orders require an owned army.')
    command = {
      type: 'army-orders',
      army: order.target,
      stance: order.key as 'march' | 'hold' | 'entrench',
      conduct: order.text as 'restrained' | 'requisition' | 'pillage',
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
    const value = policyCommandValue(key, POLICY_RULES[key].kind === 'select' ? order.text : order.value)
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
      if (
        ![
          'farm',
          'food-works',
          'textile-works',
          'industry',
          'road',
          'school',
          'paved-road',
          'railway',
          'port',
        ].includes(order.text)
      )
        throw new Error('Unknown improvement.')
      command = {
        type: 'build',
        region: order.target,
        building: order.text as Extract<Command, { type: 'build' }>['building'],
      }
    }
  }
  try {
    const result = applyCommand(world, command)
    if (order.kind === 'policy') reserveCabinetOrder(world, n, `policy:${order.key}`)
    if (order.kind === 'research' && n.researchFocus === order.text) reserveCabinetOrder(world, n, 'research')
    if (
      order.kind === 'army' ||
      (order.kind === 'move' && world.armies.find((a) => a.id === order.target)?.target === order.value)
    )
      reserveCabinetOrder(world, n, `army:${order.target}`)
    return result
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
    advice?: number[]
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
  const advice = knowledge?.advice ?? [],
    replies = plan.adviceResponses ?? []
  validateAdviceReplies(advice, replies)
  deliverAdvice(world, agent, advice, replies)
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
      const result = executeOrder(world, nation, order)
      agent.orderResults = [
        ...(agent.orderResults ?? []),
        {
          month: world.month,
          kind: order.kind,
          target: order.target,
          result: (result ?? 'Manual government retains control.').slice(0, 600),
        },
      ].slice(-12)
    } catch (error) {
      const stale =
        knowledge &&
        ((order.kind === 'found' &&
          [nation, -1].includes(knowledge.owners[world.cells[order.target]?.region]) &&
          ![nation, -1].includes(world.regions[world.cells[order.target]?.region]?.nation)) ||
          (['build', 'recruit', 'commission'].includes(order.kind) &&
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
      agent.orderResults = [
        ...(agent.orderResults ?? []),
        {
          month: world.month,
          kind: order.kind,
          target: order.target,
          result: (error instanceof Error ? error.message : 'Order failed.').slice(0, 600),
        },
      ].slice(-12)
      const foundingReadiness =
        order.kind === 'found' &&
        error instanceof Error &&
        !/surveyed land|belongs to another state/.test(error.message)
      if (stale || changedReadiness || lostFleet || foundingReadiness)
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
    if (!admitDiplomaticMessage(world, nation, message)) continue
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
      const admission = openDiplomaticProposal(world, nation, draft),
        id = state.nextId++,
        digest = fingerprint(draft, id),
        offer: DiplomaticOffer = {
          id,
          author: nation,
          month: world.month,
          notBefore: admission.notBefore,
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
      rememberProposal(world, nation, draft, id, admission)
      notifyParties(world, offer, `New diplomatic proposal: ${offer.title}`)
    } catch (error) {
      if (error instanceof DiplomaticFriction) continue
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
      admitDiplomaticConsent(world, nation, offer)
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

export function submitStandingOffer(
  world: World,
  nation: number,
  proposal: StateAgentPlan['offers'][number],
  manual = false,
) {
  const state = ensureStatecraft(world)
  if (!alive(world, nation) || (!manual && !world.nations[nation].ai) || !proposal.parties.includes(nation))
    throw new Error('A standing cabinet can commit only its own government.')
  if (
    proposal.parties.length > 32 ||
    new Set(proposal.parties).size !== proposal.parties.length ||
    proposal.parties.some((id) => !Number.isInteger(id) || !alive(world, id))
  )
    throw new Error('A proposal needs distinct, active participating governments.')
  validateTerms(world, proposal.terms, proposal.parties)
  const admission = openDiplomaticProposal(world, nation, proposal)
  const offer: DiplomaticOffer = {
    ...structuredClone(proposal),
    id: state.nextId++,
    author: nation,
    month: world.month,
    notBefore: admission.notBefore,
    digest: '',
    signatures: [],
    status: 'proposed',
    expires: world.month + proposal.duration,
    activated: 0,
    ends: 0,
    ruling: '',
    resolved: [],
    breaches: 0,
    delivered: 0,
  }
  offer.digest = fingerprint(offer, offer.id)
  offer.signatures = [{ nation, digest: offer.digest, month: world.month }]
  state.offers.push(offer)
  rememberProposal(world, nation, proposal, offer.id, admission)
  state.revision++
  notifyParties(world, offer, `New diplomatic proposal: ${offer.title}`)
  return offer
}
export function tryStandingOffer(...args: Parameters<typeof submitStandingOffer>) {
  try {
    return submitStandingOffer(...args)
  } catch (error) {
    if (error instanceof DiplomaticFriction) return null
    throw error
  }
}
export function settleConventionalOffers(world: World) {
  const routine = new Set([
    'war',
    'trade',
    'alliance',
    'peace',
    'access',
    'nonaggression',
    'guarantee',
    'payment',
    'tribute',
    'goods',
    'research',
    'devolution',
    'institution',
  ])
  const conventional = (offer: DiplomaticOffer) =>
    offer.terms.length > 0 &&
    offer.terms.every(
      (term) =>
        routine.has(term.kind) || (term.kind === 'cede' && offer.terms.some((t) => t.kind === 'peace')),
    )
  for (const offer of readyOffers(world)) {
    if (!conventional(offer))
      offer.nativeReview =
        'Pending interpretation: these terms are outside native agreement rules. LLM assistance is optional; no agreement is assumed.'
  }
  const offers = readyOffers(world).filter(conventional).slice(0, 6)
  if (!offers.length) return
  acceptRefereeDecision(
    world,
    {
      rulings: offers.map((offer) => ({
        offer: offer.id,
        digest: offer.digest,
        verdict: 'approve',
        reasoning:
          'The participating governments implement their recorded commitments, subject to available resources and practical obligations.',
        resolved: [],
        effects: [],
        misconduct: [],
      })),
    },
    offers.map((offer) => ({ id: offer.id, digest: offer.digest })),
    'standing-institutions',
  )
}

export function readyOffers(world: World) {
  return ensureStatecraft(world).offers.filter(
    (offer) =>
      offer.status === 'proposed' &&
      (offer.notBefore ?? 0) <= world.month &&
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
  delete province.control
  delete province.occupation
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
      army.operations?.embarkedOn == null &&
      !diplomaticAccess(world, army.nation, at.nation) &&
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
    for (const army of world.armies)
      if (
        army.operations?.embarkedOn != null &&
        !world.warfare.fleets.some(
          (fleet) =>
            fleet.id === army.operations!.embarkedOn &&
            fleet.nation === army.nation &&
            fleet.embarked.includes(army.id),
        )
      )
        army.operations!.embarkedOn = null
    for (const fleet of world.warfare.fleets)
      fleet.embarked = fleet.embarked.filter((id) =>
        world.armies.some(
          (army) =>
            army.id === id && army.nation === fleet.nation && army.operations?.embarkedOn === fleet.id,
        ),
      )
    world.warfare.revision++
  }
  ensurePopulation(world)
  ensureHistory(world)
}
function applyTerms(world: World, offer: DiplomaticOffer, terms: DiplomaticClause[]) {
  let created = -1
  const resolve = (id: number) => (id === -1 ? created : id)
  for (const term of terms) {
    if (term.kind === 'institution' || term.kind === 'devolution') {
      applyInstitutionTerm(world, term, offer)
      continue
    }
    const from = resolve(term.from)
    let to = resolve(term.to)
    if (term.kind === 'create') {
      if (world.nations.length >= MAX_STATE_IDENTITIES)
        throw new Error(
          `The simulation currently supports at most ${MAX_STATE_IDENTITIES} historical state identities.`,
        )
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
      publicTransfer(world, founder.id, nation.id, funding, 'state founding')
    } else if (term.kind === 'cede') {
      for (const id of term.regions) transferProvince(world, id, from, to)
    } else if (term.kind === 'merge') {
      transferInstitutionMembership(world, from, to)
      if (!world.nations[to] || from === to) throw new Error('Invalid successor state.')
      for (const region of world.regions.filter((entry) => entry.nation === from))
        transferProvince(world, region.id, from, to)
      for (const army of allForces(world)) if (army.nation === from) army.nation = to
      publicTransfer(world, from, to, world.nations[from].treasury, 'state merger')
      transferDebt(world, from, to)
      if (term.text.trim()) {
        world.nations[to].name = term.text
        world.nations[to].shortName = term.text.slice(0, 40)
      }
    } else if (term.kind === 'payment') {
      if (world.nations[from].treasury < term.amount)
        throw new Error('A signatory no longer has the promised funds.')
      publicTransfer(world, from, to, term.amount, 'diplomatic payment')
    } else if (['trade', 'alliance', 'peace', 'war'].includes(term.kind)) {
      const rel = relation(world, from, to)
      if (!rel) throw new Error('A diplomatic counterpart no longer exists.')
      if (term.kind === 'war') {
        const beneficiary = collectiveDefenseBeneficiary(world, from, to)
        rel.treaty = 'war'
        rel.aggressor = beneficiary === undefined ? from : to
        if (beneficiary === undefined) delete rel.defenseOf
        else rel.defenseOf = beneficiary
        rel.opinion = Math.min(-50, rel.opinion)
        rel.warExhaustion = 0
      } else if (term.kind === 'peace') {
        rel.treaty = 'truce'
        rel.warExhaustion = 0
        for (const army of world.armies) if ([from, to].includes(army.nation)) army.target = null
        for (const r of world.regions)
          if (r.control && [from, to].includes(r.nation) && [from, to].includes(r.control.nation))
            delete r.control
      } else if (offer.visibility === 'public') rel.treaty = term.kind as 'trade' | 'alliance'
      rel.since = world.month
    }
    // Recurring clauses retain concrete successor IDs after creation.
    term.from = from
    term.to = to
  }
  if (
    terms.some((term) =>
      ['peace', 'cede', 'create', 'merge', 'institution', 'devolution'].includes(term.kind),
    )
  )
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
    if ((offer.notBefore ?? 0) > world.month) continue
    seen.add(ruling.offer)
    if (
      !offer.parties.every((id) =>
        offer.signatures.some((signature) => signature.nation === id && signature.digest === offer.digest),
      )
    )
      continue
    let verdict = ruling.verdict,
      reasoning = inWorldText(ruling.reasoning)
    let appliedEffects: typeof ruling.effects = []
    try {
      // Re-check live ownership, consent and funds, independent of model approval.
      validateTerms(world, offer.terms, offer.parties)
      const resolved = offer.terms
        .filter((term) => term.kind !== 'custom')
        .map((term) => structuredClone(term))
      if (ruling.resolved.length && !offer.terms.some((term) => term.kind === 'custom'))
        throw new Error('Signed standard terms cannot be rewritten after consent.')
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
        if (offer.supersedes && hasActiveReplacement(world, offer.supersedes, offer.id))
          throw new Error(
            'The negotiated source terms cannot support this replacement. Seek updated terms from the participating governments.',
          )
        const territorial = resolved.some((term) =>
          ['peace', 'cede', 'create', 'merge', 'institution', 'devolution'].includes(term.kind),
        )
        const trial = createSettlementTrialWorld(world, territorial)
        applyTerms(trial, offer, resolved)
        if (territorial && trial.localEconomy) {
          linkDistrictPeople(trial)
          aggregateDistricts(trial)
        }
        const before =
            world.regions.reduce((sum, region) => sum + population(region), 0) +
            allForces(world).reduce((sum, army) => sum + army.soldiers, 0),
          after =
            trial.regions.reduce((sum, region) => sum + population(region), 0) +
            allForces(trial).reduce((sum, army) => sum + army.soldiers, 0)
        if (before !== after) throw new Error('Settlement would violate population accounting.')
        const fundsBefore =
            world.nations.reduce((sum, nation) => sum + nation.treasury, 0) + institutionalFunds(world),
          fundsAfter =
            trial.nations.reduce((sum, nation) => sum + nation.treasury, 0) + institutionalFunds(trial)
        if (Math.abs(fundsAfter - fundsBefore) > 1e-6)
          throw new Error('Settlement would create or destroy treasury funds.')
        commitSettlementTrialWorld(world, trial)
        offer.status = 'ratified'
        offer.activated = world.month
        offer.resolved = resolved
        if (offer.supersedes) {
          const previous = state.offers.find((p) => p.id === offer.supersedes)
          if (
            previous &&
            previous.parties.every((id) => offer.parties.includes(id)) &&
            ['proposed', 'ratified'].includes(previous.status)
          ) {
            previous.status = 'expired'
            previous.ends = world.month
          }
        }
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
        reconcileTreatyRelations(world)
        reconcileInstitutions(world)
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
      reasoning = `Changed circumstances: ${error instanceof Error ? inWorldText(error.message) : 'The proposal must be renegotiated.'}`
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
    notifyParties(
      world,
      offer,
      `${verdict === 'approve' ? 'Agreement took effect' : verdict === 'reject' ? 'Proposal did not proceed' : 'Implementation delayed'}: ${offer.title}`,
    )
  }
  state.rulings = state.rulings.slice(0, 180)
  state.revision++
  summarize(world, false)
}

function reconcileTreatyRelations(world: World) {
  for (const offer of world.statecraft?.offers ?? [])
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
  reconcileTreatyRelations(world)
  for (const { offer, term } of agreementTerms(world)) {
    if (!alive(world, term.from) || !alive(world, term.to)) continue
    if (term.kind === 'tribute') {
      const amount = Math.min(world.nations[term.from].treasury, term.amount)
      publicTransfer(world, term.from, term.to, amount, 'recurring diplomatic payment')
      if (amount + 1e-6 < term.amount) {
        offer.breaches++
        if (offer.breaches % 3 === 1) notifyParties(world, offer, `Obligation shortfall: ${offer.title}`)
      }
    } else if (term.kind === 'research' && term.field)
      world.nations[term.to].researchProgress[term.field] += Math.min(
        term.amount,
        previousResearchOutput(world, term.from) / 20,
      )
  }
  if (state.offers.length > 240) {
    state.offers = retainAgreementReferences(
      state,
      world.institutions?.organizations.flatMap((o) => [
        o.sourceOffer,
        ...(o.events ?? []).flatMap((e) => (e.offer === undefined ? [] : [e.offer])),
      ]),
    )
  }
}
