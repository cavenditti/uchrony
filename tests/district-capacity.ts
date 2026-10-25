// Reproducible full-size resident-economy capacity check; no external model calls.
import { writeFileSync } from 'node:fs'
import { generateWorld } from '../src/sim/generate'
import { tick } from '../src/sim/engine'
import { validateWorld } from '../src/sim/persistence'
import { worldBlob } from '../src/storage/json-blob'
const months = Number(process.argv[2] ?? 6),
  checkpoint = process.argv[3]
if (!Number.isSafeInteger(months) || months < 1) throw new Error('Expected a positive month count')
const start = performance.now(),
  w = generateWorld('District capacity', 3, 32, undefined, 'world')
for (let i = 0; i < months; i++) {
  tick(w)
  validateWorld(w)
  const blob = worldBlob(w)
  console.log(
    JSON.stringify({
      month: w.month,
      cells: w.cells.length,
      provinces: w.regions.length,
      districts: w.localEconomy!.active.length,
      archived: Object.keys(w.localEconomy!.archive ?? {}).length,
      firms: w.economy!.firms!.length,
      communities: w.regions.reduce((sum, r) => sum + r.communities!.length, 0),
      population: w.totals.population,
      saveBytes: blob.size,
      heap: process.memoryUsage().heapUsed,
      seconds: (performance.now() - start) / 1000,
    }),
  )
  if (checkpoint && i === months - 1) writeFileSync(checkpoint, new Uint8Array(await blob.arrayBuffer()))
}
