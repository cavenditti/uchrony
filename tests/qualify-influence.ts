import assert from 'node:assert/strict'
import { Worker } from 'node:worker_threads'
import { availableParallelism, cpus } from 'node:os'
import { writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { InfluencePool } from '../src/sim/influence-pool'
import { solveInfluence } from '../src/sim/influence-kernel'
import { influenceFixture } from './fixtures/influence'
import { generateWorld } from '../src/sim/generate'
import { tick } from '../src/sim/engine'
import { ensureFirms } from '../src/sim/firms'
import { ensureAdaptiveWorld, refreshAdaptiveTotals } from '../src/sim/adaptive-world'
import { ensureResidentialSites } from '../src/sim/residential-sites'
import { influenceSnapshot } from '../src/sim/settlement-influence'
const executor = new InfluencePool(
  () => {
    const worker = new Worker(new URL('./fixtures/influence-thread.mjs', import.meta.url))
    worker.on('error', () => {})
    return worker
  },
  Math.min(8, Math.max(2, availableParallelism() - 2)),
)
const timed = <T>(f: () => T) => {
  const start = performance.now()
  const result = f()
  return { result, ms: performance.now() - start }
}
const results = []
try {
  executor.solve(influenceFixture())
  for (const [name, factory] of [
    ['dense-65536-homes', () => influenceFixture(16, 16, 256, 64)],
    ['dense-1048576-homes', () => influenceFixture(16, 16, 4096, 64)],
    [
      'world-129024-terrain-samples',
      () => {
        const world = generateWorld('Parallel influence qualification', 3, 32, undefined, 'world')
        ensureFirms(world)
        ensureAdaptiveWorld(world)
        ensureResidentialSites(world)
        refreshAdaptiveTotals(world)
        tick(world)
        return influenceSnapshot(world).input
      },
    ],
  ] as const) {
    const prepared = timed(factory),
      input = prepared.result
    const serial = timed(() => solveInfluence(input))
    const parallel = timed(() => executor.solve(input))
    assert.deepEqual(parallel.result, serial.result)
    assert(executor.lastRun.workers >= 2)
    const record = {
      scenario: name,
      homes: input.targets.length / 4,
      treeNodes: input.nodes.length / 6,
      batches: input.batches.length - 1,
      workers: executor.lastRun.workers,
      preparationMs: Math.round(prepared.ms),
      serialMs: Math.round(serial.ms),
      parallelMs: Math.round(parallel.ms),
      speedup: +(serial.ms / parallel.ms).toFixed(2),
      identical: true,
      snapshotMB: +(
        (input.offsets.byteLength +
          input.edges.byteLength +
          input.costs.byteLength +
          input.terrain.byteLength +
          input.roots.byteLength +
          input.nodes.byteLength +
          input.targets.byteLength +
          input.batches.byteLength) /
        1048576
      ).toFixed(2),
    }
    results.push(record)
    console.log(JSON.stringify(record))
  }
  const report = {
    date: '2026-10-26',
    cpu: cpus()[0].model,
    availableCores: availableParallelism(),
    scope:
      'Influence-field kernel only; preparation includes generation for World scenario. Does not establish full-engine throughput.',
    results,
  }
  writeFileSync(
    process.argv[2] ?? 'docs/validation/parallel-influence-2026-10-26.json',
    JSON.stringify(report, null, 2) + '\n',
  )
} finally {
  executor.dispose()
}
