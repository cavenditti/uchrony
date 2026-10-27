/** Compare approximate/exact throughput in separate processes; never a parity claim. */
import { generateWorld } from '../src/sim/generate'
import { prepareSpatialWorld, tick } from '../src/sim/engine'
import { fastForwardStep } from '../src/sim/fast-forward'
import { validateWorld } from '../src/sim/persistence'
import { population } from '../src/sim/types'
import { WORLD_SCALES, worldScale } from '../src/sim/scale'
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name)
  return i < 0 ? fallback : process.argv[i + 1]
}
const scale = worldScale(arg('--scale', 'world'))
const mode = arg('--mode', 'max')
if (!['max', 'monthly'].includes(mode)) throw new Error('Expected max or monthly')
const months = Number(arg('--months', '6'))
if (!Number.isInteger(months) || months < 1 || months > 120) throw new Error('Invalid month count')
const startMode = arg('--start', 'settled')
if (!['settled', 'frontier'].includes(startMode)) throw new Error('Expected settled or frontier start')
const started = performance.now()
const w = generateWorld(
  arg('--seed', 'performance-ledger'),
  3,
  WORLD_SCALES[scale].states,
  undefined,
  scale,
  startMode as 'settled' | 'frontier',
)
prepareSpatialWorld(w)
const startupMs = performance.now() - started
console.error(`startup: ${Math.round(startupMs)} ms`)
const openingPopulation = w.totals.population
const cpuStarted = process.cpuUsage(),
  stepMs: number[] = []
if (mode === 'max' && months % 6 !== 0) throw new Error('Max benchmarks need complete six-month intervals')
while (w.month < months) {
  const start = performance.now()
  if (mode === 'max') fastForwardStep(w)
  else tick(w)
  stepMs.push(Math.round(performance.now() - start))
  console.error(`${mode} month ${w.month}: ${stepMs.at(-1)} ms`)
}
const cpu = process.cpuUsage(cpuStarted)
validateWorld(w)
console.log(
  JSON.stringify(
    {
      scale,
      mode,
      seed: w.seed,
      start: startMode,
      cells: w.cells.length,
      states: w.nations.length,
      openingPopulation,
      months,
      startupMs: Math.round(startupMs),
      elapsedMs: stepMs.reduce((a, b) => a + b, 0),
      stepMs,
      cpuMs: Math.round((cpu.user + cpu.system) / 1000),
      population: w.totals.population,
      gdp: w.totals.gdp,
      foodCoverage:
        w.regions.reduce((sum, r) => sum + r.foodCoverage * population(r), 0) /
        Math.max(
          1,
          w.regions.reduce((sum, r) => sum + population(r), 0),
        ),
      accountingMonths: w.economy?.periodMonths ?? 1,
      approximation: w.fastForward,
      validated: true,
    },
    null,
    2,
  ),
)
