import { browserInfluencePool } from '../../src/sim/influence-runtime'
import { solveInfluence } from '../../src/sim/influence-kernel'
import { influenceFixture } from '../fixtures/influence'
import { generateWorld } from '../../src/sim/generate'
import { tick } from '../../src/sim/engine'
import { setInfluenceExecutor } from '../../src/sim/settlement-influence'
import { validateWorld, restoreWorld } from '../../src/sim/persistence'
import { packWorldSave } from '../../src/sim/save-codec'
self.onmessage = async () => {
  const pool = browserInfluencePool(4)!
  try {
    if (!pool) throw new Error('Shared memory isolation unavailable')
    await pool.warmup()
    const input = influenceFixture(),
      expected = solveInfluence(input),
      actual = pool.solve(input)
    if (!actual.every((v, i) => v === expected[i]) || pool.lastRun.workers !== 4)
      throw new Error(
        `Parallel field mismatch/fallback: ${JSON.stringify(pool.lastRun)}; mismatch ${actual.findIndex((v, i) => v !== expected[i])}`,
      )
    self.postMessage({ stage: 'Nested workers identical; generating World scale' })
    const world = generateWorld('Browser parallel influence', 3, 32, undefined, 'world')
    setInfluenceExecutor((input) => pool.solve(input))
    const start = performance.now()
    tick(world)
    const ms = performance.now() - start
    validateWorld(world)
    const restored = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(world))))
    validateWorld(restored)
    self.postMessage({
      complete: true,
      isolated: self.crossOriginIsolated,
      workers: pool.lastRun.workers,
      cells: world.cells.length,
      month: world.month,
      population: world.totals.population,
      restoredPopulation: restored.totals.population,
      fieldIdentical: true,
      monthMs: Math.round(ms),
      sites: Object.keys(world.adaptive!.sites).length,
      leaves: world.adaptive!.tree.leaves.length,
    })
  } catch (error) {
    self.postMessage({ error: String(error) })
  } finally {
    pool.dispose()
  }
}
