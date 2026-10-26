/** Final-source restore/continuation evidence for completed spatial qualifications. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { restoreWorld, validateWorld } from '../src/sim/persistence'
import { packWorldSave } from '../src/sim/save-codec'
import { tick } from '../src/sim/engine'
import { allForces } from '../src/sim/forces'
import { population, type World } from '../src/sim/types'
const [output, ...paths] = process.argv.slice(2)
assert(output && paths.length, 'Pass an output report and checkpoint files')
let providerCalls = 0
globalThis.fetch = (async () => {
  providerCalls++
  throw new Error('Network forbidden')
}) as typeof fetch
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const source = createHash('sha256')
for (const file of readdirSync('src/sim')
  .filter((f) => f.endsWith('.ts'))
  .sort())
  source.update(file).update(readFileSync('src/sim/' + file))
const people = (w: World) =>
  w.regions.reduce((s, r) => s + population(r), 0) + allForces(w).reduce((s, f) => s + f.soldiers, 0)
const report = {
  modelHash: source.digest('hex'),
  providerCalls: 0,
  checkpoints: [] as Record<string, unknown>[],
}
for (const path of paths) {
  const encoded = readFileSync(path, 'utf8'),
    world = restoreWorld(JSON.parse(encoded)),
    initialMonth = world.month
  validateWorld(world)
  const canonicalHash = hash(world),
    packed = JSON.stringify(packWorldSave(world)),
    restored = restoreWorld(JSON.parse(packed))
  assert.equal(hash(restored), canonicalHash, 'Compressed restoration differs')
  assert.equal(hash(world), canonicalHash, 'Encoding mutated canonical state')
  const opening = people(world)
  tick(world)
  tick(restored)
  validateWorld(world)
  validateWorld(restored)
  assert.equal(people(world), opening + world.totals.births - world.totals.deaths)
  const continuationHash = hash(world)
  assert.equal(hash(restored), continuationHash, 'Restored continuation diverged')
  report.checkpoints.push({
    path,
    seed: world.seed,
    initialMonth,
    continuedMonth: world.month,
    encodedBytes: Buffer.byteLength(encoded),
    encodedHash: createHash('sha256').update(encoded).digest('hex'),
    canonicalHash,
    continuationHash,
    roundTripExact: true,
    continuationExact: true,
    people: people(world),
    activeLeaves: world.adaptive!.tree.leaves.length,
    sites: Object.keys(world.adaptive!.sites).length,
    householdPools: world.localEconomy!.active.length,
    activeFirms: world.economy!.firms!.filter((f) => f.active).length,
  })
  assert.equal(providerCalls, 0)
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ seed: world.seed, month: world.month, passed: true }))
}
