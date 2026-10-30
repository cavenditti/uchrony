/** Host-controlled permissions are independent of friendship and signed treaties.
 * Explicit restrictions take precedence; restoring treaty rules revives valid grants. */
import { relation, type Relation, type World } from './types'

export const TRADE_POLICIES = ['normal', 'restricted', 'embargo'] as const
export const MILITARY_POLICIES = ['treaties', 'closed', 'transit', 'supply', 'basing'] as const
export type MilitaryPermission = 'transit' | 'supply' | 'basing'
/** Each side controls entry into its own territory and commerce with the counterpart. */
export interface BorderPolicy {
  trade: (typeof TRADE_POLICIES)[number]
  military: (typeof MILITARY_POLICIES)[number]
}
export const DEFAULT_BORDER_POLICY: Readonly<BorderPolicy> = { trade: 'normal', military: 'treaties' }
export const MILITARY_LEVEL = { closed: 0, transit: 1, supply: 2, basing: 3 } as const

/** Missing policies preserve the behavior of existing saves. */
export function borderPolicy(rel: Relation | undefined, host: number): Readonly<BorderPolicy> {
  return (rel && (rel.a === host ? rel.aPolicy : rel.bPolicy)) ?? DEFAULT_BORDER_POLICY
}

/** Replace a complete record so settlement trials can safely share old policy objects. */
export function setBorderPolicy(w: World, host: number, other: number, policy: BorderPolicy) {
  const rel = relation(w, host, other)
  if (!rel || !TRADE_POLICIES.includes(policy.trade) || !MILITARY_POLICIES.includes(policy.military))
    throw new Error('Choose another state and valid trade and military permissions.')
  const previous = borderPolicy(rel, host)
  if (previous.trade === policy.trade && previous.military === policy.military) return
  rel[rel.a === host ? 'aPolicy' : 'bPolicy'] = { ...policy }
  // Closing a formerly usable border carries a diplomatic cost only on change.
  if (
    (policy.trade === 'embargo' && previous.trade !== 'embargo') ||
    (policy.military === 'closed' && previous.military !== 'closed')
  )
    rel.opinion = Math.max(-100, rel.opinion - 8)
}

/** Save validation accepts only complete, known policy records. */
export function validBorderPolicy(value: unknown): value is BorderPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const p = value as BorderPolicy
  return TRADE_POLICIES.includes(p.trade) && MILITARY_POLICIES.includes(p.military)
}
