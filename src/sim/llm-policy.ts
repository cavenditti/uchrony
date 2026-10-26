/** Runtime permission is deliberately absent from world saves. */
export interface LlmPolicySnapshot {
  instance: string
  enabled: boolean
  forcedOff: boolean
  generation: number
  dispatched: number
  cancelled: number
  active: number
}
export const OFF_POLICY: LlmPolicySnapshot = {
  instance: '',
  enabled: false,
  forcedOff: false,
  generation: 0,
  dispatched: 0,
  cancelled: 0,
  active: 0,
}
export interface ModelProvenance {
  accepted: number
  lastMonth: number
  roles: Record<string, number>
  source: 'native' | 'model-assisted' | 'legacy-unknown'
}

export function samePermission(policy: LlmPolicySnapshot, generation: number, instance = policy.instance) {
  return (
    policy.enabled && !policy.forcedOff && policy.generation === generation && policy.instance === instance
  )
}
