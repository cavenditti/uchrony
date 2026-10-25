import { writeFileSync, renameSync, readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { tick } from '../src/sim/engine'
import { validateWorld, parseSave } from '../src/sim/persistence'
import { balances } from '../src/sim/ledger'
import { population, type World } from '../src/sim/types'
import { allForces } from '../src/sim/forces'
const people = (w: World) =>
  w.regions.reduce((sum, r) => sum + population(r), 0) + allForces(w).reduce((sum, a) => sum + a.soldiers, 0)
// Short runs make bounded scenario checks reproducible; the default remains three 200-year runs.
const args = process.argv.slice(2)
let months = 2400
let snapshot: string | undefined
let resume: string | undefined
let seeds = ['A world unwritten', 'Long winter', 'Maritime republics']
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--months') months = Number(args[++i])
  else if (args[i] === '--resume' && args[i + 1]) resume = args[++i]
  else if (args[i] === '--snapshot' && args[i + 1]) snapshot = args[++i]
  else if (args[i] === '--seed' && args[i + 1]) seeds = [args[++i]]
  else
    throw new Error(
      'Usage: tests/soak.ts [--months positive-integer] [--seed scenario-name] [--snapshot absolute-path-with-optional-{seed}] [--resume saved-world-path]',
    )
}
if (!Number.isSafeInteger(months) || months < 1) throw new Error('Months must be a positive integer.')
const restored = resume ? parseSave(readFileSync(resume, 'utf8')) : undefined
if (restored) seeds = [restored.seed]
for (const seed of seeds) {
  const w = restored ?? generateWorld(seed),
    start = performance.now()
  const observedFromMonth = w.month
  const checkpoint = snapshot?.replace('{seed}', seed.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
  const extrema = { minimumFood: 1, maximumUnemployment: 0, minimumPrices: Infinity, maximumPrices: 0 }
  const initialMoney =
    Object.values(balances(w)).reduce((sum, value) => sum + value, 0) -
    (w.economy!.banking?.created ?? 0) +
    (w.economy!.banking?.destroyed ?? 0)
  for (let i = w.month; i < months; i++) {
    const before = people(w)
    try {
      tick(w)
      assert.equal(w.totals.population, before + w.totals.births - w.totals.deaths)
      assert.equal(people(w), w.totals.population)
    } catch (error) {
      console.error(JSON.stringify({ seed, failedAt: w.month }))
      if (checkpoint) writeFileSync(checkpoint + '.failed.json', JSON.stringify(w))
      throw error
    }
    assert.equal(
      w.regions.reduce((sum, r) => sum + r.migration, 0),
      0,
    )
    extrema.minimumFood = Math.min(extrema.minimumFood, w.history.at(-1)!.food)
    extrema.maximumUnemployment = Math.max(extrema.maximumUnemployment, w.economy!.totals.unemployment)
    extrema.minimumPrices = Math.min(extrema.minimumPrices, w.economy!.totals.priceIndex)
    extrema.maximumPrices = Math.max(extrema.maximumPrices, w.economy!.totals.priceIndex)
    if (i === observedFromMonth || w.month % 12 === 0) {
      validateWorld(w)
      if (checkpoint) {
        writeFileSync(checkpoint + '.tmp', JSON.stringify(w))
        renameSync(checkpoint + '.tmp', checkpoint)
      }
      const money = Object.values(balances(w)).reduce((sum, value) => sum + value, 0)
      assert(
        Math.abs(money - initialMoney - w.economy!.banking!.created + w.economy!.banking!.destroyed) <
          Math.max(1, initialMoney) * 1e-9,
      )
      console.log(
        JSON.stringify({
          seed,
          month: w.month,
          seconds: Math.round((performance.now() - start) / 1000),
          communities: w.regions.reduce((s, r) => s + (r.communities?.length ?? 0), 0),
          people: w.totals.population,
          moneyResidual: w.economy!.ledger.discrepancy,
          bankResidual: w.economy!.banking!.discrepancy,
          gdpResidual: w.economy!.accounts!.world.discrepancy,
          food: w.history.at(-1)!.food,
          prices: w.economy!.totals.priceIndex,
          unemployment: w.economy!.totals.unemployment,
          firms: w.economy!.firms!.filter((f) => f.active).length,
        }),
      )
    }
  }
  validateWorld(w)
  // Annual history is retained indefinitely; only monthly detail is limited to ten years.
  assert(w.history.length <= 121 + Math.ceil(Math.max(0, w.month - 120) / 12))
  assert.equal(new Set(w.history.map((point) => point.month)).size, w.history.length)
  assert(w.history.every((point) => point.month >= w.month - 120 || point.month % 12 === 0))
  assert.equal(w.history.at(-1)?.month, w.month)
  assert(people(w) > 0)
  if (w.month >= 1200) assert(w.nations.some((n) => n.technologies.medicine > 0))
  if (checkpoint) {
    writeFileSync(checkpoint + '.tmp', JSON.stringify(w))
    renameSync(checkpoint + '.tmp', checkpoint)
  }
  console.log(
    JSON.stringify({
      seed,
      observedFromMonth,
      ...extrema,
      years: w.month / 12,
      ms: Math.round(performance.now() - start),
      population: w.totals.population,
      states: w.nations.filter((n) => n.population > 0).length,
      routes: w.routes.length,
      events: w.nextEvent - 1,
      bankResidual: w.economy!.banking!.discrepancy,
      gdpResidual: w.economy!.accounts!.world.discrepancy,
      firmEntries: w.economy!.firmEntries,
      firmExits: w.economy!.firmExits,
      moneyResidual: w.economy!.ledger.discrepancy,
      goodsResidual: Math.max(...Object.values(w.economy!.goods!.residual).map(Math.abs)),
      foodCoverage: w.history.at(-1)!.food,
      unemployment: w.economy!.totals.unemployment,
      priceIndex: w.economy!.totals.priceIndex,
    }),
  )
}
