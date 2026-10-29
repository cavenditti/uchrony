import { configurationValues } from './configuration-context'
import { simulationMonths } from './simulation-period'
import { economicRegions } from './local-units'
import { population, type World } from './types'

/** A small, deterministic policy over observable economic conditions. Offline
 * policy search changes these bounded weights, never the conservation rules. */
export interface DecisionPolicy {
  renewal: boolean
  realCosts: boolean
  merchantRelease: number
  workDisutility: number
  investmentShare: number
  investmentAdjustment: number
  readiness: number
  warThreshold: number
  foodSatiation?: number
  agriculture?: boolean
  development?: boolean
}
export { DECISION_POLICIES } from './configuration-defaults'
let current: Readonly<DecisionPolicy> | undefined
export const decisionPolicy = () => current ?? configurationValues().decisions
export function withDecisionPolicy<T>(policy: Readonly<DecisionPolicy>, run: () => T): T {
  if (policy.development !== undefined && typeof policy.development !== 'boolean')
    throw new Error('Invalid development policy switch')
  if (policy.agriculture !== undefined && typeof policy.agriculture !== 'boolean')
    throw new Error('Invalid agricultural policy switch')
  if (typeof policy.renewal !== 'boolean' || typeof policy.realCosts !== 'boolean')
    throw new Error('Invalid decision policy switches')
  if (
    policy.foodSatiation !== undefined &&
    (!Number.isFinite(policy.foodSatiation) || policy.foodSatiation < 1 || policy.foodSatiation > 3)
  )
    throw new Error('Invalid food satiation')
  for (const key of [
    'merchantRelease',
    'workDisutility',
    'investmentShare',
    'investmentAdjustment',
    'readiness',
    'warThreshold',
  ] as const)
    if (!Number.isFinite(policy[key]) || policy[key] < 0 || policy[key] > 1)
      throw new Error('Invalid decision policy')
  const previous = current
  current = policy
  try {
    return run()
  } finally {
    current = previous
  }
}

/** Prices are nominal. Labor obligations follow current domestic wages, with
 * no lower bound in opening-world currency and no hidden foreign information. */
export function domesticMonthlyWage(w: World, nation: number) {
  let wages = 0,
    people = 0
  for (const unit of economicRegions(w)) {
    if (unit.nation !== nation || !population(unit)) continue
    const wage = w.economy?.producers[unit.id]?.wage
    if (!wage || wage <= 0) continue
    wages += wage * population(unit)
    people += population(unit)
  }
  return people ? wages / people / simulationMonths() : 0.0015
}
export const recruitmentCost = (w: World, nation: number) =>
  decisionPolicy().realCosts ? domesticMonthlyWage(w, nation) * 6 : 0.2
