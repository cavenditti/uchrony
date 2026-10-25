/** Aggregate search-and-matching flows, in people per simulation period.
 * The min bounds express feasibility, not a target unemployment rate.
 */
export function matchJobs(unemployed: number, vacancies: number, efficiency: number, elasticity = 0.5) {
  if (unemployed <= 0 || vacancies <= 0) return 0
  return Math.min(
    unemployed,
    vacancies,
    efficiency * unemployed ** elasticity * vacancies ** (1 - elasticity),
  )
}

/** Staggered nominal wage contracts. Reservation income and productivity must
 * have the same units (currency per worker per period). A negative surplus does
 * not justify inventing a profitable job: hiring is screened separately.
 */
export function bargainWage(
  previous: number,
  reservation: number,
  productivity: number,
  bargainingPower: number,
  renegotiation: number,
  expectedInflationPerPeriod = 0,
) {
  const offer = reservation + bargainingPower * Math.max(0, productivity - reservation)
  return (1 - renegotiation) * previous * Math.exp(expectedInflationPerPeriod) + renegotiation * offer
}

/** Common flow law used by the historical aggregate benchmark and firms. */
export function retainedJobs(previous: number, desired: number, separation: number) {
  return Math.max(0, Math.min(desired, previous * (1 - separation)))
}

/** CRRA consumption utility and linear work disutility imply compensation
 * proportional to real consumption^riskAversion. The basket is a unit of
 * measurement, not guaranteed outside income. */
export function reservationWage(
  basketPerWorker: number,
  consumption: number,
  workDisutility: number,
  riskAversion: number,
) {
  return basketPerWorker * workDisutility * Math.max(0, consumption) ** riskAversion
}
