import { generateWorld } from '../src/sim/generate.ts'
import { tick } from '../src/sim/engine.ts'
import { GOODS } from '../src/sim/types.ts'
// Descriptive check: 20-year runs, measured after the first five years.
// Reallocation is sum(abs(current - previous)) / sum(current + previous)
// over supplier, buyer and good; continuity weights recurring suppliers by tonnes.
const output = []
for (const seed of ['A world unwritten', 'Long winter', 'Maritime republics']) {
  const w = generateWorld(seed)
  let prior = new Map<string, number>(),
    churn = 0,
    retained = 0,
    weight = 0,
    months = 0
  for (let i = 0; i < 240; i++) {
    tick(w)
    const current = new Map<string, number>()
    for (const r of w.routes)
      for (const good of GOODS)
        if (r.goods[good] > 0.1) current.set(`${r.from}-${r.to}-${good}`, r.goods[good])
    if (i >= 60) {
      let delta = 0,
        total = 0
      for (const key of new Set([...prior.keys(), ...current.keys()])) {
        const a = prior.get(key) ?? 0,
          b = current.get(key) ?? 0
        delta += Math.abs(a - b)
        total += a + b
      }
      if (total) {
        churn += delta / total
        months++
      }
      for (const [key, amount] of current) {
        weight += amount
        if (prior.has(key)) retained += amount
      }
    }
    prior = current
  }
  output.push({
    seed,
    months,
    meanMonthlyReallocation: churn / months,
    freightWithPreviousMonthSupplier: retained / weight,
  })
}
console.log(JSON.stringify(output, null, 2))
