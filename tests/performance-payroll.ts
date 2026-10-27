/** Component benchmark: opening World payroll, not a complete monthly tick.
 * node --expose-gc --max-old-space-size=8192 --import tsx tests/performance-payroll.ts --compare-root /path/to/before
 */
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { canonicalHash } from './fixtures/world-hash'
import { WORLD_SCALES, worldScale } from '../src/sim/scale'
import type { World } from '../src/sim/types'

const argument = (name: string) => {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}
const comparison = argument('--compare-root')
assert(comparison, 'Provide --compare-root with the reference source tree')
const referenceRoot = resolve(comparison),
  root = resolve(argument('--engine-root') ?? '.')
const moduleAt = (base: string, name: string) =>
  import(pathToFileURL(resolve(base, `src/sim/${name}.ts`)).href)
const [
  { generateWorld },
  { prepareSpatialWorld },
  { beginPopulationMonth },
  { beginEconomyMonth },
  { hireFirms },
  { economicRegions },
  reference,
  current,
  referenceLedger,
  currentLedger,
] = await Promise.all([
  moduleAt(referenceRoot, 'generate'),
  moduleAt(referenceRoot, 'engine'),
  moduleAt(referenceRoot, 'identities'),
  moduleAt(referenceRoot, 'macroeconomy'),
  moduleAt(referenceRoot, 'firms'),
  moduleAt(referenceRoot, 'local-units'),
  moduleAt(referenceRoot, 'commuting'),
  moduleAt(root, 'commuting'),
  moduleAt(referenceRoot, 'ledger'),
  moduleAt(root, 'ledger'),
])
const scale = worldScale(argument('--scale') ?? 'world'),
  seed = argument('--seed') ?? 'performance-ledger'
const initial: World = generateWorld(seed, 3, WORLD_SCALES[scale].states, undefined, scale, 'settled')
prepareSpatialWorld(initial)
initial.month++
referenceLedger.withBatchedLedgerEntries(initial, () => {
  beginPopulationMonth(initial)
  beginEconomyMonth(initial)
  for (const region of economicRegions(initial)) hireFirms(initial, region)
})
let expectedHash: string | undefined
function trial(version: 'reference' | 'current') {
  const w = structuredClone(initial)
  // Cloning and fingerprint garbage must not contaminate the next measured phase.
  global.gc?.()
  const cpuStarted = process.cpuUsage(),
    started = performance.now()
  if (version === 'reference') referenceLedger.withBatchedLedgerEntries(w, () => reference.matchCommuters(w))
  else currentLedger.withBatchedLedgerEntries(w, () => current.matchCommuters(w))
  const ms = performance.now() - started,
    cpu = process.cpuUsage(cpuStarted),
    hash = canonicalHash(w)
  if (expectedHash) assert.equal(hash, expectedHash, 'complete payroll result')
  else expectedHash = hash
  return {
    version,
    ms: Math.round(ms),
    cpuMs: Math.round((cpu.user + cpu.system) / 1000),
    hash,
    rows: w.adaptive!.commutingRows!.length,
    transactions: w.economy!.ledger.transactions,
  }
}
const results = []
for (const version of ['reference', 'current', 'current', 'reference'] as const) {
  const result = trial(version)
  results.push(result)
  console.error(`${version}: ${result.ms} ms`)
  global.gc?.()
}
console.log(
  JSON.stringify(
    {
      root,
      referenceRoot,
      seed,
      scale,
      explicitGc: !!global.gc,
      phase: 'opening commuter matching and payroll; other monthly phases excluded',
      results,
    },
    null,
    2,
  ),
)
