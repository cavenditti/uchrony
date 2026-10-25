import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { tick } from '../src/sim/engine'
import { allForces, unitLoyalty } from '../src/sim/forces'
import { communitySize, identityDistribution } from '../src/sim/population'
import { validateWorld, parseSave, restoreWorld } from '../src/sim/persistence'
import {
  censusOf,
  censusDistribution,
  mergeCensuses,
  viewSnapshot,
  censusUnitLoyalty,
} from '../src/sim/view-snapshot'
import { SnapshotMailbox } from '../src/sim/snapshot-mailbox'
import { worldBlob } from '../src/storage/json-blob'
import { WorldStorage } from '../src/storage/world-storage'
import type { SaveBackend } from '../src/storage/backends'
import { MessageChannel } from 'node:worker_threads'
import { ByteStorageClient } from '../src/storage/byte-client'

const world = generateWorld('View and save fidelity', 3, 8, undefined, 'regional')
tick(world)

test('compact census preserves identities, strata, ages, fluency and top communities', () => {
  const before = JSON.stringify(world),
    view = { ...viewSnapshot(world), cells: world.cells }
  assert.equal(JSON.stringify(world), before)
  assert(view.regions.every((r) => !r.communities && r.census))
  assert(allForces(world).length > 0)
  allForces(world).forEach((force, i) =>
    assert.deepEqual(censusUnitLoyalty(view, allForces(view)[i]), unitLoyalty(world, force)),
  )
  for (const nation of world.nations) {
    const holders = [
      ...world.regions.filter((r) => r.nation === nation.id),
      ...allForces(world).filter((f) => f.nation === nation.id),
    ]
    const groups = holders.flatMap((h) => h.communities ?? [])
    const census = mergeCensuses(holders.map((h) => censusOf(h, world.month)))
    const total = groups.reduce((sum, g) => sum + communitySize(g), 0)
    assert.equal(census.total, total)
    assert.equal(
      Object.values(census.strata).reduce((sum, n) => sum + n, 0),
      total,
    )
    for (const axis of ['culture', 'language', 'belief', 'movement'] as const)
      assert.deepEqual(censusDistribution(census, axis), identityDistribution(groups, axis))
    const ages = Array.from({ length: 22 }, () => [0, 0])
    for (const g of groups)
      for (const [birth, female, male] of g.ageCohorts ?? []) {
        const bin = Math.min(21, Math.max(0, Math.floor((world.month - birth) / 60)))
        ages[bin][0] += female
        ages[bin][1] += male
      }
    assert.deepEqual(
      census.ageSex.map((b) => [b.female, b.male]),
      ages,
    )
    for (const language of world.demography!.identities.filter((i) => i.kind === 'language')) {
      const expected = groups.reduce(
        (sum, g) =>
          sum +
          communitySize(g) *
            (g.language === language.id ? 1 : g.knownLanguage === language.id ? g.fluency : 0),
        0,
      )
      assert(Math.abs((census.fluent[language.id] ?? 0) - expected) < Math.max(1, expected) * 1e-12)
    }
    assert.deepEqual(
      census.largest,
      [...groups]
        .sort((a, b) => communitySize(b) - communitySize(a))
        .slice(0, 12)
        .map(({ ageCohorts: _, ...g }) => g),
    )
  }
  assert.throws(() => validateWorld(view), /display snapshots/)
  assert.throws(() => worldBlob(view), /display snapshot/)
})

test('byte snapshots preserve the complete canonical world at capture time', async () => {
  const expected = JSON.stringify(world),
    savedAt = Date.now()
  const exported = worldBlob(world),
    saved = worldBlob(world, savedAt)
  const old = world.month
  world.month++
  assert.equal(JSON.stringify(parseSave(await exported.text())), expected)
  const record = JSON.parse(await saved.text())
  assert.equal(record.version, 1)
  assert.equal(record.savedAt, savedAt)
  assert.equal(JSON.stringify(restoreWorld(record.world)), expected)
  world.month = old
})

test('UI backpressure coalesces worlds without dropping command acknowledgements', () => {
  let revision = 1
  const received: unknown[] = []
  const mailbox = new SnapshotMailbox((message, acknowledgement) =>
    received.push({ revision, message, acknowledgement }),
  )
  mailbox.publish()
  for (revision = 2; revision <= 100; revision++)
    mailbox.publish(revision === 50 ? 'Order accepted' : undefined, revision === 50)
  assert.equal(received.length, 1)
  revision = 100
  mailbox.acknowledge()
  assert.deepEqual(received[1], { revision: 100, message: 'Order accepted', acknowledgement: true })
  mailbox.acknowledge()
  assert.equal(received.length, 2)
  mailbox.reset()
  mailbox.publish()
  assert.equal(received.length, 3)
})

test('saves share immutable bytes, bound concurrent writes, retry failures and discard stale status', async () => {
  let release!: () => void,
    calls = 0
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const blobs: Blob[] = [],
    reports: { state: string; month: number }[] = []
  const backend = (name: 'disk' | 'browser'): SaveBackend => ({
    name,
    async read() {
      return null
    },
    async write() {
      throw new Error('Unexpected object clone')
    },
    async writeBlob(blob) {
      calls++
      blobs.push(blob)
      await gate
    },
  })
  const storage = new WorldStorage([backend('disk'), backend('browser')], (s) => reports.push(s))
  const flight = storage.save(world, 1)
  for (let i = 0; i < 100; i++) storage.save(world, 2)
  assert.equal(calls, 2)
  assert.equal(blobs[0], blobs[1])
  storage.reset()
  release()
  await flight
  assert.deepEqual(
    reports.map((s) => s.state),
    ['saving'],
  )
  await storage.save(world, 3)
  assert.equal(calls, 4)
  await storage.save(world, 3)
  assert.equal(calls, 4)
  await storage.save(world, 3, true)
  assert.equal(calls, 6)
})

test('partial saves report the failed replica and retry unchanged paused worlds', async () => {
  let fails = true,
    diskWrites = 0
  const reports: { state: string; source?: string; message?: string; replicas?: string[] }[] = []
  const disk: SaveBackend = {
    name: 'disk',
    async read() {
      return null
    },
    async write() {},
    async writeBlob() {
      diskWrites++
      if (fails) throw new Error('Disk full')
    },
  }
  const browser: SaveBackend = {
    name: 'browser',
    async read() {
      return null
    },
    async write() {},
    async writeBlob() {},
  }
  const storage = new WorldStorage([disk, browser], (status) => reports.push(status))
  await storage.save(world, 1)
  assert.equal(reports.at(-1)?.source, 'browser')
  assert.match(reports.at(-1)?.message ?? '', /disk:.*Disk full/)
  fails = false
  await storage.save(world, 1)
  assert.equal(diskWrites, 2)
  assert.deepEqual(reports.at(-1)?.replicas, ['disk', 'browser'])
  await storage.save(world, 1)
  assert.equal(diskWrites, 2)
  const unavailable = new WorldStorage([{ ...disk, writeBlob: undefined }], (s) => reports.push(s))
  await unavailable.save(world, 2)
  assert.equal(reports.at(-1)?.state, 'error')
  assert.match(reports.at(-1)?.message ?? '', /previous save remains intact/)
})

test('invalid simulation state cannot overwrite either good replica', async () => {
  let writes = 0
  const reports: { state: string; message?: string }[] = []
  const backend: SaveBackend = {
    name: 'browser',
    async read() {
      return null
    },
    async write() {},
    async writeBlob() {
      writes++
    },
  }
  const storage = new WorldStorage([backend], (s) => reports.push(s))
  await storage.save(world, 1)
  assert.equal(writes, 1)
  await storage.save({ ...world, rng: NaN }, 2)
  assert.equal(writes, 1)
  assert.equal(reports.at(-1)?.state, 'error')
  assert.match(reports.at(-1)?.message ?? '', /non-finite/)
})

test('save I/O uses a private byte channel and recovers after a writer disconnects', async () => {
  const client = new ByteStorageClient(),
    channel = new MessageChannel()
  client.connect(channel.port1 as unknown as MessagePort)
  const bodies: string[] = []
  channel.port2.on('message', async ({ id, blob, backend }) => {
    assert.equal(backend, 'disk')
    bodies.push(await blob.text())
    channel.port2.postMessage({ id })
  })
  await client.backend('disk').writeBlob!(new Blob(['exact immutable bytes']))
  assert.deepEqual(bodies, ['exact immutable bytes'])
  const pending = client.backend('browser').writeBlob!(new Blob(['pending']))
  const rejected = assert.rejects(pending, /previous save is intact/)
  client.disconnect()
  channel.port2.close()
  await rejected
  await assert.rejects(client.backend('disk').writeBlob!(new Blob()), /unavailable/)
  const replacement = new MessageChannel()
  client.connect(replacement.port1 as unknown as MessagePort)
  replacement.port2.on('message', ({ id }) => replacement.port2.postMessage({ id }))
  await client.backend('browser').writeBlob!(new Blob(['retry']))
  client.disconnect()
  replacement.port2.close()
})
