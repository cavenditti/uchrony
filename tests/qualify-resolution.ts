/** Paired spatial closure experiments. These test partition independence, not historical accuracy. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { generateWorld } from '../src/sim/generate'
import { ensureFirms } from '../src/sim/firms'
import { ensureDistrictEconomy } from '../src/sim/districts'
import { ensureAdaptiveWorld, rebuildAdaptiveMesh } from '../src/sim/adaptive-world'
import { householdAccount, transfer } from '../src/sim/ledger'
import { population, type World } from '../src/sim/types'
import { commuteFlows } from '../src/sim/commute-ledger'
import { validateWorld } from '../src/sim/persistence'
import { tick } from '../src/sim/engine'
import { transportNetwork } from '../src/sim/transport'

const output = process.argv[2] ?? '/private/tmp/uchrony-adaptive-resolution.json'
const names = [
  'uniform-prices',
  'mine-bottleneck',
  'port',
  'polycentric',
  'deprivation',
  'network-disruption',
]
const fingerprint = (w: World) => {
  const { tree: _tree, revision: _revision, mode: _mode, ...spatial } = w.adaptive!
  return createHash('sha256')
    .update(JSON.stringify({ ...w, adaptive: spatial }))
    .digest('hex')
}
const source = createHash('sha256')
for (const file of readdirSync('src/sim')
  .filter((f) => f.endsWith('.ts'))
  .sort())
  source.update(file).update(readFileSync(`src/sim/${file}`))
let providerCalls = 0
globalThis.fetch = (async () => {
  providerCalls++
  throw new Error('Network forbidden')
}) as typeof fetch
const report: any = {
  modelHash: source.digest('hex'),
  months: 12,
  pairedSeeds: 2,
  tolerance: 0,
  interpretation:
    'Exact retained firms, household pools and contracts; this does not validate a compressed heterogeneous closure.',
  providerCalls: 0,
  cases: [],
  failure: null,
}
if (process.argv.includes('--resume') && existsSync(output)) {
  const earlier = JSON.parse(readFileSync(output, 'utf8'))
  assert.equal(earlier.modelHash, report.modelHash, 'Cannot reuse evidence from a different implementation')
  report.cases = earlier.cases.filter((result: { comparisons: unknown[] }) => result.comparisons.length === 4)
}
const metrics = (w: World, founders: Set<number>) => {
  let work = 0,
    minutes = 0
  for (const flow of commuteFlows(w)) {
    work += flow.workers
    minutes += flow.minutes * flow.workers
  }
  const units = w.localEconomy!.active.map((id) => w.localEconomy!.units[id])
  const total = units.reduce((s, r) => s + population(r), 0)
  return {
    population: w.totals.population,
    realOutput: w.economy!.totals.realOutput,
    priceIndex: w.economy!.totals.priceIndex,
    unemployment: w.economy!.totals.unemployment,
    foodAccess: units.reduce((s, r) => s + r.foodCoverage * population(r), 0) / total,
    meanCommuteMinutes: minutes / Math.max(1, work),
    populationConcentration: units.reduce((s, r) => s + (population(r) / total) ** 2, 0),
    survivingFirms: w.economy!.firms!.filter((f) => f.active && founders.has(f.id)).length,
  }
}
try {
  for (const name of names)
    for (let seed = 0; seed < 2; seed++) {
      if (
        report.cases.some(
          (result: { name: string; seed: number }) => result.name === name && result.seed === seed,
        )
      )
        continue
      const w = generateWorld(`Resolution ${name} ${seed}`)
      ensureDistrictEconomy(w)
      ensureFirms(w)
      ensureAdaptiveWorld(w)
      const units = w.localEconomy!.active.map((id) => w.localEconomy!.units[id])
      const evidence: Record<string, unknown> = {}
      // Explicit opening conditions, shared byte-for-byte across all three resolution arms.
      if (name === 'uniform-prices') for (const r of units) r.prices = { ...units[0].prices }
      if (name === 'mine-bottleneck') {
        const mine = Object.values(w.localEconomy!.reserves).reduce((a, b) => (a.iron > b.iron ? a : b))
        for (const reserve of Object.values(w.localEconomy!.reserves)) if (reserve !== mine) reserve.iron = 0
        const r = units.find((u) => u.cells.some((c) => w.localEconomy!.reserves[c] === mine))!
        w.regions[r.province].infrastructure = 0.05
        evidence.minePool = r.id
        evidence.ore = mine.iron
      }
      if (name === 'port') {
        const sea = transportNetwork(w).links.filter((r) => r.legs.some((l) => l.mode === 'sea'))
        assert(sea.length > 0)
        evidence.seaRoutes = sea.length
      }
      if (name === 'polycentric') {
        const pool = units.filter((u) => u.cells.length >= 4).sort((a, b) => population(b) - population(a))[0]
        const first = pool.cells[0],
          second = pool.cells.at(-1)!,
          total = population(pool)
        for (const c of pool.cells) pool.residents[c] = 0
        pool.residents[first] = Math.floor(total / 2)
        pool.residents[second] = total - pool.residents[first]
        for (const c of [first, second]) {
          const home = w.adaptive!.sites[`home:${c}`]
          home.capacity = home.openingCapacity = pool.residents[c] * 1.15
        }
        evidence.centers = [first, second]
        evidence.residents = total
      }
      if (name === 'deprivation') {
        for (const r of units)
          transfer(
            w,
            householdAccount(r.id, 'laborer'),
            householdAccount(r.id, 'owner'),
            w.economy!.households[r.id].laborer.cash * 0.9,
            'opening distribution experiment',
          )
        evidence.laborerCashShareRetained = 0.1
      }
      if (name === 'network-disruption') {
        const route = transportNetwork(w).links.find((r) => r.legs.some((l) => l.mode === 'land'))!
        assert(route)
        const land = route.legs!.flatMap((l) => l.cells).filter((c) => w.cells[c].terrain !== 'water')
        const region = w.cells[land[Math.floor(land.length / 2)]].region
        w.regions[region].devastation = 0.95
        evidence.closedRegion = region
      }
      const worlds = ['coarse', 'fine', 'adaptive'].map((mode) => {
        const clone = structuredClone(w)
        rebuildAdaptiveMesh(clone, mode as 'coarse' | 'fine' | 'adaptive')
        return clone
      })
      const founders = new Set(w.economy!.firms!.map((f) => f.id))
      const result = { name, seed, evidence, comparisons: [] as unknown[] }
      report.cases.push(result)
      for (let month = 1; month <= report.months; month++) {
        for (const world of worlds) tick(world)
        if (month % 3 === 0) {
          const hashes = worlds.map(fingerprint)
          assert.equal(hashes[0], hashes[1])
          assert.equal(hashes[0], hashes[2])
          for (const world of worlds) validateWorld(world)
          const values = worlds.map((world) => metrics(world, founders))
          assert.deepEqual(values[0], values[1])
          assert.deepEqual(values[0], values[2])
          result.comparisons.push({
            month,
            values: values[0],
            maximumDifference: 0,
            leaves: worlds.map((world) => world.adaptive!.tree.leaves.length),
          })
        }
      }
      report.providerCalls = providerCalls
      writeFileSync(output, JSON.stringify(report, null, 2))
      console.log(JSON.stringify({ name, seed, passed: true }))
    }
} catch (error) {
  report.failure = String(error)
  process.exitCode = 1
}
report.providerCalls = providerCalls
writeFileSync(output, JSON.stringify(report, null, 2))
if (report.failure) console.error(report.failure)
