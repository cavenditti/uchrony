/** Check a paused UI export against both actual save replicas, without loading three worlds. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open, readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { restoreWorld, validateWorld } from '../../src/sim/persistence'
import { worldBlob } from '../../src/storage/json-blob'
import { canonicalHash } from '../fixtures/world-hash'

const [exportPath, browserPath, diskPath, resultPath, recoveryPath] = process.argv.slice(2)
assert(
  exportPath && browserPath && diskPath && resultPath,
  'Pass export, browser replica, disk replica, result',
)
const world = restoreWorld(JSON.parse(await readFile(exportPath, 'utf8')))
validateWorld(world)
const hash = createHash('sha256')
for await (const chunk of worldBlob(world).stream()) hash.update(chunk)
const expected = hash.digest('hex')

async function replica(path: string, disk: boolean) {
  const file = await open(path, 'r')
  let size: number, start: number, suffix: string, savedAt: number
  try {
    size = (await file.stat()).size
    const head = Buffer.alloc(200),
      tail = Buffer.alloc(100)
    await file.read(head, 0, head.length, 0)
    await file.read(tail, 0, tail.length, size - tail.length)
    const prefix = head.toString().match(/^\{"version":1,"savedAt":(\d+),"world":/)
    assert(prefix, 'Unexpected save envelope')
    start = Buffer.byteLength(prefix[0])
    savedAt = Number(prefix[1])
    suffix = disk ? tail.toString().match(/,"checksum":"([a-f0-9]{64})"\}$/)![0] : '}'
    assert(suffix)
    if (disk) assert.equal(JSON.parse(`{${suffix.slice(1)}`).checksum, expected)
  } finally {
    await file.close()
  }
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path, { start, end: size - Buffer.byteLength(suffix) - 1 }))
    digest.update(chunk)
  assert.equal(digest.digest('hex'), expected, `${disk ? 'Disk' : 'Browser'} world differs from export`)
  return { bytes: size, savedAt }
}
const browser = await replica(browserPath, false),
  disk = await replica(diskPath, true)
assert.equal(browser.savedAt, disk.savedAt, 'Replicas are not the same checkpoint')
// A tool restart can discard its disposable browser profile. If recovery was
// needed, prove the recovered/exported world still equals the original end save.
const recoveredFromEnduranceDisk = recoveryPath ? await replica(recoveryPath, true) : undefined
const holders = [...world.regions, ...world.armies, ...(world.warfare?.fleets ?? [])]
const result = {
  valid: true,
  replicasMatchExport: true,
  sha256: expected,
  canonicalHash: canonicalHash(world),
  seed: world.seed,
  month: world.month,
  cells: world.cells.length,
  regions: world.regions.length,
  activeLeaves: world.adaptive?.tree.leaves.length ?? 0,
  sites: Object.keys(world.adaptive?.sites ?? {}).length,
  activeFirms: world.economy?.firms?.filter((f) => f.active).length ?? 0,
  householdPools: world.localEconomy?.active.length ?? world.regions.length,
  communities: holders.reduce((n, h) => n + (h.communities?.length ?? 0), 0),
  cohortTuples: holders.reduce(
    (n, h) => n + (h.communities ?? []).reduce((s, g) => s + (g.ageCohorts?.length ?? 0), 0),
    0,
  ),
  browser,
  disk,
  ...(recoveredFromEnduranceDisk ? { recoveredFromEnduranceDisk } : {}),
}
await writeFile(resultPath, JSON.stringify(result, null, 2) + '\n')
console.log(result)
