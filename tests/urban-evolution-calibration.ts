import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { urbanFixture, URBAN_SCENARIOS } from './fixtures/urban-evolution'
import { urbanMetrics } from '../src/sim/urban-metrics'

const digest = createHash('sha256')
for (const name of readdirSync('src/sim')
  .filter((n) => n.endsWith('.ts'))
  .sort())
  digest.update(name).update(readFileSync(`src/sim/${name}`))
const scenarios = URBAN_SCENARIOS.map((scenario) => ({ scenario, ...urbanMetrics(urbanFixture(scenario).w) }))
const report = { kind: 'prescribed physical baseline', sourceHash: digest.digest('hex'), scenarios }
writeFileSync(process.argv[2] ?? '/tmp/urban-evolution-baseline.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ scenarios: scenarios.length, residents: scenarios.map((s) => s.residents) }))
