/** Compare approximate/exact throughput in separate processes; never a parity claim. */
import { generateWorld } from '../src/sim/generate'
import { prepareSpatialWorld, tick } from '../src/sim/engine'
import { fastForwardMonth } from '../src/sim/fast-forward'
import { validateWorld } from '../src/sim/persistence'
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
const started = performance.now()
const w = generateWorld('performance-ledger', 3, WORLD_SCALES[scale].states, undefined, scale)
prepareSpatialWorld(w)
const startupMs = performance.now() - started
const cpuStarted = process.cpuUsage(),
  stepMs: number[] = []
for (let i = 0; i < months; i++) {
  const start = performance.now()
  if (mode === 'max') fastForwardMonth(w)
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
      months,
      startupMs: Math.round(startupMs),
      elapsedMs: stepMs.reduce((a, b) => a + b, 0),
      stepMs,
      cpuMs: Math.round((cpu.user + cpu.system) / 1000),
      population: w.totals.population,
      gdp: w.totals.gdp,
      approximation: w.fastForward,
      validated: true,
    },
    null,
    2,
  ),
)
