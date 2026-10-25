import { writeFileSync, readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { createHash } from 'node:crypto'
import { loadUSHistory } from './historical-data'
import {
  calibrateMacro,
  driftBaseline,
  projectMacro,
  scoreMacro,
  type ForecastInput,
  type HistoricalObservation,
} from '../src/sim/historical-macro'

const start = performance.now()
const observations = loadUSHistory()
const training = observations.filter((x) => x.quarter < '1970')
const holdout = observations.filter((x) => x.quarter >= '1970')
const fitted = calibrateMacro(training)
// All arms share the last observed 1969 state. No later GDP, prices, unemployment
// or labor-force observations are passed to the projection function.
const calibration = {
  ...fitted,
  initial: { ...training.at(-1)! },
  trend: { ...fitted.trend, logGDP: fitted.trend.logGDP + 39 * fitted.trend.growth },
}
const origin = training.at(-1)!
const inputs = (replay: boolean, energy: boolean): ForecastInput[] =>
  [origin, ...holdout].map((x) => ({
    quarter: x.quarter,
    oil: energy ? x.oil : origin.oil,
    ...(replay ? { policy: x.policy } : {}),
  }))
const arms = [
  ['recorded-policy-recorded-energy', true, true],
  ['recorded-policy-constant-energy', true, false],
  ['policy-rule-recorded-energy', false, true],
  ['policy-rule-constant-energy', false, false],
] as const
const results = Object.fromEntries(
  arms.map(([name, replay, energy]) => {
    const path = projectMacro(calibration, inputs(replay, energy)).slice(1)
    return [name, { metrics: scoreMacro(path, holdout), path }]
  }),
)
const baseline = driftBaseline(
  training,
  holdout.map((x) => x.quarter),
)
const baselineMetrics = scoreMacro(baseline, holdout)
const sensitivity = [0.5, 1.5].map((factor) => {
  const c = {
    ...calibration,
    parameters: {
      ...calibration.parameters,
      energyPassThrough: calibration.parameters.energyPassThrough * factor,
      energyDemand: calibration.parameters.energyDemand * factor,
    },
  }
  return {
    energyCoefficientFactor: factor,
    metrics: scoreMacro(projectMacro(c, inputs(true, true)).slice(1), holdout),
  }
})
const pairedEnergyEffects = holdout.map(({ quarter }, i) => {
  const withEnergy = results['recorded-policy-recorded-energy'].path[i]
  const flat = results['recorded-policy-constant-energy'].path[i]
  return {
    quarter,
    gdpPercent: 100 * (withEnergy.gdp / flat.gdp - 1),
    inflationPoints: 100 * (withEnergy.inflation - flat.inflation),
    unemploymentPoints: 100 * (withEnergy.unemployment - flat.unemployment),
  }
})
const primary = results['recorded-policy-recorded-energy'].metrics
function turningPoints(path: readonly HistoricalObservation[], from: string, through: string) {
  const window = path.filter((x) => x.quarter >= from && x.quarter <= through)
  const extreme = (key: 'inflation' | 'unemployment' | 'growth', maximum: boolean) => {
    const point = window.reduce((best, row) =>
      (maximum ? row[key] > best[key] : row[key] < best[key]) ? row : best,
    )
    return { quarter: point.quarter, percent: point[key] * 100 }
  }
  return {
    peakInflation: extreme('inflation', true),
    peakUnemployment: extreme('unemployment', true),
    minimumGrowth: extreme('growth', false),
  }
}
const eventWindows = [
  ['1973-Q4', '1976-Q4'],
  ['1979-Q2', '1983-Q4'],
].map(([from, through]) => ({
  from,
  through,
  observed: turningPoints(holdout, from, through),
  simulations: Object.fromEntries(
    Object.entries(results).map(([name, result]) => [name, turningPoints(result.path, from, through)]),
  ),
}))
const trainingPath = projectMacro(
  fitted,
  training.map(({ quarter, oil, policy }) => ({ quarter, oil, policy })),
)
const sourceFiles = [
  'src/sim/historical-macro.ts',
  'src/sim/labor-market.ts',
  'src/sim/monetary-policy.ts',
  'scripts/historical-data.ts',
  'scripts/evaluate-us-history.ts',
]
const codeHash = createHash('sha256')
for (const file of sourceFiles)
  codeHash.update(file).update(readFileSync(new URL(`../${file}`, import.meta.url)))
const report = {
  schema: 1,
  scenario: 'United States, 1960–1985',
  scope:
    'Quarterly aggregate research benchmark; shared policy and labor-flow functions. Does not run or validate the spatial world, banks, GDP ledger or wage bargaining.',
  informationSet:
    'Revised historical series. Calibrate 1960Q1–1969Q4; common observed origin 1969Q4; score 64 unreinitialized quarters 1970Q1–1985Q4.',
  interpretation:
    'Recorded policy and energy paths are conditional inputs, not forecasts or identified exogenous shocks. The inflation-target rule is a modern counterfactual, not the historical Fed regime.',
  sourceHash: codeHash.digest('hex'),
  data: JSON.parse(
    readFileSync(new URL('../data/history/us-1960-1985/manifest.json', import.meta.url), 'utf8'),
  ),
  training: {
    ...fitted,
    rows: training.length,
    metrics: scoreMacro(trainingPath.slice(1), training.slice(1)),
    path: trainingPath,
  },
  holdoutRows: holdout.length,
  baseline: {
    method: '1969Q4 unemployment and annual inflation persist; GDP grows at mean 1960s quarterly log growth.',
    metrics: baselineMetrics,
    path: baseline,
  },
  evaluation: {
    outcome: ['growth', 'inflation', 'unemployment'].every(
      (key) =>
        primary[key as keyof typeof primary].rmse < baselineMetrics[key as keyof typeof baselineMetrics].rmse,
    )
      ? 'beats-baseline-on-three-targets'
      : 'not-historically-qualified',
    rule: 'Historical qualification requires lower holdout RMSE than the locked-origin baseline on growth, inflation and unemployment; accounting and causal-sign tests alone are insufficient.',
  },
  events: [
    {
      quarter: '1973-Q4',
      label: '1973–74 oil embargo',
      source: 'https://www.federalreservehistory.org/essays/oil-shock-of-1973-74',
    },
    {
      quarter: '1979-Q2',
      label: '1978–79 oil shock and subsequent price rise',
      source: 'https://www.federalreservehistory.org/essays/oil-shock-of-1978-79',
    },
    {
      quarter: '1979-Q4',
      label: 'Volcker monetary-policy change',
      source: 'https://www.federalreservehistory.org/essays/anti-inflation-measures',
    },
  ],
  results,
  sensitivity,
  pairedEnergyEffects,
  eventWindows,
  observed: holdout,
  elapsedMs: performance.now() - start,
}
const destination = process.argv[2] ?? 'docs/validation/us-1960-1985-v1.json'
writeFileSync(destination, JSON.stringify(report, null, 2) + '\n')
console.log(
  JSON.stringify(
    {
      destination,
      elapsedMs: report.elapsedMs,
      training: fitted,
      baseline: baselineMetrics,
      arms: Object.fromEntries(Object.entries(results).map(([name, result]) => [name, result.metrics])),
      evaluation: report.evaluation,
    },
    null,
    2,
  ),
)
