/** Autonomous whole-world comparison; controlled neighbourhood tests live separately.
 * Usage: node --import tsx tests/urban-world-qualification.ts --months 120 --output /tmp/report.json */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { generateWorld } from '../src/sim/generate'
import { prepareSpatialWorld, advanceCoarsePeriod, tick } from '../src/sim/engine'
import { ensureUrbanFabric } from '../src/sim/urban-fabric'
import { urbanMetrics } from '../src/sim/urban-metrics'
import { validateWorld, parseSave } from '../src/sim/persistence'
import { packWorldSave } from '../src/sim/save-codec'
import { balances, auditLedger } from '../src/sim/ledger'
import { auditGoods } from '../src/sim/goods-accounting'
import { auditBanks } from '../src/sim/banking'
import { auditNationalAccounts } from '../src/sim/national-accounts'
import { population, type World } from '../src/sim/types'
import { allForces } from '../src/sim/forces'

const args = process.argv.slice(2),
  option = (key: string, fallback: string) => (args.includes(key) ? args[args.indexOf(key) + 1] : fallback)
const months = Number(option('--months', '120')),
  output = option('--output', '/tmp/urban-world-qualification.json')
const seeds = option('--seeds', 'Urban estuary,Urban highlands').split(',')
const hash = createHash('sha256')
for (const file of readdirSync('src/sim')
  .filter((p) => p.endsWith('.ts'))
  .sort())
  hash.update(file).update(readFileSync(`src/sim/${file}`))
const report = {
  sourceHash: hash.digest('hex'),
  kind: 'autonomous full engine; paired initial state, six-month integration',
  months,
  runs: [] as object[],
}
const people = (w: World) =>
  w.regions.reduce((n, r) => n + population(r), 0) + allForces(w).reduce((n, a) => n + a.soldiers, 0)
const money = (w: World) =>
  Object.values(balances(w)).reduce((a, b) => a + b, 0) -
  (w.economy?.banking?.created ?? 0) +
  (w.economy?.banking?.destroyed ?? 0)
const census = (w: World) => {
  const { geometry, ...metrics } = urbanMetrics(w)
  return {
    ...metrics,
    geometryHash: createHash('sha256').update(JSON.stringify(geometry)).digest('hex'),
    projects: w.adaptive!.urban!.projects.length,
    completed: w.adaptive!.urban!.history.length,
    // Legacy firm supports are included. Use the controlled harness for exact
    // physical-building specialization rather than interpreting this as roofs.
    recordedAndAggregateNonHousingFloorArea: Object.values(w.adaptive!.sites).reduce(
      (n, s) =>
        n + (s.fabric?.uses.production ?? 0) + (s.fabric?.uses.logistics ?? 0) + (s.fabric?.uses.market ?? 0),
      0,
    ),
  }
}
for (const seed of seeds) {
  const initial = generateWorld(seed, 3, 8, undefined, 'regional', 'frontier')
  prepareSpatialWorld(initial)
  ensureUrbanFabric(initial)
  for (const enabled of [false, true]) {
    const w = structuredClone(initial)
    w.adaptive!.urban!.enabled = enabled
    const initialMoney = money(w),
      rows = [census(w)],
      times: number[] = []
    let maxMoneyError = 0
    const start = performance.now(),
      cpuStart = process.cpuUsage()
    try {
      for (let month = 0; month < months; month += 6) {
        const before = people(w),
          began = performance.now()
        advanceCoarsePeriod(w, Math.min(6, months - month))
        times.push(performance.now() - began)
        assert.equal(people(w), before + w.totals.births - w.totals.deaths)
        maxMoneyError = Math.max(maxMoneyError, Math.abs(money(w) - initialMoney))
        assert.ok(maxMoneyError < Math.max(1, Math.abs(initialMoney)) * 1e-8)
        if (w.month % 24 === 0 || w.month === months) {
          validateWorld(w)
          auditLedger(w)
          auditGoods(w)
          auditBanks(w)
          auditNationalAccounts(w)
          rows.push(census(w))
          console.log(
            JSON.stringify({
              seed,
              enabled,
              month: w.month,
              seconds: Math.round((performance.now() - start) / 1000),
              buildings: rows.at(-1)!.buildings,
              projects: rows.at(-1)!.projects,
            }),
          )
        }
      }
      const restored = parseSave(JSON.stringify(packWorldSave(w)))
      // One monthly continuation from the save must match its untouched twin.
      const twin = structuredClone(w)
      tick(twin)
      tick(restored)
      assert.deepEqual(census(restored), census(twin))
      assert.deepEqual(restored.adaptive!.urban, twin.adaptive!.urban)
      times.sort((a, b) => a - b)
      report.runs.push({
        seed,
        enabled,
        complete: true,
        elapsedSeconds: (performance.now() - start) / 1000,
        cpuSeconds: (process.cpuUsage(cpuStart).user + process.cpuUsage(cpuStart).system) / 1e6,
        maxMoneyError,
        p50StepMs: times[Math.floor(times.length * 0.5)],
        p95StepMs: times[Math.floor(times.length * 0.95)],
        rows,
        saveContinuation: true,
      })
    } catch (error) {
      report.runs.push({ seed, enabled, complete: false, month: w.month, error: String(error), rows })
      writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
      throw error
    }
    writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
  }
}
