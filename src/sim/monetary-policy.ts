/** Rates are annualized nominal fractions; inflation is annual log change.
 * A zero lower bound is a policy-regime assumption, not an inflation ceiling.
 */
export interface MonetaryPolicy {
  regime: 'inflation-target'
  target: number
  neutralRealRate: number
  referenceUnemployment: number
  inflationResponse: number
  unemploymentResponse: number
  inertia: number
  expectationAdjustment: number
  expectedInflation: number
  inflation: number
  logChanges: number[]
  lastMonth: number
}
export function policyRate(
  previousAnnual: number,
  inflation: number,
  unemployment: number,
  policy: Pick<
    MonetaryPolicy,
    | 'neutralRealRate'
    | 'target'
    | 'inflationResponse'
    | 'unemploymentResponse'
    | 'referenceUnemployment'
    | 'inertia'
  >,
) {
  const desired =
    policy.neutralRealRate +
    inflation +
    policy.inflationResponse * (inflation - policy.target) +
    policy.unemploymentResponse * (policy.referenceUnemployment - unemployment)
  return Math.max(0, policy.inertia * previousAnnual + (1 - policy.inertia) * desired)
}
export function newMonetaryPolicy(month: number): MonetaryPolicy {
  return {
    regime: 'inflation-target',
    target: 0.02,
    neutralRealRate: 0.02,
    referenceUnemployment: 0.04,
    inflationResponse: 0.5,
    unemploymentResponse: 1,
    inertia: 0.85,
    expectationAdjustment: 1 / 24,
    expectedInflation: 0.02,
    inflation: 0.02,
    logChanges: [],
    lastMonth: month,
  }
}
/** Observe only completed months. Missing opening history is filled with the
 * prior expectation, rather than annualizing one noisy monthly price change.
 */
export function observePrices(policy: MonetaryPolicy, change: number) {
  policy.logChanges.push(change)
  if (policy.logChanges.length > 12) policy.logChanges.shift()
  policy.inflation =
    policy.logChanges.reduce((a, b) => a + b, 0) +
    ((12 - policy.logChanges.length) * policy.expectedInflation) / 12
  policy.expectedInflation += policy.expectationAdjustment * (policy.inflation - policy.expectedInflation)
}

/** Annualized nominal loan cost less expected log inflation, per month. */
export function realFinancingRate(monthlyNominal: number, expectedAnnualInflation: number) {
  return (1 + monthlyNominal) * Math.exp(-expectedAnnualInflation / 12) - 1
}
