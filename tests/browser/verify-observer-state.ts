/** Compare checkpoints produced within the same numeric runtime. For the browser
 * qualification use compare-native-replay.ts; Node and Chromium transcendental
 * functions need not produce bit-identical trajectories.
 * Compare real camera/inspection history with an independent native replay.
 * A common saved checkpoint must first equal a separately computed baseline;
 * only then may it anchor a short headless continuation to the browser endpoint. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { restoreWorld, validateWorld } from '../../src/sim/persistence'
import { tick } from '../../src/sim/engine'
import { canonicalHash } from '../fixtures/world-hash'
const [baselinePath, commonPath, replicaReportPath, output] = process.argv.slice(2)
assert(
  baselinePath && commonPath && replicaReportPath && output,
  'Pass independent replay report, browser disk checkpoint, final replica report and output',
)
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')),
  common = JSON.parse(readFileSync(commonPath, 'utf8')),
  endpoint = JSON.parse(readFileSync(replicaReportPath, 'utf8')),
  world = restoreWorld(common.world)
validateWorld(world)
const openingHash = canonicalHash(world)
const reference = baseline.months.find((m: { month: number }) => m.month === world.month)
assert(reference, 'No independently calculated baseline for this common checkpoint')
assert.equal(openingHash, reference.canonicalHash, 'Camera history diverged from the independent baseline')
assert(endpoint.valid && endpoint.replicasMatchExport)
assert(endpoint.month >= world.month)
const source = createHash('sha256')
for (const file of readdirSync('src/sim')
  .filter((f) => f.endsWith('.ts'))
  .sort())
  source.update(file).update(readFileSync('src/sim/' + file))
let providerCalls = 0
globalThis.fetch = (async () => {
  providerCalls++
  throw new Error('Network forbidden')
}) as typeof fetch
const report = {
  baseline,
  sourceHash: source.digest('hex'),
  common: { month: world.month, canonicalHash: openingHash, baselineMatches: true },
  endpoint: { month: endpoint.month, canonicalHash: endpoint.canonicalHash, matches: false },
  continuation: [] as { month: number; canonicalHash: string }[],
  providerCalls: 0,
}
while (world.month < endpoint.month) {
  tick(world)
  validateWorld(world)
  const row = { month: world.month, canonicalHash: canonicalHash(world) }
  report.continuation.push(row)
  console.log(JSON.stringify(row))
}
assert.equal(
  canonicalHash(world),
  endpoint.canonicalHash,
  'Browser endpoint differs from native continuation',
)
assert.equal(providerCalls, 0)
report.endpoint.matches = true
writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ commonMonth: report.common.month, finalMonth: world.month, passed: true }))
