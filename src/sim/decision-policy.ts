import { createGroupScope } from './configuration-context'
import { DEFAULT_CONFIGURATION_VALUES, DECISION_POLICIES } from './configuration-defaults'
import { validateConfigurationValues } from './configuration'
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

export { DECISION_POLICIES }

/**
 * Legacy named policies (`legacy`, `circulation`, `renewal`) omit optional fields
 * (`development`, `agriculture`, `foodSatiation`) so `foodSatiation === undefined`
 * can disable diet saturation in `householdDemand`. When validating a policy
 * candidate against the full `ConfigurationValues['decisions']` schema, we fill
 * omitted optional fields with valid defaults while preserving the caller's
 * exact `policy` object inside the experiment scope.
 */
const scope = createGroupScope<DecisionPolicy>(
  (values) => values.decisions,
  (policy) => {
    validateConfigurationValues({
      decisions: {
        ...DEFAULT_CONFIGURATION_VALUES.decisions,
        ...policy,
        development: policy.development ?? false,
        agriculture: policy.agriculture ?? false,
        foodSatiation: policy.foodSatiation ?? DEFAULT_CONFIGURATION_VALUES.decisions.foodSatiation,
      },
    })
  },
)

export const decisionPolicy = scope.get
export const withDecisionPolicy = scope.withScope

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
