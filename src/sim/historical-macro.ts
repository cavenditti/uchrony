import { matchJobs, retainedJobs } from './labor-market'
import { policyRate } from './monetary-policy'

/** A quarterly aggregate research model, NOT a replacement for the spatial
 * stock-flow ledger. No observed outcomes appear in ForecastInput. */
export interface HistoricalObservation {
  quarter: string
  gdp: number
  prices: number
  unemployment: number
  laborForce: number
  policy: number
  oil: number
  inflation: number
  growth: number
}
export interface ForecastInput {
  quarter: string
  oil: number
  policy?: number
}
export interface MacroParameters {
  persistence: number
  interestSensitivity: number
  phillipsSlope: number
  expectationAdjustment: number
  energyPassThrough: number
  energyDemand: number
  matchingEfficiency: number
  separation: number
  employmentElasticity: number
}
export interface MacroCalibration {
  parameters: MacroParameters
  trend: { logGDP: number; growth: number; laborGrowth: number }
  referenceUnemployment: number
  neutralRealRate: number
  initial: HistoricalObservation
  trainingScore: number
  candidates: number
  trainingEnd: string
}
export interface MacroPoint extends HistoricalObservation {
  gap: number
  expectedInflation: number
  employment: number
  vacancies: number
  hires: number
  separations: number
}
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length
function trend(values: number[]) {
  const center = (values.length - 1) / 2,
    level = mean(values)
  const slope =
    values.reduce((s, y, i) => s + (i - center) * (y - level), 0) /
    values.reduce((s, _, i) => s + (i - center) ** 2, 0)
  return { intercept: level - slope * center, slope }
}

/** Backward-looking IS demand, expectations-augmented Phillips pricing and
 * search/matching employment. Calibrated coefficients are hypotheses, not
 * identified causal estimates. All decisions use the previous quarter's rate. */
export function projectMacro(calibration: MacroCalibration, inputs: readonly ForecastInput[]): MacroPoint[] {
  const { parameters: p, initial, trend: t } = calibration
  let gap = Math.log(initial.gdp) - t.logGDP
  let expectation = initial.inflation
  let previous: MacroPoint = {
    ...initial,
    gap,
    expectedInflation: expectation,
    employment: initial.laborForce * (1 - initial.unemployment),
    vacancies: 0,
    hires: 0,
    separations: 0,
  }
  const points = [previous]
  const inflationHistory = Array(4).fill(initial.inflation / 4) as number[]
  for (let step = 1; step < inputs.length; step++) {
    const input = inputs[step]
    const oilChange = Math.log(input.oil / previous.oil)
    const realRate = previous.policy - expectation
    gap =
      p.persistence * gap -
      (p.interestSensitivity * (realRate - calibration.neutralRealRate)) / 4 -
      p.energyDemand * oilChange
    const laborForce = initial.laborForce * Math.exp(t.laborGrowth * step)
    const desired = Math.min(
      laborForce,
      laborForce * (1 - calibration.referenceUnemployment) * Math.exp(p.employmentElasticity * gap),
    )
    const retained = Math.min(laborForce, retainedJobs(previous.employment, desired, p.separation))
    const vacancies = Math.max(0, desired - retained)
    const hires = matchJobs(laborForce - retained, vacancies, p.matchingEfficiency)
    const employment = retained + hires
    const unemployment = 1 - employment / laborForce
    const quarterInflation =
      (expectation + p.phillipsSlope * (calibration.referenceUnemployment - unemployment)) / 4 +
      p.energyPassThrough * oilChange
    inflationHistory.shift()
    inflationHistory.push(quarterInflation)
    const inflation = inflationHistory.reduce((a, b) => a + b, 0)
    expectation += p.expectationAdjustment * (inflation - expectation)
    const gdp = Math.exp(t.logGDP + t.growth * step + gap)
    const policy =
      input.policy ??
      policyRate(previous.policy, inflation, unemployment, {
        neutralRealRate: calibration.neutralRealRate,
        target: 0.02,
        referenceUnemployment: calibration.referenceUnemployment,
        inflationResponse: 0.5,
        unemploymentResponse: 1,
        inertia: 0.6,
      })
    const point: MacroPoint = {
      quarter: input.quarter,
      gdp,
      prices: previous.prices * Math.exp(quarterInflation),
      unemployment,
      laborForce,
      policy,
      oil: input.oil,
      inflation,
      growth: 4 * Math.log(gdp / previous.gdp),
      gap,
      expectedInflation: expectation,
      employment,
      vacancies,
      hires,
      separations: previous.employment - retained,
    }
    if (Object.values(point).some((x) => typeof x === 'number' && !Number.isFinite(x)))
      throw new Error(`Nonfinite projection at ${input.quarter}`)
    points.push(point)
    previous = point
  }
  return points
}

export function scoreMacro(
  predicted: readonly HistoricalObservation[],
  observed: readonly HistoricalObservation[],
) {
  if (
    !observed.length ||
    predicted.length !== observed.length ||
    predicted.some((p, i) => p.quarter !== observed[i].quarter)
  )
    throw new Error('Historical scoring requires aligned, nonempty quarters')
  const metrics = {} as Record<
    'growth' | 'inflation' | 'unemployment' | 'gdpLevel',
    { rmse: number; mae: number; bias: number }
  >
  for (const key of ['growth', 'inflation', 'unemployment', 'gdpLevel'] as const) {
    const errors = predicted.map((p, i) =>
      key === 'gdpLevel' ? 100 * (p.gdp / observed[i].gdp - 1) : 100 * (p[key] - observed[i][key]),
    )
    metrics[key] = {
      rmse: Math.sqrt(mean(errors.map((x) => x * x))),
      mae: mean(errors.map(Math.abs)),
      bias: mean(errors),
    }
  }
  return metrics
}

/** This function refuses holdout rows. It cannot choose parameters using 1970+.
 * Grid fixed in source before evaluating the holdout; no random optimizer. */
export function calibrateMacro(training: readonly HistoricalObservation[]): MacroCalibration {
  if (
    training.length !== 40 ||
    training[0].quarter !== '1960-Q1' ||
    training.at(-1)!.quarter !== '1969-Q4' ||
    training.some((x) => x.quarter >= '1970')
  )
    throw new Error('Calibration requires exactly 1960–1969; holdout data are forbidden')
  const gdpTrend = trend(training.map((x) => Math.log(x.gdp)))
  const laborTrend = trend(training.map((x) => Math.log(x.laborForce)))
  const base = {
    trend: { logGDP: gdpTrend.intercept, growth: gdpTrend.slope, laborGrowth: laborTrend.slope },
    referenceUnemployment: mean(training.map((x) => x.unemployment)),
    neutralRealRate: mean(training.map((x) => x.policy - x.inflation)),
    initial: { ...training[0] },
    trainingEnd: training.at(-1)!.quarter,
  }
  let best: MacroCalibration | undefined,
    candidates = 0
  const inputs = training.map(({ quarter, policy, oil }) => ({ quarter, policy, oil }))
  for (const persistence of [0.7, 0.85, 0.95])
    for (const interestSensitivity of [0.25, 0.75, 1.25])
      for (const phillipsSlope of [0.25, 0.75, 1.25])
        for (const expectationAdjustment of [0.1, 0.25, 0.5]) {
          const parameters: MacroParameters = {
            persistence,
            interestSensitivity,
            phillipsSlope,
            expectationAdjustment,
            // Energy coefficients and flow parameters are declared assumptions.
            // The quiet 1960s cannot identify responses to the later oil crises.
            energyPassThrough: 0.04,
            energyDemand: 0.025,
            matchingEfficiency: 0.65,
            separation: 1 - (1 - 0.015) ** 3,
            employmentElasticity: 0.5,
          }
          const candidate: MacroCalibration = { ...base, parameters, trainingScore: 0, candidates: 0 }
          const metrics = scoreMacro(projectMacro(candidate, inputs).slice(1), training.slice(1))
          candidate.trainingScore =
            (metrics.growth.rmse / 4) ** 2 +
            (metrics.inflation.rmse / 2) ** 2 +
            (metrics.unemployment.rmse / 2) ** 2
          candidates++
          if (!best || candidate.trainingScore < best.trainingScore) best = candidate
        }
  return { ...best!, candidates }
}

/** Locked-origin benchmark: every 1970–1985 outcome follows from the 1969
 * endpoint and training drift, with no annual reinitialization from observations. */
export function driftBaseline(
  training: readonly HistoricalObservation[],
  quarters: readonly string[],
): HistoricalObservation[] {
  const last = training.at(-1)!,
    growth = mean(training.slice(1).map((x) => x.growth))
  return quarters.map((quarter, i) => ({
    ...last,
    quarter,
    growth,
    gdp: last.gdp * Math.exp((growth * (i + 1)) / 4),
    prices: last.prices * Math.exp((last.inflation * (i + 1)) / 4),
  }))
}
