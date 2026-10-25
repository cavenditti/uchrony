import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { tick } from '../src/sim/engine'
import { balances } from '../src/sim/ledger'
import { parseSave, validateWorld } from '../src/sim/persistence'
import { packWorldSave, unpackWorldSave } from '../src/sim/save-codec'
import type { World } from '../src/sim/types'

// Run separately from the endurance process so restoration does not reuse its caches.
const path = process.argv[2]
const expectedMonth = Number(process.argv[3] ?? 2400)
if (!path || !Number.isSafeInteger(expectedMonth) || expectedMonth < 1)
  throw new Error('Usage: tests/verify-soak.ts checkpoint-path [expected-month, default 2400]')
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const sourceHash = createHash('sha256')
for (const name of readdirSync(new URL('../src/sim', import.meta.url))
  .filter((name) => name.endsWith('.ts'))
  .sort()) {
  sourceHash.update(name)
  sourceHash.update(readFileSync(new URL('../src/sim/' + name, import.meta.url)))
}
const revision = sourceHash.digest('hex')
const bytes = readFileSync(path, 'utf8')
const trajectory = JSON.parse(readFileSync(path + '.progress.json', 'utf8'))
assert.equal(trajectory.revision, revision)
assert.equal(trajectory.observedFromMonth, 0, 'the trajectory must include the initial world')
assert.equal(trajectory.throughMonth, expectedMonth)
assert.equal(trajectory.annual.length, Math.floor(expectedMonth / 12))
trajectory.annual.forEach((year: { month: number }, i: number) => assert.equal(year.month, (i + 1) * 12))

// Finish one world before loading the other, so two mature censuses need not
// remain live together. The hash still covers every serialized state field.
const continuedHash = (() => {
  const raw = unpackWorldSave(JSON.parse(bytes)) as World
  validateWorld(raw)
  assert.equal(raw.month, expectedMonth)
  tick(raw)
  validateWorld(raw)
  return sha(JSON.stringify(packWorldSave(raw)))
})()
const restored = parseSave(bytes)
assert.equal(restored.seed, trajectory.seed)
assert.equal(JSON.stringify(packWorldSave(restored)), bytes, 'restoration must preserve every saved byte')
const economy = restored.economy!
const firms = economy.firms!.filter((f) => f.active)
const privateJobs = firms.reduce((sum, f) => sum + f.employment, 0)
const minimumWageJobs = firms
  .filter((f) => f.wage <= 0.00005000000001)
  .reduce((sum, f) => sum + f.employment, 0)
const final = {
  month: restored.month,
  population: restored.totals.population,
  states: restored.nations.filter((n) => n.population > 0).length,
  districts: restored.localEconomy!.active.length,
  food: restored.history.at(-1)!.food,
  priceIndex: economy.totals.priceIndex,
  unemployment: economy.totals.unemployment,
  nationalAccounts: structuredClone(economy.accounts!.world),
  moneyResidual: economy.ledger.discrepancy,
  bankResidual: economy.banking!.discrepancy,
  goodsResidual: Math.max(...Object.values(economy.goods!.residual).map(Math.abs)),
  money: Object.values(balances(restored)).reduce((sum, value) => sum + value, 0),
  createdDeposits: economy.banking!.created,
  destroyedDeposits: economy.banking!.destroyed,
  activeFirms: firms.length,
  employmentAtWageMinimum: privateJobs ? minimumWageJobs / privateJobs : 0,
  employmentWeightedWage: privateJobs
    ? firms.reduce((sum, f) => sum + f.wage * f.employment, 0) / privateJobs
    : 0,
  firmEntries: economy.firmEntries,
  firmExits: economy.firmExits,
  technologies: restored.nations.map((n) => ({ id: n.id, name: n.name, levels: { ...n.technologies } })),
}
// Compare the decoded snapshot directly against the public validated restore path.
// Both build fresh transient indices; neither inherits the original process's caches.
tick(restored)
validateWorld(restored)
assert.equal(
  sha(JSON.stringify(packWorldSave(restored))),
  continuedHash,
  'restoration changes the next month',
)
console.log(
  JSON.stringify({
    seed: trajectory.seed,
    revision,
    bytes: Buffer.byteLength(bytes),
    checkpointSha256: sha(bytes),
    exactRestoration: true,
    identicalContinuation: true,
    continuedThroughMonth: restored.month,
    continuedSha256: continuedHash,
    final,
    trajectory,
  }),
)
