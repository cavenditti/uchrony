import { validateAdvisor } from './advisors'
import { validateHistoricalEffect } from './history-schema'
import {
  integerValidator,
  numberValidator,
  recordValue,
  textValidator,
  validationFailure,
  worldValidators,
} from './persistence-primitives'
import { hashSeed } from './random'
import { CLAUSE_SCHEMA, checkSchema } from './statecraft-schema'
import type { World } from './types'
import { DOMESTIC_ORDER_KINDS } from './statecraft-types'

/** Model-authored text is data; consent and ownership ledgers have independent validation. */
export function validateStatecraft(world: World) {
  const state = world.statecraft
  if (!state) return
  const fail = validationFailure('Invalid statecraft save: ', '', ''),
    object = recordValue,
    number = numberValidator(0, 1e12),
    integer = integerValidator(0, 1e12, false),
    text = textValidator(Infinity, 0),
    nation = worldValidators(world).nationId,
    visibility = (value: string) => ['public', 'secret'].includes(value),
    ids = new Set<number>(),
    id = (value: number) => {
      if (!integer(value, 1, state.nextId - 1) || ids.has(value))
        fail('duplicate or invalid document identity')
      ids.add(value)
    }
  if (
    !object(state) ||
    !integer(state.nextId, 1) ||
    !integer(state.revision) ||
    !Array.isArray(state.agents) ||
    state.agents.length !== world.nations.length ||
    !Array.isArray(state.messages) ||
    state.messages.length > 360 ||
    !Array.isArray(state.offers) ||
    // Active agreements and their cited ancestors cannot be discarded. The
    // diplomatic graph grows with state pairs, not with the initial 32 states.
    state.offers.length > Math.max(4096, world.nations.length * (world.nations.length - 1) * 2) ||
    !Array.isArray(state.rulings) ||
    state.rulings.length > 180 ||
    !Array.isArray(state.audit) ||
    state.audit.length > 240
  )
    fail('invalid collections')
  const agents = new Set<number>()
  for (const agent of state.agents) {
    if (
      !object(agent) ||
      !nation(agent.nation) ||
      agents.has(agent.nation) ||
      !text(agent.assessment, 1800) ||
      !text(agent.strategy, 1800) ||
      !text(agent.memory, 2000) ||
      !Array.isArray(agent.goals) ||
      agent.goals.length > 5 ||
      agent.goals.some((goal) => !text(goal, 160)) ||
      !integer(agent.nextDecision, 0, world.month + 12) ||
      !integer(agent.nextStrategy, 0, world.month + 24) ||
      !integer(agent.lastDecision, 0, world.month) ||
      !integer(agent.lastStrategy, 0, world.month) ||
      !text(agent.lastModel, 160) ||
      !text(agent.escalation, 2000) ||
      !number(agent.integrity, 0, 100) ||
      !integer(agent.lastMessage)
    )
      fail('invalid government memory')
    if (
      agent.seenOffers !== undefined &&
      (!Array.isArray(agent.seenOffers) ||
        agent.seenOffers.length > 240 ||
        agent.seenOffers.some((id) => !integer(id, 1)))
    )
      fail('invalid diplomatic review memory')
    validateAdvisor(world, agent)
    if (
      agent.orderResults !== undefined &&
      (!Array.isArray(agent.orderResults) ||
        agent.orderResults.length > 12 ||
        agent.orderResults.some(
          (r) =>
            !object(r) ||
            !integer(r.month, 0, world.month) ||
            !DOMESTIC_ORDER_KINDS.includes(r.kind) ||
            !integer(r.target, -1, 1e9) ||
            !text(r.result, 600),
        ))
    )
      fail('invalid domestic order results')
    agents.add(agent.nation)
  }
  for (const message of state.messages) {
    id(message.id)
    if (
      !object(message) ||
      !integer(message.month, 0, world.month) ||
      !nation(message.from) ||
      !Array.isArray(message.to) ||
      message.to.length > 8 ||
      message.to.some((entry) => !nation(entry)) ||
      !visibility(message.visibility) ||
      !text(message.subject, 120) ||
      !text(message.body, 1200) ||
      !integer(message.offer)
    )
      fail('invalid correspondence')
  }
  for (const offer of state.offers) {
    id(offer.id)
    if (
      !object(offer) ||
      !nation(offer.author) ||
      !integer(offer.month, 0, world.month) ||
      !text(offer.title, 140) ||
      !visibility(offer.visibility) ||
      !Array.isArray(offer.parties) ||
      !offer.parties.includes(offer.author) ||
      offer.parties.some((entry) => !nation(entry)) ||
      new Set(offer.parties).size !== offer.parties.length ||
      !Array.isArray(offer.terms) ||
      offer.terms.length > 12 ||
      !Array.isArray(offer.resolved) ||
      offer.resolved.length > 28 ||
      !Array.isArray(offer.signatures) ||
      !['proposed', 'ratified', 'rejected', 'withdrawn', 'expired', 'breached'].includes(offer.status) ||
      !integer(offer.expires) ||
      (offer.notBefore !== undefined && !integer(offer.notBefore, offer.month, offer.month + 240)) ||
      !integer(offer.activated, 0, world.month) ||
      !integer(offer.ends) ||
      !integer(offer.supersedes) ||
      !text(offer.ruling, 3000) ||
      !integer(offer.breaches) ||
      !number(offer.delivered)
    )
      fail('invalid agreement')
    const digest = `${offer.id}:${hashSeed(JSON.stringify([offer.title, offer.visibility, offer.parties, offer.terms])).toString(16)}`
    if (offer.digest !== digest) fail('agreement terms changed after signature')
    const signatures = new Set<number>()
    for (const signature of offer.signatures) {
      if (
        !offer.parties.includes(signature.nation) ||
        signatures.has(signature.nation) ||
        signature.digest !== digest ||
        !integer(signature.month, offer.month, world.month)
      )
        fail('invalid or forged assent')
      signatures.add(signature.nation)
    }
    if (offer.status === 'ratified' && offer.parties.some((party) => !signatures.has(party)))
      fail('ratification without all required consent')
    for (const term of [...offer.terms, ...offer.resolved]) {
      checkSchema(CLAUSE_SCHEMA, term)
      if (
        !nation(term.from) ||
        (term.to !== -1 && !nation(term.to)) ||
        term.regions.some((entry) => !world.regions[entry])
      )
        fail('invalid agreement target')
    }
  }
  for (const ruling of state.rulings) {
    id(ruling.id)
    if (
      !object(ruling) ||
      !integer(ruling.month, 0, world.month) ||
      !integer(ruling.offer, 1) ||
      !visibility(ruling.visibility) ||
      !Array.isArray(ruling.parties) ||
      ruling.parties.some((entry) => !nation(entry)) ||
      !text(ruling.verdict, 20) ||
      !text(ruling.reasoning, 3000) ||
      !text(ruling.model, 160) ||
      !Array.isArray(ruling.effects) ||
      ruling.effects.length > 16
    )
      fail('invalid adjudication')
    for (const effect of ruling.effects) validateHistoricalEffect(world, effect)
  }
  for (const entry of state.audit) {
    id(entry.id)
    if (
      !object(entry) ||
      !nation(entry.nation) ||
      !integer(entry.month, 0, world.month) ||
      !visibility(entry.visibility) ||
      !text(entry.message, 2000) ||
      !integer(entry.severity, 0, 3)
    )
      fail('invalid institutional audit')
  }
}
