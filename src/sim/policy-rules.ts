/** Policy domains are shared by commands, agent orders, configuration and saves.
 * Opening/saved percentages allow experiments over 0–100; live cabinet decisions
 * retain their narrower gameplay limits. Unifying metadata must not rebalance worlds. */
import { IDENTITY_POLICY_KEYS } from './identity-policy'
import { clamp, type Policies } from './types'

type Rule<K extends keyof Policies> =
  NonNullable<Policies[K]> extends number
    ? { kind: 'number'; min: number; max: number; commandMin: number; commandMax: number; optional?: boolean }
    : { kind: 'select'; options: readonly NonNullable<Policies[K]>[]; optional?: boolean }
const budget = (commandMin = 0, commandMax = 80) => ({
  kind: 'number' as const,
  min: 0,
  max: 100,
  commandMin,
  commandMax,
})
export const POLICY_RULES = {
  tax: budget(5, 55),
  welfare: budget(),
  education: budget(),
  military: budget(),
  research: budget(),
  tariff: budget(0, 40),
  conscription: budget(0, 5),
  migration: { kind: 'select', options: ['open', 'controlled', 'closed'] },
  priority: { kind: 'select', options: ['balanced', 'agriculture', 'industry', 'military'] },
  ...(Object.fromEntries(
    IDENTITY_POLICY_KEYS.map((key) => [
      key,
      { kind: 'number', min: 0, max: 1, commandMin: 0, commandMax: 1, optional: true },
    ]),
  ) as Record<
    import('./identity-policy').IdentityPolicyKey,
    { kind: 'number'; min: number; max: number; commandMin: number; commandMax: number; optional: true }
  >),
  citizenship: { kind: 'select', options: ['civic', 'pluralist', 'heritage'], optional: true },
  languagePolicy: { kind: 'select', options: ['local', 'common', 'multilingual'], optional: true },
  beliefPolicy: { kind: 'select', options: ['protected', 'favored', 'restricted'], optional: true },
} as const satisfies { [K in keyof Policies]-?: Rule<K> }

/** Validate live input before mutation; numeric commands preserve historical clamping. */
export function policyCommandValue(
  key: keyof Policies,
  value: unknown,
): NonNullable<Policies[keyof Policies]> {
  if (!Object.hasOwn(POLICY_RULES, key)) throw new Error('Unknown policy.')
  const rule = POLICY_RULES[key]
  if (rule.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new Error('Policy values must be finite numbers.')
    return clamp(value, rule.commandMin, rule.commandMax)
  }
  if (typeof value !== 'string' || !(rule.options as readonly string[]).includes(value))
    throw new Error(
      'Invalid ' +
        (key === 'priority'
          ? 'production priority'
          : key === 'migration'
            ? 'migration policy'
            : 'identity policy') +
        '.',
    )
  return value as NonNullable<Policies[keyof Policies]>
}
/** Older saves may omit identity policy fields; required budget/enum fields stay strict. */
export function validSavedPolicy(key: keyof Policies, value: unknown): boolean {
  const rule = POLICY_RULES[key]
  if (value === undefined && 'optional' in rule && rule.optional) return true
  return rule.kind === 'number'
    ? typeof value === 'number' && Number.isFinite(value) && value >= rule.min && value <= rule.max
    : (value === undefined && 'optional' in rule) ||
        (typeof value === 'string' && (rule.options as readonly string[]).includes(value))
}
