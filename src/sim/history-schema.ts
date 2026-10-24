import { MAX_PROVINCES } from './scale'
import { MAX_STATE_IDENTITIES } from './types'
import { parseHistoryPatterns } from './history-repertoire'
import {
  CHANGE_STATS,
  HISTORY_CATEGORIES,
  MODIFIER_STATS,
  type HistoricalEffect,
  type HistoricalProposal,
  type HistoricalFollowUp,
  type HistoryCondition,
  type HistoricalState,
  type HistoricalRecord,
} from './history-types'
import { FIELDS, type World } from './types'

const string = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength })
const enumeration = (values: readonly string[]) => ({ type: 'string', enum: values })
const integer = (minimum: number, maximum: number) => ({ type: 'integer', minimum, maximum })
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})
const array = (items: unknown, maxItems: number) => ({ type: 'array', items, maxItems })
const effectProperties = {
  scope: enumeration(['world', 'nation', 'region', 'relation']),
  target: integer(-1, MAX_PROVINCES - 1),
  other: integer(-1, -1),
  delay: integer(0, 120),
  field: enumeration(['', ...FIELDS]),
  text: { type: 'string', maxLength: 180 },
}
export const HISTORICAL_EFFECT_SCHEMA = {
  anyOf: [
    object({
      ...effectProperties,
      kind: enumeration(['modifier']),
      scope: enumeration(['world', 'nation', 'region']),
      stat: enumeration(MODIFIER_STATS),
      amount: { type: 'number', minimum: -0.6, maximum: 0.8 },
      duration: integer(1, 240),
      curve: enumeration(['steady', 'fade', 'grow']),
      field: enumeration(['']),
      text: enumeration(['']),
    }),
    object({
      ...effectProperties,
      kind: enumeration(['change']),
      scope: enumeration(['world', 'nation', 'region']),
      stat: enumeration(CHANGE_STATS.filter((stat) => stat !== 'opinion')),
      amount: { type: 'number', minimum: -100, maximum: 100 },
      duration: integer(0, 0),
      curve: enumeration(['steady']),
      text: enumeration(['']),
    }),
    object({
      ...effectProperties,
      kind: enumeration(['change']),
      scope: enumeration(['relation']),
      target: integer(-1, MAX_STATE_IDENTITIES - 1),
      other: integer(-1, MAX_STATE_IDENTITIES - 1),
      stat: enumeration(['opinion']),
      amount: { type: 'number', minimum: -20, maximum: 20 },
      duration: integer(0, 0),
      curve: enumeration(['steady']),
      field: enumeration(['']),
      text: enumeration(['']),
    }),
    object({
      ...effectProperties,
      kind: enumeration(['leadership']),
      scope: enumeration(['nation']),
      stat: enumeration(['leader']),
      amount: integer(0, 0),
      duration: integer(0, 0),
      curve: enumeration(['steady']),
      field: enumeration(['']),
    }),
    object({
      ...effectProperties,
      kind: enumeration(['legacy']),
      scope: enumeration(['nation']),
      stat: enumeration(['literature', 'belief', 'institution']),
      amount: integer(0, 0),
      duration: integer(0, 0),
      curve: enumeration(['steady']),
      field: enumeration(['']),
    }),
  ],
}
const effectSchema = HISTORICAL_EFFECT_SCHEMA

const conditionSchema = object({
  metric: enumeration([
    'stability',
    'legitimacy',
    'treasury',
    'literacy',
    'foodCoverage',
    'unrest',
    'pluralism',
    'prestige',
    'tax',
    'wars',
  ]),
  comparison: enumeration(['above', 'below']),
  value: { type: 'number', minimum: 0, maximum: 1e10 },
})
const followUpSchema = object({
  afterMonths: integer(1, 120),
  withinMonths: integer(0, 36),
  probability: { type: 'number', minimum: 0, maximum: 1 },
  conditions: array(conditionSchema, 4),
  title: string(140),
  description: string(500),
  effects: array(effectSchema, 8),
})
export const HISTORICAL_EVENT_SCHEMA = object({
  category: enumeration(HISTORY_CATEGORIES),
  title: string(140),
  description: string(500),
  nation: integer(0, MAX_STATE_IDENTITIES - 1),
  region: integer(0, MAX_PROVINCES - 1),
  causeEvent: integer(0, 1e9),
  conditions: array(conditionSchema, 4),
  effects: array(effectSchema, 12),
  responses: array(
    object({
      name: string(100),
      rationale: string(240),
      affinity: enumeration(['reform', 'coercion', 'patronage', 'commerce', 'relief', 'neutral']),
      weight: { type: 'number', minimum: 0.1, maximum: 5 },
      conditions: array(conditionSchema, 4),
      effects: array(effectSchema, 8),
    }),
    3,
  ),
  followUps: array(followUpSchema, 2),
})

function fail(message: string): never {
  throw new Error(`Invalid historical event: ${message}`)
}
function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function finite(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}
function text(value: unknown, max: number) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max
}
function has(values: readonly string[], value: unknown) {
  return typeof value === 'string' && values.includes(value)
}

export function validateHistoricalEffect(world: World, value: unknown): HistoricalEffect {
  if (!isObject(value)) fail('expected an effect')
  const e = value as unknown as HistoricalEffect
  if (
    !has(['modifier', 'change', 'leadership', 'legacy'], e.kind) ||
    !has(['world', 'nation', 'region', 'relation'], e.scope) ||
    !Number.isInteger(e.target) ||
    !Number.isInteger(e.other) ||
    !finite(e.amount, -100, 100) ||
    !finite(e.duration, 0, 240) ||
    !Number.isInteger(e.duration) ||
    !finite(e.delay, 0, 120) ||
    !Number.isInteger(e.delay) ||
    !has(['steady', 'fade', 'grow'], e.curve) ||
    !has(['', ...FIELDS], e.field) ||
    typeof e.text !== 'string' ||
    e.text.length > 180
  )
    fail('malformed effect')
  if (
    e.scope === 'world'
      ? e.target !== -1
      : e.scope === 'region'
        ? !world.regions[e.target]
        : !world.nations[e.target]
  )
    fail('unknown effect target')
  if (e.scope === 'relation' ? !world.nations[e.other] || e.other === e.target : e.other !== -1)
    fail(`invalid relation target (scope=${e.scope}, target=${e.target}, other=${e.other})`)
  if (e.kind === 'modifier') {
    if (
      !has(MODIFIER_STATS, e.stat) ||
      e.scope === 'relation' ||
      !finite(e.amount, -0.6, 0.8) ||
      e.duration < 1 ||
      e.field !== '' ||
      e.text !== ''
    )
      fail('invalid duration or modifier')
  } else {
    if (e.duration !== 0 || e.curve !== 'steady') fail('only modifiers have duration or curves')
    if (e.kind === 'change') {
      const regional = ['unrest', 'literacy', 'health', 'happiness', 'devastation', 'infrastructure'],
        national = ['stability', 'legitimacy', 'treasury', 'researchProgress', 'prestige', 'pluralism']
      if (
        !has(CHANGE_STATS, e.stat) ||
        e.text !== '' ||
        (e.scope === 'relation' ? e.stat !== 'opinion' : e.stat === 'opinion') ||
        (has(national, e.stat) && e.scope !== 'nation') ||
        (e.scope === 'world' && !has(regional, e.stat)) ||
        (e.scope === 'region' && !has(regional, e.stat))
      )
        fail('stat does not apply to that scope')
      const limit =
        e.stat === 'researchProgress'
          ? 100
          : ['literacy', 'health', 'happiness', 'devastation', 'infrastructure'].includes(e.stat)
            ? 0.15
            : e.stat === 'treasury'
              ? 0.2
              : 20
      if (
        Math.abs(e.amount) > limit ||
        (e.stat === 'researchProgress'
          ? !FIELDS.includes(e.field as (typeof FIELDS)[number])
          : e.field !== '')
      )
        fail('change exceeds its units or limits')
    } else if (
      e.scope !== 'nation' ||
      e.amount !== 0 ||
      e.field !== '' ||
      !text(e.text, 180) ||
      (e.kind === 'leadership' ? e.stat !== 'leader' : !has(['literature', 'belief', 'institution'], e.stat))
    )
      fail('invalid cultural or leadership effect')
  }
  return {
    kind: e.kind,
    scope: e.scope,
    target: e.target,
    other: e.other,
    stat: e.stat,
    amount: e.amount,
    duration: e.duration,
    delay: e.delay,
    curve: e.curve,
    field: e.field,
    text: e.text,
  }
}

function conditions(value: unknown): HistoryCondition[] {
  if (!Array.isArray(value) || value.length > 4) fail('invalid conditions')
  return value.map((condition) => {
    if (
      !isObject(condition) ||
      !has(
        [
          'stability',
          'legitimacy',
          'treasury',
          'literacy',
          'foodCoverage',
          'unrest',
          'pluralism',
          'prestige',
          'tax',
          'wars',
        ],
        condition.metric,
      ) ||
      !has(['above', 'below'], condition.comparison) ||
      !finite(condition.value, 0, 1e10)
    )
      fail('invalid condition')
    return {
      metric: condition.metric,
      comparison: condition.comparison,
      value: condition.value,
    } as HistoryCondition
  })
}
function effects(world: World, value: unknown, max: number) {
  if (!Array.isArray(value) || value.length > max) fail('too many effects')
  return value.map((effect) => validateHistoricalEffect(world, effect))
}
export function validateFollowUp(world: World, value: unknown): HistoricalFollowUp {
  if (
    !isObject(value) ||
    !finite(value.afterMonths, 1, 120) ||
    !Number.isInteger(value.afterMonths) ||
    !finite(value.withinMonths, 0, 36) ||
    !Number.isInteger(value.withinMonths) ||
    !finite(value.probability, 0, 1) ||
    !text(value.title, 140) ||
    !text(value.description, 1800)
  )
    fail('invalid follow-up')
  return {
    afterMonths: value.afterMonths,
    withinMonths: value.withinMonths,
    probability: value.probability,
    conditions: conditions(value.conditions),
    title: value.title as string,
    description: value.description as string,
    effects: effects(world, value.effects, 8),
  }
}
export function validateHistoricalProposal(world: World, value: unknown): HistoricalProposal {
  if (!isObject(value)) fail('expected an event object')
  value = structuredClone(value)
  const candidate = value as unknown as HistoricalProposal
  for (const effect of [
    ...(Array.isArray(candidate.effects) ? candidate.effects : []),
    ...(Array.isArray(candidate.responses)
      ? candidate.responses.flatMap((response) => (Array.isArray(response.effects) ? response.effects : []))
      : []),
    ...(Array.isArray(candidate.followUps)
      ? candidate.followUps.flatMap((followUp) => (Array.isArray(followUp.effects) ? followUp.effects : []))
      : []),
  ]) {
    if (!isObject(effect)) continue
    if (effect.scope === 'relation') {
      // The actor is unambiguous; a foreign counterpart must still be supplied explicitly.
      if (effect.target === -1) effect.target = candidate.nation
      if (effect.other === -1) effect.other = candidate.nation
    } else if (['world', 'nation', 'region'].includes(String(effect.scope))) {
      if (effect.scope === 'nation' && effect.target === -1) effect.target = candidate.nation
      // This slot has no meaning outside a bilateral effect, even if a model echoed an ID into it.
      effect.other = -1
    }
  }
  const p = value as unknown as HistoricalProposal
  if (
    !has(HISTORY_CATEGORIES, p.category) ||
    !text(p.title, 140) ||
    !text(p.description, 1800) ||
    !Number.isInteger(p.nation) ||
    !world.nations[p.nation] ||
    !Number.isInteger(p.region) ||
    !world.regions[p.region] ||
    world.regions[p.region].nation !== p.nation ||
    !Number.isInteger(p.causeEvent) ||
    p.causeEvent < 0 ||
    p.causeEvent >= world.nextEvent ||
    !Array.isArray(p.responses) ||
    p.responses.length > 3 ||
    !Array.isArray(p.followUps) ||
    p.followUps.length > 2
  )
    fail('invalid event context')
  const responses = p.responses.map((response) => {
    if (
      !isObject(response) ||
      !text(response.name, 100) ||
      !text(response.rationale, 500) ||
      !has(['reform', 'coercion', 'patronage', 'commerce', 'relief', 'neutral'], response.affinity) ||
      !finite(response.weight, 0.1, 5)
    )
      fail('invalid government response')
    return {
      name: response.name,
      rationale: response.rationale,
      affinity: response.affinity,
      weight: response.weight,
      conditions: conditions(response.conditions),
      effects: effects(world, response.effects, 8),
    }
  })
  const proposal = {
    category: p.category,
    title: p.title.trim(),
    description: p.description.trim(),
    nation: p.nation,
    region: p.region,
    causeEvent: p.causeEvent,
    conditions: conditions(p.conditions ?? []),
    effects: effects(world, p.effects, 12),
    responses,
    followUps: p.followUps.map((followUp) => validateFollowUp(world, followUp)),
  } as HistoricalProposal
  if (
    !proposal.effects.length &&
    !responses.some((response) => response.effects.length && response.conditions.length === 0)
  )
    fail('an event needs an unconditional material consequence')
  // Context limits invented targets: local incidents may affect their state,
  // its provinces, a diplomatic partner, or the whole world explicitly.
  for (const effect of [
    ...proposal.effects,
    ...responses.flatMap((response) => response.effects),
    ...proposal.followUps.flatMap((followUp) => followUp.effects),
  ]) {
    if (effect.scope === 'region' && world.regions[effect.target].nation !== p.nation)
      fail('province outside the event context')
    if (effect.scope === 'nation' && effect.target !== p.nation) fail('unrelated national target')
    if (effect.scope === 'relation' && ![effect.target, effect.other].includes(p.nation))
      fail('unrelated diplomatic target')
  }
  return proposal
}

export function validateHistoricalRecord(world: World, value: unknown) {
  if (!isObject(value)) fail('invalid historical record')
  const record = value as unknown as HistoricalRecord
  if (
    !has(HISTORY_CATEGORIES, record.category) ||
    !has(['openrouter', 'procedural', 'consequence'], record.source) ||
    !text(record.model, 160) ||
    !finite(record.causeEvent, 0, world.nextEvent - 1) ||
    !Number.isInteger(record.causeEvent) ||
    typeof record.response !== 'string' ||
    record.response.length > 100 ||
    typeof record.rationale !== 'string' ||
    record.rationale.length > 500
  )
    fail('invalid historical provenance')
  effects(
    world,
    record.effects,
    record.source === 'procedural' && record.model === 'structural-pressures'
      ? Math.max(20, world.regions.length * 2)
      : 20,
  )
}
export function validateHistoryState(world: World, value: unknown) {
  if (!isObject(value)) fail('invalid historical state')
  const state = value as unknown as HistoricalState,
    integer = (n: unknown, min: number, max: number) => finite(n, min, max) && Number.isInteger(n),
    nation = (id: number) => integer(id, 0, world.nations.length - 1),
    region = (id: number) => integer(id, 0, world.regions.length - 1),
    event = (id: number) => integer(id, 1, world.nextEvent - 1)
  if (
    !integer(state.rng, 0, 0xffffffff) ||
    !integer(state.nextId, 1, 1e12) ||
    !integer(state.nextRoll, 0, world.month + 18) ||
    !Array.isArray(state.effects) ||
    state.effects.length > 8192 ||
    !Array.isArray(state.scheduled) ||
    state.scheduled.length > 256 ||
    !Array.isArray(state.societies) ||
    state.societies.length !== world.nations.length ||
    !Array.isArray(state.legacies) ||
    state.legacies.length > 120
  )
    fail('invalid historical collections')
  const ids = new Set<number>()
  for (const active of state.effects) {
    if (
      !isObject(active) ||
      !integer(active.id, 1, state.nextId - 1) ||
      ids.has(active.id) ||
      !event(active.event) ||
      !text(active.title, 140) ||
      !region(active.region) ||
      !integer(active.start, 0, world.month + 120) ||
      !integer(active.end, active.start + 1, world.month + 360)
    )
      fail('invalid active historical effect')
    ids.add(active.id)
    const effect = validateHistoricalEffect(world, active.effect)
    if (active.end - active.start !== (effect.kind === 'modifier' ? effect.duration : 1))
      fail('inconsistent effect duration')
  }
  for (const entry of state.scheduled) {
    if (
      !isObject(entry) ||
      !event(entry.event) ||
      !nation(entry.nation) ||
      !region(entry.region) ||
      !has(HISTORY_CATEGORIES, entry.category) ||
      !text(entry.model, 160) ||
      !integer(entry.due, 0, world.month + 120) ||
      !integer(entry.expires, entry.due, entry.due + 36) ||
      typeof entry.chance !== 'boolean'
    )
      fail('invalid scheduled historical consequence')
    validateFollowUp(world, entry.followUp)
  }
  const nations = new Set<number>()
  for (const society of state.societies) {
    if (
      !isObject(society) ||
      !nation(society.nation) ||
      nations.has(society.nation) ||
      !text(society.leader, 180) ||
      !text(society.tradition, 180) ||
      !integer(society.since, 0, world.month) ||
      !finite(society.prestige, 0, 100) ||
      !finite(society.pluralism, 0, 100)
    )
      fail('invalid historical society')
    nations.add(society.nation)
  }
  for (const legacy of state.legacies)
    if (
      !isObject(legacy) ||
      !event(legacy.event) ||
      !nation(legacy.nation) ||
      !region(legacy.region) ||
      !integer(legacy.month, 0, world.month) ||
      !has(['literature', 'belief', 'institution'], legacy.kind) ||
      !text(legacy.name, 180)
    )
      fail('invalid cultural memory')
  if (state.repertoire !== undefined) {
    parseHistoryPatterns(state.repertoire, 'saved-repertoire', 64)
    if (state.repertoire.some((pattern) => !text(pattern.model, 160))) fail('invalid repertoire provenance')
  }
  if (state.prepared !== undefined) {
    if (!Array.isArray(state.prepared) || state.prepared.length > 3)
      fail('invalid prepared historical accounts')
    for (const entry of state.prepared) {
      if (
        !isObject(entry) ||
        !text(entry.model, 160) ||
        !integer(entry.received, 0, world.month) ||
        !integer(entry.requested, 0, world.month) ||
        !isObject(entry.proposal) ||
        !nation(entry.proposal.nation) ||
        !region(entry.proposal.region)
      )
        fail('invalid prepared historical account')
      for (const effect of [
        ...entry.proposal.effects,
        ...entry.proposal.responses.flatMap((response) => response.effects),
        ...entry.proposal.followUps.flatMap((followUp) => followUp.effects),
      ])
        validateHistoricalEffect(world, effect)
    }
  }
  if (state.opportunity !== null) {
    const opportunity = state.opportunity
    if (
      !isObject(opportunity) ||
      !integer(opportunity.id, 1, state.nextId - 1) ||
      ids.has(opportunity.id) ||
      !integer(opportunity.month, 0, world.month) ||
      !nation(opportunity.nation) ||
      !region(opportunity.region) ||
      !has(HISTORY_CATEGORIES, opportunity.category) ||
      !integer(opportunity.seed, 0, 0xffffffff)
    )
      fail('invalid historical opportunity')
  }
}
