/** Synchronous integration scope. All persisted wages are monthly rates; goods and
 * accounting flows cover economy.periodMonths. No async work may enter this scope.
 * Keeping the one-month branch literal preserves the ordinary model's arithmetic.
 */
let months = 1
export const simulationMonths = () => months
export const periodFlow = (monthly: number) => (months === 1 ? monthly : monthly * months)
export const periodRate = (monthly: number) => (months === 1 ? monthly : 1 - (1 - monthly) ** months)
export const periodInterest = (monthly: number) => (months === 1 ? monthly : (1 + monthly) ** months - 1)
export function withSimulationPeriod<T>(duration: number, run: () => T): T {
  if (!Number.isInteger(duration) || duration < 1 || duration > 6)
    throw new Error('Invalid simulation interval')
  const previous = months
  months = duration
  try {
    return run()
  } finally {
    months = previous
  }
}

/** Does this integration interval include a staggered periodic review? */
export const crossedPeriodMonth = (month: number, offset: number, cycle: number) =>
  months === 1
    ? month % cycle === offset
    : Math.floor((month - offset) / cycle) > Math.floor((month - months - offset) / cycle)
