import { restoreWorld, validateWorld } from '../../src/sim/persistence'
import { ensureWarfare } from '../../src/sim/navy'
import { ensurePopulation } from '../../src/sim/population'
import { ensureHistory } from '../../src/sim/history'
import { ensureStatecraft } from '../../src/sim/statecraft'
import { ensureIntelligence } from '../../src/sim/intelligence'
import { tick } from '../../src/sim/engine'
import { worldBlob } from '../../src/storage/json-blob'
let providerCalls = 0
self.fetch = (async () => {
  providerCalls++
  throw new Error('Network forbidden in native replay')
}) as typeof fetch
self.onmessage = async ({ data }: MessageEvent<{ file: File; end: number }>) => {
  try {
    const world = restoreWorld(JSON.parse(await data.file.text()))
    ensureWarfare(world)
    ensurePopulation(world)
    ensureHistory(world)
    ensureStatecraft(world)
    ensureIntelligence(world)
    const initial = world.month
    if (!Number.isSafeInteger(data.end) || data.end <= initial) throw new Error('Invalid final month')
    postMessage({ month: initial, blob: worldBlob(world), providerCalls, userAgent: navigator.userAgent })
    while (world.month < data.end) {
      const start = performance.now()
      tick(world)
      validateWorld(world)
      if (providerCalls) throw new Error('Native replay attempted network access')
      postMessage({
        month: world.month,
        milliseconds: performance.now() - start,
        providerCalls,
        ...(world.month === initial + 1 || world.month === data.end ? { blob: worldBlob(world) } : {}),
        complete: world.month === data.end,
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  } catch (error) {
    postMessage({ error: error instanceof Error ? error.message : String(error), providerCalls })
  }
}
