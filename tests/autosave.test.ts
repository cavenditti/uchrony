import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { DiskAutosaves, autosaveMiddleware } from '../server/autosave'
import { generateWorld } from '../src/sim/generate'
import { LatestSaveQueue, persistSave, restoreSave } from '../src/storage/autosave'
import type { SaveBackend } from '../src/storage/backends'
import type { WorldSave } from '../src/storage/save-types'
import type { World } from '../src/sim/types'

const world = generateWorld('Durable autosave')
const record = (savedAt: number, value = world): WorldSave => ({ version: 1, savedAt, world: value })
const backend = (name: 'disk' | 'browser', value: WorldSave | null, fails = false): SaveBackend => ({
  name,
  async read() {
    if (fails) throw new Error(`${name} unavailable`)
    return value
  },
  async write(next) {
    if (fails) throw new Error(`${name} unavailable`)
    value = next
  },
})

test('a browser quota failure does not prevent a disk save, and the reverse also works', async () => {
  assert.equal(await persistSave([backend('disk', null), backend('browser', null, true)], record(1)), 'disk')
  assert.equal(
    await persistSave([backend('disk', null, true), backend('browser', null)], record(2)),
    'browser',
  )
  await assert.rejects(
    persistSave([backend('disk', null, true), backend('browser', null, true)], record(3)),
    /previous save is intact/,
  )
})
test('restore chooses the newest valid replica and retains the legacy fallback', async () => {
  const older = backend('disk', record(1)),
    newer = backend('browser', record(2))
  assert.equal((await restoreSave([older, newer], null)).source, 'browser')
  assert.equal((await restoreSave([backend('disk', null, true), newer], null)).source, 'browser')
  const legacy = JSON.stringify(world),
    loaded = await restoreSave([backend('disk', null), backend('browser', null)], legacy)
  assert.equal(loaded.source, 'legacy')
  assert.deepEqual(loaded.world, world)
  assert.equal(JSON.stringify(world), legacy)
})
test('unreadable saves do not silently generate a replacement world', async () => {
  await assert.rejects(
    restoreSave([backend('disk', null, true), backend('browser', null)], null),
    /Existing saves have been kept/,
  )
  await assert.rejects(restoreSave([backend('disk', null), backend('browser', null)], 'corrupt saved world'))
})
test('the save queue serializes writes and coalesces intermediate worlds', async () => {
  const writes: number[] = [],
    reports: number[] = []
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const queue = new LatestSaveQueue(
    async (w) => {
      writes.push(w.month)
      if (writes.length === 1) await gate
      return 'disk'
    },
    ({ world }) => reports.push(world.month),
  )
  const flight = queue.enqueue({ month: 1 } as World)
  void queue.enqueue({ month: 2 } as World)
  void queue.enqueue({ month: 3 } as World)
  release()
  await flight
  assert.deepEqual(writes, [1, 3])
  assert.deepEqual(reports, [1, 3])
})
test('a replaced world cannot receive stale save-success notifications', async () => {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
      release = resolve
    }),
    reported: number[] = []
  const queue = new LatestSaveQueue(
    async (w) => {
      if (w.month === 1) await gate
      return 'disk'
    },
    ({ world }) => reported.push(world.month),
  )
  const flight = queue.enqueue({ month: 1 } as World)
  queue.reset()
  void queue.enqueue({ month: 0 } as World)
  release()
  await flight
  assert.deepEqual(reported, [0])
})
test('disk autosaves restore large worlds atomically and recover the previous verified copy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'uchrony-autosave-')),
    store = new DiskAutosaves(root),
    slot = randomUUID()
  try {
    // A valid save well beyond the old localStorage-sized payload, without changing modeled populations.
    const large = { ...world, storageFixture: Array.from({ length: 1800 }, () => 'x'.repeat(4000)) } as World
    await store.write(slot, record(1, large))
    assert(JSON.stringify(large).length > 7_000_000)
    assert.deepEqual((await store.read(slot)).save?.world, large)
    await store.write(slot, record(2, world))
    await writeFile(join(root, `${slot}.json`), 'incomplete write')
    const restored = await store.read(slot)
    assert.equal(restored.recovered, true)
    assert.equal(restored.save?.savedAt, 1)
    assert.deepEqual(restored.save?.world, large)
    await store.write(slot, record(3, world))
    assert.equal((await store.read(slot)).save?.savedAt, 3)
    assert.equal(JSON.parse(await readFile(join(root, `${slot}.previous.json`), 'utf8')).savedAt, 1)
    assert(!(await readdir(root)).some((name) => name.endsWith('.tmp')))
    await assert.rejects(store.write('../escape', record(4)))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the disk endpoint requires same-origin writes and isolates browser save slots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'uchrony-save-api-')),
    middleware = autosaveMiddleware(root)
  const server = createServer((req, res) => {
    void middleware(req, res, () => {
      res.statusCode = 404
      res.end()
    })
  })
  try {
    const ready = once(server, 'listening')
    server.listen(0, '127.0.0.1')
    await ready
    const address = server.address()
    assert(address && typeof address === 'object')
    const base = `http://127.0.0.1:${address.port}`,
      url = `${base}/api/saves/current`
    const initial = await fetch(url),
      cookie = initial.headers.get('set-cookie')!.split(';')[0]
    const first = await initial.json()
    assert.equal(first.save, null)
    const request = {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(record(1)),
    }
    assert.equal((await fetch(url, request)).status, 403)
    assert.equal(
      (await fetch(url, { ...request, headers: { ...request.headers, Origin: 'https://unrelated.invalid' } }))
        .status,
      403,
    )
    assert.equal(
      (await fetch(url, { ...request, headers: { ...request.headers, Origin: base } })).status,
      200,
    )
    const same = await (await fetch(url, { headers: { Cookie: cookie } })).json()
    assert.equal(same.slot, first.slot)
    assert.equal(same.save.world.seed, world.seed)
    const other = await (await fetch(url)).json()
    assert.notEqual(other.slot, first.slot)
    assert.equal(other.save, null)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  }
})
