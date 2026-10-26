/** Reproduce a browser's native monthly history without rendering or inspection. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { restoreWorld, validateWorld } from '../src/sim/persistence'
import { tick } from '../src/sim/engine'
import { ensureWarfare } from '../src/sim/navy'
import { ensurePopulation } from '../src/sim/population'
import { ensureHistory } from '../src/sim/history'
import { ensureStatecraft } from '../src/sim/statecraft'
import { ensureIntelligence } from '../src/sim/intelligence'
import { canonicalHash } from './fixtures/world-hash'
const [input, end, output] = process.argv.slice(2)
assert(input && output && Number.isInteger(+end), 'Pass input checkpoint, final month and output report')
let providerCalls = 0
globalThis.fetch = (async () => {
  providerCalls++
  throw new Error('Network forbidden')
}) as typeof fetch
const source = createHash('sha256')
for (const file of readdirSync('src/sim')
  .filter((f) => f.endsWith('.ts'))
  .sort())
  source.update(file).update(readFileSync('src/sim/' + file))
const text = readFileSync(input, 'utf8'),
  w = restoreWorld(JSON.parse(text))
// Match normal worker loading; none of the subsequent calls involves a camera.
ensureWarfare(w)
ensurePopulation(w)
ensureHistory(w)
ensureStatecraft(w)
ensureIntelligence(w)
const report = {
  sourceHash: source.digest('hex'),
  runtime: { node: process.version, v8: process.versions.v8 },
  inputHash: createHash('sha256').update(text).digest('hex'),
  initialMonth: w.month,
  providerCalls: 0,
  months: [] as { month: number; canonicalHash: string; milliseconds: number }[],
}
for (let month = w.month; month <= +end; month++) {
  const started = performance.now()
  if (month > report.initialMonth) tick(w)
  validateWorld(w)
  report.months.push({
    month: w.month,
    canonicalHash: canonicalHash(w),
    milliseconds: performance.now() - started,
  })
  assert.equal(providerCalls, 0)
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report.months.at(-1)))
}
