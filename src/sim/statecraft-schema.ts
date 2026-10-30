import { MAX_PROVINCES } from './scale'
import { INSTITUTION_POWERS, INSTITUTION_OPERATIONS, PROVINCIAL_POWERS } from './institutions'
import { MAX_STATE_IDENTITIES } from './types'
import { FIELDS, GOODS } from './types'
import { HISTORICAL_EFFECT_SCHEMA } from './history-schema'
import { DOMESTIC_ORDER_KINDS, type StateAgentPlan, type RefereeDecision } from './statecraft-types'

type Schema = {
  type?: string
  properties?: Record<string, Schema>
  required?: string[]
  additionalProperties?: boolean
  items?: Schema
  maxItems?: number
  minItems?: number
  enum?: readonly unknown[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  anyOf?: Schema[]
}
const text = (maxLength: number): Schema => ({ type: 'string', maxLength })
const num = (minimum: number, maximum: number, integer = false): Schema => ({
  type: integer ? 'integer' : 'number',
  minimum,
  maximum,
})
const en = (values: readonly string[]): Schema => ({ type: 'string', enum: values })
const obj = (properties: Record<string, Schema>, optional: string[] = []): Schema => ({
  type: 'object',
  properties,
  required: Object.keys(properties).filter((key) => !optional.includes(key)),
  additionalProperties: false,
})
const arr = (items: Schema, maxItems: number, minItems = 0): Schema => ({
  type: 'array',
  items,
  maxItems,
  minItems,
})
const nation = num(0, MAX_STATE_IDENTITIES - 1, true),
  id = num(0, 1e12, true)
const clauseProperties = {
  kind: en([
    'payment',
    'tribute',
    'goods',
    'trade',
    'preferential-trade',
    'alliance',
    'peace',
    'nonaggression',
    'access',
    'transit',
    'basing',
    'guarantee',
    'cede',
    'merge',
    'royal-marriage',
    'personal-union',
    'create',
    'research',
    'custom',
    'war',
  ]),
  from: nation,
  to: num(-1, MAX_STATE_IDENTITIES - 1, true),
  amount: num(0, 1e8),
  good: en(['', ...GOODS]),
  field: en(['', ...FIELDS]),
  regions: arr(num(0, MAX_PROVINCES - 1, true), MAX_PROVINCES),
  duration: num(0, 240, true),
  text: text(1000),
}
export const CLAUSE_SCHEMA: Schema = {
  anyOf: [
    obj(clauseProperties),
    obj({
      ...clauseProperties,
      kind: en(['institution']),
      charter: obj(
        {
          operation: en(INSTITUTION_OPERATIONS),
          id,
          powers: arr(en(INSTITUTION_POWERS), 5),
          form: en([
            'defense-league',
            'customs-union',
            'research-community',
            'confederation',
            'federation',
            'bespoke',
          ]),
          rule: en(['unanimity', 'majority', 'weighted']),
          contribution: num(0, 0.15),
          exit: en(['free', 'notice']),
          defense: en(['military', 'aid', 'either']),
          responseMonths: num(1, 24, true),
        },
        ['defense', 'responseMonths'],
      ),
    }),
    obj({
      ...clauseProperties,
      kind: en(['devolution']),
      delegation: obj({ powers: arr(en(PROVINCIAL_POWERS), 4) }),
    }),
  ],
}

export function stateAgentSchema(strategic: boolean): Schema {
  return obj({
    adviceResponses: arr(obj({ advice: num(1, 1e12, true), response: text(400) }), 4),
    assessment: text(strategic ? 1000 : 400),
    strategy: text(strategic ? 1800 : 600),
    memory: text(strategic ? 2000 : 800),
    goals: arr(text(160), 5),
    escalate: { type: 'boolean' },
    reason: text(300),
    orders: arr(
      obj({
        kind: en(DOMESTIC_ORDER_KINDS),
        target: num(-1, 1e9, true),
        key: text(24),
        value: num(0, 1e9),
        text: text(180),
      }),
      strategic ? 6 : 2,
    ),
    messages: arr(
      obj({
        to: arr(nation, 8, 1),
        visibility: en(['public', 'secret']),
        subject: text(120),
        body: text(1200),
        offer: id,
      }),
      strategic ? 4 : 1,
    ),
    offers: arr(
      obj({
        title: text(140),
        visibility: en(['public', 'secret']),
        parties: arr(nation, 32, 1),
        terms: arr(CLAUSE_SCHEMA, 12, 1),
        supersedes: id,
        duration: num(1, 120, true),
      }),
      strategic ? 3 : 0,
    ),
    answers: arr(
      obj({ offer: id, digest: text(40), answer: en(['accept', 'reject', 'withdraw']), reason: text(500) }),
      6,
    ),
  })
}
export const REFEREE_SCHEMA = obj({
  rulings: arr(
    obj({
      offer: id,
      digest: text(40),
      verdict: en(['approve', 'reject', 'defer']),
      reasoning: text(1800),
      resolved: arr(CLAUSE_SCHEMA, 16),
      effects: arr(HISTORICAL_EFFECT_SCHEMA as Schema, 16),
      misconduct: arr(obj({ nation, reason: text(600), severity: num(1, 3, true) }), 8),
    }),
    6,
  ),
})

/** The same contract is checked locally even when a provider claims strict JSON support. */
export function checkSchema(schema: Schema, value: unknown, path = 'response', depth = 0): void {
  const fail = (reason: string): never => {
    throw new Error(`Invalid agent data: ${path} ${reason}`)
  }
  if (depth > 18) fail('is nested too deeply')
  if (schema.anyOf) {
    for (const option of schema.anyOf) {
      try {
        checkSchema(option, value, path, depth + 1)
        return
      } catch {
        /* Try another permitted variant. */
      }
    }
    fail('does not match an allowed variant')
  }
  if (schema.enum && !schema.enum.includes(value)) fail('has an unsupported value')
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('must be an object')
    const record = value as Record<string, unknown>
    for (const key of schema.required ?? []) if (!Object.hasOwn(record, key)) fail(`is missing ${key}`)
    for (const [key, entry] of Object.entries(record)) {
      if (!Object.hasOwn(schema.properties ?? {}, key)) fail(`contains unsupported field ${key}`)
      checkSchema(schema.properties![key], entry, `${path}.${key}`, depth + 1)
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) fail('must be an array')
    const entries = value as unknown[]
    if (entries.length > (schema.maxItems ?? Infinity) || entries.length < (schema.minItems ?? 0))
      fail('has an invalid length')
    entries.forEach((entry, index) => checkSchema(schema.items!, entry, `${path}[${index}]`, depth + 1))
  } else if (schema.type === 'string') {
    if (
      typeof value !== 'string' ||
      value.length > (schema.maxLength ?? Infinity) ||
      value.length < (schema.minLength ?? 0)
    )
      fail('must be a bounded string')
  } else if (schema.type === 'number' || schema.type === 'integer') {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < (schema.minimum ?? -Infinity) ||
      value > (schema.maximum ?? Infinity) ||
      (schema.type === 'integer' && !Number.isInteger(value))
    )
      fail('must be a number within its units')
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') fail('must be boolean')
}
export function parseStatePlan(value: unknown, strategic: boolean): StateAgentPlan {
  // Older saved/in-flight plans predate advisory feedback.
  const plan =
    value && typeof value === 'object' && !Array.isArray(value) ? { adviceResponses: [], ...value } : value
  checkSchema(stateAgentSchema(strategic), plan)
  return structuredClone(plan) as StateAgentPlan
}
export function parseReferee(value: unknown): RefereeDecision {
  checkSchema(REFEREE_SCHEMA, value)
  return structuredClone(value) as RefereeDecision
}
