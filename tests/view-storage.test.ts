import { describeCity } from '../src/map/city-layout'
import { spatialState } from '../src/sim/spatial'
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

test('display projection keeps exact balances, debts, stocks, strata and shipment totals without work ledgers', () => {
  const before = JSON.stringify(world),
    view = viewSnapshot(world)
  const original = world.economy!,
    shown = view.economy!
  assert.deepEqual(shown.households, original.households)
  assert.deepEqual(shown.credit, original.credit)
  assert.deepEqual(shown.banking, original.banking)
  assert.deepEqual(shown.accounts!.nations, original.accounts!.nations)
  assert.deepEqual(shown.accounts!.world, original.accounts!.world)
  assert.equal(shown.ledger.discrepancy, original.ledger.discrepancy)
  assert.equal(shown.ledger.entries.length, 0)
  assert.deepEqual(shown.accounts!.stores, {})
  for (const firm of original.firms!) {
    const display = shown.firms!.find((f) => f.id === firm.id)!
    for (const key of ['cash', 'stocks', 'employment', 'wage', 'profit', 'markup', 'active'] as const)
      assert.deepEqual(display[key], firm[key])
  }
  for (const unit of Object.values(world.localEconomy!.units)) {
    const display = view.localEconomy!.units[unit.id]
    const groups = world.regions[unit.province].communities!.filter(
      (g) => (g.locality ?? unit.province) === unit.id,
    )
    assert.deepEqual(display.strataCounts, censusOf({ communities: groups }, world.month).strata)
    assert.deepEqual(display.population, unit.population)
    assert.deepEqual(display.stocks, unit.stocks)
    assert.equal(shown.producers[unit.id].cash, original.producers[unit.id].cash)
    for (const [key, endpoint] of [
      ['arriving', 'to'],
      ['leaving', 'from'],
    ] as const) {
      const expected = world
        .localEconomy!.shipments.filter((s) => s[endpoint] === unit.id)
        .reduce((sum, s) => sum + s.quantity, 0)
      assert.equal(view.localEconomy!.shipmentTotals?.[unit.id]?.[key] ?? 0, expected)
    }
    assert.equal(display.census, undefined)
  }
  assert.equal(view.localEconomy!.shipments.length, 0)
  // Shared work buffers do not become one fresh object per enterprise in transit.
  const cloned = structuredClone(view)
  assert.equal(cloned.economy!.firms![0].forecast, cloned.economy!.firms![1].forecast)
  assert.equal(JSON.stringify(world), before)
  assert.throws(() => restoreWorld(view), /display snapshot/)
})

test('dossier subscriptions preserve exact selected accounts and global bank totals without retaining other accounts', () => {
  const before = JSON.stringify(world),
    all = viewSnapshot(world),
    overview = viewSnapshot(world, null)
  assert.equal(overview.viewNation, null)
  assert.deepEqual(overview.economy!.households, {})
  assert.deepEqual(overview.economy!.producers, {})
  assert.deepEqual(overview.economy!.firms, [])
  assert.deepEqual(overview.economy!.banking!.accounts, {})
  assert.deepEqual(overview.spatial, all.spatial)
  assert.deepEqual(overview.adaptive, all.adaptive)
  for (const nation of world.nations) {
    const view = viewSnapshot(world, nation.id),
      e = view.economy!
    assert.equal(view.viewNation, nation.id)
    assert.deepEqual(e.national, world.economy!.national)
    assert.deepEqual(e.accounts!.nations, world.economy!.accounts!.nations)
    const places = Object.values(world.localEconomy!.units).filter((u) => u.nation === nation.id)
    assert.deepEqual(
      Object.keys(e.households),
      places.map((u) => String(u.id)),
    )
    for (const place of places) {
      assert.deepEqual(e.households[place.id], world.economy!.households[place.id])
      assert.deepEqual(e.producers[place.id], all.economy!.producers[place.id])
      assert.deepEqual(view.localEconomy!.units[place.id], all.localEconomy!.units[place.id])
    }
    for (const firm of e.firms!)
      assert.deepEqual(
        firm,
        all.economy!.firms!.find((f) => f.id === firm.id),
      )
    for (const bank of world.economy!.banking!.banks) {
      assert.equal(
        view.viewBankLoans![bank.id] ?? 0,
        world
          .economy!.credit.loans.filter((loan) => loan.bank === bank.id)
          .reduce((sum, loan) => sum + loan.principal, 0),
      )
    }
    for (const unit of Object.values(world.localEconomy!.units)) {
      const shown = view.localEconomy!.units[unit.id]
      for (const key of ['population', 'residents', 'cells', 'foodCoverage', 'happiness'] as const)
        assert.deepEqual(shown[key], unit[key])
    }
  }
  assert.equal(JSON.stringify(world), before)
  assert.throws(() => worldBlob({ ...overview, cells: world.cells }), /display snapshot/)
})

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

test('nested save sections use bounded temporary strings with byte-exact JSON and Unicode', async () => {
  const fixture = {
    version: 1,
    nested: { rows: Array.from({ length: 16000 }, (_, i) => ({ id: i, text: 'a'.repeat(512) })) },
    text: 'x'.repeat(65535) + '🌍' + '\ud800' + '\n'.repeat(65536),
    omitted: undefined,
    sparse: [, { nested: ['present'] }, undefined],
    values: [undefined, null, -0, NaN, Infinity, '\udc00'],
  }
  const stringify = JSON.stringify,
    expected = stringify(fixture)
  let largest = 0,
    mostStringParts = 0,
    blob: Blob
  const NativeBlob = globalThis.Blob
  globalThis.Blob = class extends NativeBlob {
    constructor(parts: BlobPart[] = [], options?: BlobPropertyBag) {
      mostStringParts = Math.max(mostStringParts, parts.filter((p) => typeof p === 'string').length)
      super(parts, options)
    }
  }
  JSON.stringify = ((...args: Parameters<typeof JSON.stringify>) => {
    const encoded = stringify(...args)
    largest = Math.max(largest, encoded?.length ?? 0)
    return encoded
  }) as typeof JSON.stringify
  try {
    blob = worldBlob(fixture as unknown as import('../src/sim/types').World)
  } finally {
    JSON.stringify = stringify
    globalThis.Blob = NativeBlob
  }
  assert.equal(await blob!.text(), expected)
  assert.equal(
    mostStringParts,
    1,
    'Each chunk must use one backing string rather than thousands of Blob segments',
  )
  assert(largest < 1024 * 1024, `Temporary JSON string grew to ${largest} characters`)
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

test('lean residential display records preserve every recorded capacity and town description', () => {
  const before = JSON.stringify(world),
    projected = viewSnapshot(world, null)
  const view = { ...projected, cells: world.cells }
  const homes = Object.values(world.adaptive!.sites).filter((s) => s.kind === 'residential')
  assert.equal(view.viewHomes!.length, homes.length)
  assert.deepEqual(
    view.viewHomes,
    homes.map(({ id, cell, pool, capacity }) => ({ id, cell, pool, capacity })),
  )
  assert.deepEqual(view.adaptive!.sites, {})
  for (const settlement of spatialState(world).settlements)
    assert.deepEqual(describeCity(view, settlement), describeCity(world, settlement))
  assert.equal(JSON.stringify(world), before)
})
