import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { tick } from '../src/sim/engine'
import { validateWorld } from '../src/sim/persistence'
for (const seed of ['A world unwritten', 'Long winter', 'Maritime republics']) {
  const w = generateWorld(seed),
    start = performance.now()
  for (let i = 0; i < 2400; i++) {
    const before = w.totals.population
    tick(w)
    assert.equal(w.totals.population, before + w.totals.births - w.totals.deaths)
    if (i % 120 === 0) validateWorld(w)
  }
  validateWorld(w)
  console.log(
    JSON.stringify({
      seed,
      years: w.month / 12,
      ms: Math.round(performance.now() - start),
      population: w.totals.population,
      states: w.nations.filter((n) => n.population > 0).length,
      routes: w.routes.length,
      events: w.nextEvent - 1,
    }),
  )
}
