/** Spatial qualification only. Behavioral v5/US benchmark failures remain observations, never feedback. */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { cpus, totalmem, platform, release } from 'node:os'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { tick } from '../src/sim/engine'
import { validateWorld, restoreWorld } from '../src/sim/persistence'
import { packWorldSave } from '../src/sim/save-codec'
import { allForces } from '../src/sim/forces'
import { population, type World } from '../src/sim/types'
import { inspectWorld, inspectionAround } from '../src/sim/inspection'
import { balances } from '../src/sim/ledger'
const seed = process.argv[2] ?? 'A world unwritten',
  months = Number(process.argv[3] ?? 2400)
const output =
  process.argv[4] ?? `/private/tmp/uchrony-adaptive-${seed.replace(/\W+/g, '-').toLowerCase()}.json`
if (!Number.isSafeInteger(months) || months < 1) throw new Error('Invalid duration')
let providerCalls = 0
// Catch accidental access even if a future headless module starts trying to use a provider.
globalThis.fetch = (async () => {
  providerCalls++
  throw new Error('Network forbidden in native qualification')
}) as typeof fetch
const source = createHash('sha256')
for (const name of readdirSync(new URL('../src/sim/', import.meta.url))
  .filter((n) => n.endsWith('.ts'))
  .sort())
  source.update(name).update(readFileSync(new URL('../src/sim/' + name, import.meta.url)))
const modelHash = source.digest('hex')
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const people = (w: World) =>
  w.regions.reduce((s, r) => s + population(r), 0) + allForces(w).reduce((s, f) => s + f.soldiers, 0)
const checkpointFlag = process.argv.indexOf('--checkpoint')
const checkpointPath = checkpointFlag >= 0 ? process.argv[checkpointFlag + 1] : undefined
const checkpointText = checkpointPath ? readFileSync(checkpointPath, 'utf8') : undefined
let w = checkpointText
  ? restoreWorld(JSON.parse(checkpointText))
  : generateWorld(seed, 3, 8, undefined, 'regional')
assert.equal(w.seed, seed, 'Checkpoint seed does not match')
const initialMonth = w.month
assert(months > initialMonth, 'Final month must follow checkpoint')
const initial = people(w),
  initialMoney =
    Object.values(balances(w)).reduce((a, b) => a + b, 0) -
    (w.economy?.banking?.created ?? 0) +
    (w.economy?.banking?.destroyed ?? 0),
  start = performance.now(),
  latencies: number[] = []
const report: any = {
  schema: 1,
  modelHash,
  seed,
  requestedMonths: months,
  completedMonths: initialMonth,
  initialMonth,
  checkpoint: checkpointText
    ? {
        path: checkpointPath,
        sha256: createHash('sha256').update(checkpointText).digest('hex'),
        month: initialMonth,
      }
    : null,
  llm: {
    policy: 'forced-off',
    providerCalls: 0,
    source: checkpointText ? 'declared-checkpoint' : 'fresh-native',
  },
  hardware: {
    cpu: cpus()[0].model,
    cores: cpus().length,
    ramGiB: totalmem() / 2 ** 30,
    platform: platform(),
    release: release(),
  },
  initialPopulation: initial,
  annual: [],
  restorations: 0,
  observerChecks: 0,
  failure: null,
  qualification: {
    conservation: 'pending',
    continuation: 'pending',
    observerIndependence: 'pending',
    historicalAccuracy: 'deferred',
    v5Behavior: 'reported, not repaired',
  },
}
function save() {
  report.completedMonths = w.month
  report.seconds = (performance.now() - start) / 1000
  report.llm.providerCalls = providerCalls
  report.peakHeapMiB = Math.max(report.peakHeapMiB ?? 0, process.memoryUsage().heapUsed / 2 ** 20)
  const sorted = [...latencies].sort((a, b) => a - b)
  report.monthlyMs = {
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    maximum: sorted.at(-1),
  }
  writeFileSync(output, JSON.stringify(report, null, 2))
}
try {
  for (let month = initialMonth + 1; month <= months; month++) {
    const opening = people(w),
      at = performance.now()
    tick(w)
    latencies.push(performance.now() - at)
    assert.equal(people(w), opening + w.totals.births - w.totals.deaths)
    assert.equal(people(w), w.totals.population)
    if (month % 12 === 0 || month === 1) {
      validateWorld(w)
      const money = Object.values(balances(w)).reduce((a, b) => a + b, 0)
      assert(
        Math.abs(money - initialMoney - w.economy!.banking!.created + w.economy!.banking!.destroyed) <
          Math.max(1, initialMoney) * 1e-9,
        'cumulative deposit creation/destruction does not reconcile',
      )
      const before = hash(w)
      inspectWorld(w, {
        id: month,
        bounds: inspectionAround(w, w.regions[month % w.regions.length].center),
        detail: 'street',
      })
      assert.equal(hash(w), before)
      report.observerChecks++
      report.annual.push({
        month,
        population: people(w),
        food: w.history.at(-1)?.food,
        prices: w.economy!.totals.priceIndex,
        unemployment: w.economy!.totals.unemployment,
        states: w.nations.filter((n) => n.population > 0).length,
        money: Object.values(balances(w)).reduce((a, b) => a + b, 0),
        ledgerResidual: w.economy!.ledger.discrepancy,
        bankResidual: w.economy!.banking!.discrepancy,
        gdpResidual: w.economy!.accounts!.world.discrepancy,
        goodsResidual: w.economy!.goods!.residual,
        leaves: w.adaptive!.tree.leaves.length,
        sites: Object.keys(w.adaptive!.sites).length,
        firms: w.economy!.firms!.filter((f) => f.active).length,
        reforms: w.adaptive!.boundaries.length,
        pools: w.localEconomy!.active.length,
        cohorts: w.regions.reduce(
          (s, r) => s + (r.communities ?? []).reduce((n, c) => n + (c.ageCohorts?.length ?? 0), 0),
          0,
        ),
      })
      save()
      console.log(
        JSON.stringify({
          seed,
          month,
          seconds: Math.round(report.seconds),
          people: people(w),
          leaves: w.adaptive!.tree.leaves.length,
        }),
      )
    }
    if (month % 120 === 0 && month < months) {
      writeFileSync(output + '.checkpoint.json', JSON.stringify(packWorldSave(w)))
      const original = w,
        restored = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(w))))
      tick(original)
      tick(restored)
      assert.equal(hash(packWorldSave(restored)), hash(packWorldSave(original)), 'save continuation diverged')
      w = restored
      report.restorations++
      month++
    }
  }
  assert.equal(providerCalls, 0)
  report.qualification.conservation =
    report.qualification.continuation =
    report.qualification.observerIndependence =
      'passed'
  const finalSave = JSON.stringify(packWorldSave(w))
  report.finalSaveBytes = Buffer.byteLength(finalSave)
  writeFileSync(output + '.final.json', finalSave)
  save()
} catch (error) {
  report.failure = error instanceof Error ? error.stack : String(error)
  report.qualification.conservation = 'failed or interrupted; see failure'
  save()
  mkdirSync('/private/tmp/uchrony-adaptive-failures', { recursive: true })
  writeFileSync(
    `/private/tmp/uchrony-adaptive-failures/${seed.replace(/\W+/g, '-')}.json`,
    JSON.stringify(packWorldSave(w)),
  )
  console.error(report.failure)
  process.exitCode = 1
}
