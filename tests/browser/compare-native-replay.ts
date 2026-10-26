/** Require exact observer independence within one declared JavaScript runtime. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { restoreWorld } from '../../src/sim/persistence'
import { canonicalHash } from '../fixtures/world-hash'
const [inputPath, initialPath, finalPath, endpointPath, tracePath, output] = process.argv.slice(2)
assert(
  inputPath && initialPath && finalPath && endpointPath && tracePath && output,
  'Pass original input, browser initial/final exports, observed endpoint report, native trace and output',
)
function checkpoint(path: string) {
  const bytes = readFileSync(path)
  const inputSha256 = createHash('sha256').update(bytes).digest('hex')
  const world = restoreWorld(JSON.parse(bytes.toString()))
  return { month: world.month, canonicalHash: canonicalHash(world), inputSha256 }
}
const input = checkpoint(inputPath)
global.gc?.()
const initial = checkpoint(initialPath)
assert.equal(initial.month, input.month)
assert.equal(initial.canonicalHash, input.canonicalHash, 'Replay started from a different world')
global.gc?.()
const final = checkpoint(finalPath)
const endpoint = JSON.parse(readFileSync(endpointPath, 'utf8'))
assert(endpoint.valid && endpoint.replicasMatchExport)
assert.equal(final.month, endpoint.month)
assert.equal(final.canonicalHash, endpoint.canonicalHash, 'Observed and camera-free worlds differ')
const trace = JSON.parse(readFileSync(tracePath, 'utf8')) as {
  month: number
  providerCalls: number
  complete?: boolean
  userAgent?: string
  error?: string
}[]
assert.equal(trace[0].month, initial.month)
assert.equal(trace.at(-1)!.month, final.month)
assert(trace.at(-1)!.complete)
for (const [index, row] of trace.entries()) {
  assert.equal(row.month, initial.month + index)
  assert.equal(row.providerCalls, 0)
  assert(!row.error)
}
const source = createHash('sha256')
for (const file of readdirSync('src/sim')
  .filter((f) => f.endsWith('.ts'))
  .sort())
  source.update(file).update(readFileSync('src/sim/' + file))
const report = {
  passed: true,
  sourceHash: source.digest('hex'),
  runtime: trace[0].userAgent,
  input,
  initial,
  final,
  observed: { month: endpoint.month, canonicalHash: endpoint.canonicalHash },
  exactMatch: true,
  cameraAndInspectionInNativeReplay: false,
  providerCalls: 0,
  trace,
  scope:
    'Independent replay from the identical original checkpoint in the same Chromium runtime, with no renderer, viewport subscriptions or inspection. Cross-runtime bit identity is separately tested and not assumed.',
}
writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log({ passed: true, initialMonth: input.month, finalMonth: final.month, hash: final.canonicalHash })
