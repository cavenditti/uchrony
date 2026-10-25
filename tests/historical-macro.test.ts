import test from 'node:test'
import assert from 'node:assert/strict'
import { loadUSHistory } from '../scripts/historical-data'
import { calibrateMacro, projectMacro, scoreMacro, driftBaseline } from '../src/sim/historical-macro'

const observations = loadUSHistory()
const training = observations.slice(0, 40)
const calibration = calibrateMacro(training)
const inputs = observations.map(({ quarter, oil, policy }) => ({ quarter, oil, policy }))

test('frozen primary data verify hashes, complete quarters, and defined historical shocks', () => {
  assert.equal(observations.length, 104)
  assert.equal(observations[0].quarter, '1960-Q1')
  assert.equal(observations.at(-1)!.quarter, '1985-Q4')
  assert(
    observations.find((x) => x.quarter === '1974-Q1')!.oil >
      observations.find((x) => x.quarter === '1973-Q3')!.oil,
  )
  assert(observations.find((x) => x.quarter === '1981-Q2')!.policy > 0.15)
  assert(observations.find((x) => x.quarter === '1982-Q4')!.unemployment > 0.1)
})
test('calibration refuses future outcomes and is deterministic', () => {
  assert.throws(() => calibrateMacro(observations), /holdout/)
  assert.equal(calibration.trainingEnd, '1969-Q4')
  assert.equal(calibration.candidates, 81)
  assert.deepEqual(calibrateMacro(structuredClone(training)), calibration)
})
test('changing holdout outcomes cannot change projections; changed future inputs cannot affect earlier quarters', () => {
  const path = projectMacro(calibration, inputs)
  const corrupted = structuredClone(observations)
  for (const row of corrupted.slice(40)) {
    row.gdp *= 9
    row.prices *= 4
    row.unemployment = 0.99
  }
  assert.deepEqual(
    projectMacro(
      calibration,
      corrupted.map(({ quarter, oil, policy }) => ({ quarter, oil, policy })),
    ),
    path,
  )
  const lateShock = structuredClone(inputs)
  lateShock[70].policy += 0.1
  assert.deepEqual(projectMacro(calibration, lateShock).slice(0, 70), path.slice(0, 70))
})
test('higher interest rates contract demand and employment with a lag and eventually lower inflation', () => {
  const base = inputs.slice(0, 32).map((x) => ({ ...x, policy: 0.04, oil: inputs[0].oil }))
  const tight = base.map((x, i) => ({ ...x, policy: x.policy + (i >= 8 && i < 16 ? 0.04 : 0) }))
  const a = projectMacro(calibration, base),
    b = projectMacro(calibration, tight)
  assert.equal(a[8].gdp, b[8].gdp, 'policy affects the following quarter')
  assert(b[12].gdp < a[12].gdp)
  assert(b[12].unemployment > a[12].unemployment)
  assert(b[20].inflation < a[20].inflation)
})
test('energy cost shocks create stagflation without changing past outcomes', () => {
  const base = inputs.slice(0, 24).map((x) => ({ ...x, policy: 0.04, oil: inputs[0].oil }))
  const oil = base.map((x, i) => ({ ...x, oil: x.oil * (i >= 8 ? 2 : 1) }))
  const a = projectMacro(calibration, base),
    b = projectMacro(calibration, oil)
  assert.deepEqual(a.slice(0, 8), b.slice(0, 8))
  assert(b[8].gdp < a[8].gdp)
  assert(b[8].inflation > a[8].inflation)
  assert(b[8].unemployment > a[8].unemployment)
})
test('historical scores expose bad fit and the baseline never uses holdout outcomes', () => {
  const holdout = observations.slice(40)
  const predicted = driftBaseline(
    training,
    holdout.map((x) => x.quarter),
  )
  const scores = scoreMacro(predicted, holdout)
  assert(scores.unemployment.rmse > 0)
  assert.deepEqual(scoreMacro(holdout, holdout).gdpLevel, { rmse: 0, mae: 0, bias: 0 })
  assert.throws(() => scoreMacro(predicted.slice(1), holdout), /aligned/)
})
