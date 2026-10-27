/** Long, model-free urban trajectories. Run against a frozen source checkout.
 * node --import tsx tests/urban-calibration.ts --seed "Urban estuary" --months 600 --output /tmp/urban.json
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import type { World } from '../src/sim/types'

const args = process.argv.slice(2)
let seed = 'Urban estuary',
  months = 600,
  start: 'frontier' | 'settled' = 'frontier'
let output = '/tmp/urban-calibration.json'
let engineRoot = fileURLToPath(new URL('../', import.meta.url))
let resume: string | undefined
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--seed') seed = args[++i]
  else if (args[i] === '--months') months = Number(args[++i])
  else if (args[i] === '--start' && ['frontier', 'settled'].includes(args[i + 1]))
    start = args[++i] as typeof start
  else if (args[i] === '--output') output = args[++i]
  else if (args[i] === '--engine-root') engineRoot = resolve(args[++i])
  else if (args[i] === '--resume') resume = resolve(args[++i])
  else throw new Error('Unknown or invalid argument: ' + args[i])
}
assert(Number.isSafeInteger(months) && months > 0)
const moduleAt = (name: string) => import(pathToFileURL(resolve(engineRoot, 'src/sim', name + '.ts')).href)
const { generateWorld } = await moduleAt('generate')
const { prepareSpatialWorld, tick } = await moduleAt('engine')
assert.equal(
  typeof prepareSpatialWorld,
  'function',
  'Select an engine root with month-zero spatial preparation and frontier support',
)
const { validateWorld, parseSave } = (await moduleAt(
  'persistence',
)) as typeof import('../src/sim/persistence')
const { packWorldSave } = (await moduleAt('save-codec')) as typeof import('../src/sim/save-codec')
const { balances } = (await moduleAt('ledger')) as typeof import('../src/sim/ledger')
const { allForces } = (await moduleAt('forces')) as typeof import('../src/sim/forces')
const { population } = (await moduleAt('types')) as typeof import('../src/sim/types')
const { residentialSites } = (await moduleAt(
  'residential-sites',
)) as typeof import('../src/sim/residential-sites')
const { urbanBlocks } = (await moduleAt('urban-blocks')) as typeof import('../src/sim/urban-blocks')
const { URBAN_INTEGRATION } = (await moduleAt('urban-centres')) as typeof import('../src/sim/urban-centres')
const digest = createHash('sha256')
for (const name of readdirSync(resolve(engineRoot, 'src/sim'))
  .filter((n) => n.endsWith('.ts'))
  .sort()) {
  digest.update(name).update(readFileSync(resolve(engineRoot, 'src/sim', name)))
}
const sourceHash = digest.digest('hex')
const w: World = resume
  ? parseSave(readFileSync(resume, 'utf8'))
  : generateWorld(seed, 3, 8, undefined, 'regional', start)
if (resume) {
  seed = w.seed
  start = 'settlementStart' in w && w.settlementStart === 'frontier' ? 'frontier' : 'settled'
}
assert(
  start !== 'frontier' || ('settlementStart' in w && w.settlementStart === 'frontier'),
  'Selected engine does not support frontier starts',
)
prepareSpatialWorld(w)
validateWorld(w)
const fromMonth = w.month
assert(months > fromMonth, '--months is the absolute final month and must follow the checkpoint')
const began = performance.now()
const people = () =>
  w.regions.reduce((n, r) => n + population(r), 0) + allForces(w).reduce((n, a) => n + a.soldiers, 0)
const money = () => Object.values(balances(w)).reduce((a, b) => a + b, 0)
const netMoney = () => money() - (w.economy!.banking?.created ?? 0) + (w.economy!.banking?.destroyed ?? 0)
const initialMoney = netMoney()
const events: { centre: number; name: string; month: number; kind: string; with: number }[] = []
const observed = new Map(w.localEconomy!.cities.map((c) => [c.id, c.history?.length ?? 0]))
const annual: ReturnType<typeof sample>[] = []
let maxMoneyError = 0,
  births = 0,
  deaths = 0
function sample() {
  const cities = w.localEconomy!.cities
  const active = cities.filter((c) => c.absorbedBy === undefined && c.population > 0)
  const homes = residentialSites(w)
  const blocks = urbanBlocks(w)
  const residents = homes.reduce((n, h) => n + (h.residents ?? 0), 0)
  assert.equal(
    blocks.reduce((n, b) => n + b.residents, 0),
    residents,
  )
  const ids = active.flatMap((c) => c.sites ?? [])
  assert.equal(new Set(ids).size, ids.length, 'centre catchments must not double-count housing')
  const byId = new Map(cities.map((c) => [c.id, c]))
  return {
    month: w.month,
    population: people(),
    births,
    deaths,
    activeCentres: active.length,
    dormantCentres: cities.filter((c) => !c.population && c.absorbedBy === undefined).length,
    absorbedCentres: cities.filter((c) => c.absorbedBy !== undefined).length,
    linkedCentres: active.filter((c) => c.metropolis).length,
    incorporatedCentres: active.filter((c) => c.metropolis?.incorporated !== undefined).length,
    urbanPopulation: active.reduce((n, c) => n + c.population, 0),
    largestCentres: [...active]
      .sort((a, b) => b.population - a.population)
      .slice(0, 8)
      .map((c) => ({ id: c.id, name: c.name, population: c.population, standing: c.standing })),
    buildings: homes.filter((h) => h.building && h.capacity > 0).length,
    occupiedBuildings: homes.filter((h) => h.building && (h.residents ?? 0) > 0).length,
    capacity: homes.reduce((n, h) => n + h.capacity, 0),
    pendingCapacity: (w.adaptive!.construction ?? []).reduce((n, p) => n + p.capacity, 0),
    occupiedBlocks: blocks.filter((b) => b.residents > 0).length,
    developedArea: blocks.reduce((n, b) => n + b.builtArea, 0),
    food: w.history.at(-1)?.food,
    unemployment: w.economy!.totals.unemployment,
    relations: active
      .filter((c) => c.metropolis)
      .map((c) => {
        const leader = byId.get(c.metropolis!.centre)!
        return {
          ...c.metropolis,
          centre: c.id,
          leader: leader.id,
          prestigeRatio: leader.standing!.prestige / Math.max(0.01, c.standing!.prestige),
          wealthRatio: (1 + leader.standing!.wealthPerResident) / (1 + c.standing!.wealthPerResident),
        }
      }),
  }
}
function save(complete: boolean, failure?: string) {
  const result = {
    seed,
    start,
    scale: 'regional',
    requestedMonths: months,
    fromMonth,
    throughMonth: w.month,
    sourceHash,
    thresholds: URBAN_INTEGRATION,
    complete,
    failure,
    elapsedSeconds: (performance.now() - began) / 1000,
    maxMoneyError,
    annual,
    events,
  }
  writeFileSync(output + '.tmp', JSON.stringify(result, null, 2))
  renameSync(output + '.tmp', output)
}
annual.push(sample())
save(false)
try {
  for (let i = fromMonth; i < months; i++) {
    const before = people()
    tick(w)
    assert.equal(people(), before + w.totals.births - w.totals.deaths)
    assert.equal(w.totals.population, people())
    assert.equal(
      w.regions.reduce((n, r) => n + r.migration, 0),
      0,
    )
    births += w.totals.births
    deaths += w.totals.deaths
    for (const c of w.localEconomy!.cities) {
      for (const e of (c.history ?? []).slice(observed.get(c.id) ?? 0))
        events.push({ centre: c.id, name: c.name, ...e })
      observed.set(c.id, c.history?.length ?? 0)
    }
    if (w.month % 12 === 0 || w.month === months) {
      validateWorld(w)
      maxMoneyError = Math.max(maxMoneyError, Math.abs(netMoney() - initialMoney))
      assert(maxMoneyError < Math.max(1, Math.abs(initialMoney)) * 1e-8, 'money conservation')
      const row = sample()
      annual.push(row)
      births = deaths = 0
      save(w.month === months)
      console.log(
        JSON.stringify({
          seed,
          month: w.month,
          seconds: Math.round((performance.now() - began) / 1000),
          population: row.population,
          centres: row.activeCentres,
          linked: row.linkedCentres,
          incorporated: row.incorporatedCentres,
          absorbed: row.absorbedCentres,
          buildings: row.buildings,
        }),
      )
      if (w.month % 120 === 0 || w.month === months)
        writeFileSync(output + '.save.json', JSON.stringify(packWorldSave(w)))
    }
  }
} catch (error) {
  save(false, String(error))
  writeFileSync(output + '.failed-save.json', JSON.stringify(packWorldSave(w)))
  throw error
}
