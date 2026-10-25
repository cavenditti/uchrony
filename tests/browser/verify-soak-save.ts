/** Check a paused UI export against both actual save replicas, without loading three worlds. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open, readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { restoreWorld, validateWorld } from '../../src/sim/persistence'
import { worldBlob } from '../../src/storage/json-blob'

const [exportPath, browserPath, diskPath, resultPath] = process.argv.slice(2)
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
const holders = [...world.regions, ...world.armies, ...(world.warfare?.fleets ?? [])]
const result = {
  valid: true,
  replicasMatchExport: true,
  sha256: expected,
  seed: world.seed,
  month: world.month,
  cells: world.cells.length,
  regions: world.regions.length,
  communities: holders.reduce((n, h) => n + (h.communities?.length ?? 0), 0),
  cohortTuples: holders.reduce(
    (n, h) => n + (h.communities ?? []).reduce((s, g) => s + (g.ageCohorts?.length ?? 0), 0),
    0,
  ),
  browser,
  disk,
}
await writeFile(resultPath, JSON.stringify(result, null, 2) + '\n')
console.log(result)
