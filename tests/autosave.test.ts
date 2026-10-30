import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { DiskAutosaves, autosaveMiddleware } from '../server/autosave'
import { generateWorld } from '../src/sim/generate'
import { UnsupportedSaveError } from '../src/sim/save-version'
import { browserBackend, diskBackend } from '../src/storage/backends'
import { restoreSave } from '../src/storage/autosave'
import type { SaveBackend } from '../src/storage/backends'
import type { WorldSave } from '../src/storage/save-types'
import { ensureAdaptiveWorld } from '../src/sim/adaptive-world'
import { packWorldSave } from '../src/sim/save-codec'

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

test('retired world restore reports the new-world requirement without writing either replica', async () => {
  const old = structuredClone(world)
  Object.assign(old, { version: 1 })
  const original = JSON.stringify(old)
  let writes = 0
  const replicas: SaveBackend[] = (['disk', 'browser'] as const).map((name) => ({
    name,
    async read() {
      return record(100, old)
    },
    async write() {
      writes++
    },
  }))
  await assert.rejects(restoreSave(replicas, null), /unsupported version.*Create a new world/)
  assert.equal(writes, 0)
  assert.equal(JSON.stringify(old), original)
})

test('disk writes validate compressed snapshots without recompressing their bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'uchrony-encoded-save-')),
    store = new DiskAutosaves(root),
    slot = randomUUID(),
    source = structuredClone(world)
  ensureAdaptiveWorld(source)
  const encoded = packWorldSave(source) as { regions: { data: string }[] }
  // A valid alternative gzip header must survive unchanged; recompression resets its timestamp.
  const block = Buffer.from(encoded.regions[0].data, 'base64')
  block[4] = 1
  encoded.regions[0].data = block.toString('base64')
  try {
    await store.write(slot, { version: 1, savedAt: 1, world: encoded })
    assert.deepEqual((await store.read(slot, true)).save!.world, encoded)
    assert.deepEqual((await store.read(slot)).save!.world, source)
    const damaged = structuredClone(encoded)
    damaged.regions[0].data = 'invalid'
    await assert.rejects(store.write(slot, { version: 1, savedAt: 2, world: damaged }))
    assert.deepEqual(
      (await store.read(slot, true)).save!.world,
      encoded,
      'invalid data cannot replace the good save',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('restore chooses the newest valid replica and reports empty storage', async () => {
  const older = backend('disk', record(1)),
    newer = backend('browser', record(2))
  assert.equal((await restoreSave([older, newer])).source, 'browser')
  assert.equal((await restoreSave([backend('disk', null, true), newer])).source, 'browser')
  assert.deepEqual(await restoreSave([backend('disk', null), backend('browser', null)]), {
    world: null,
    source: 'none',
  })
})
test('restore expands only the winning replica and falls back after a corrupt newer world', async () => {
  const unused = {
    version: 1 as const,
    savedAt: 1,
    get world(): typeof world {
      throw new Error('An older replica should not be expanded')
    },
  }
  const valid = record(2)
  assert.equal((await restoreSave([backend('disk', unused), backend('browser', valid)])).source, 'browser')
  const broken = { ...record(3), world: { ...world, rng: NaN } }
  const recovered = await restoreSave([backend('disk', valid), backend('browser', broken)])
  assert.equal(recovered.source, 'disk')
  assert.deepEqual(recovered.world, world)
  await assert.rejects(restoreSave([backend('disk', broken)]), /Existing saves have been kept/)
  const malformed = { ...valid, savedAt: NaN }
  assert.equal((await restoreSave([backend('disk', malformed), backend('browser', valid)])).source, 'browser')
})
test('unreadable saves do not silently generate a replacement world', async () => {
  await assert.rejects(
    restoreSave([backend('disk', null, true), backend('browser', null)]),
    /Existing saves have been kept/,
  )
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

test('disk restoration rejects obsolete schemas without rotating or rewriting files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'uchrony-obsolete-save-')),
    slot = randomUUID()
  const old = { ...world, version: 1 }
  const raw = JSON.stringify({
    version: 1,
    savedAt: 1,
    world: old,
    checksum: createHash('sha256').update(JSON.stringify(old)).digest('hex'),
  })
  try {
    await writeFile(join(root, `${slot}.json`), raw)
    await assert.rejects(new DiskAutosaves(root).read(slot), UnsupportedSaveError)
    assert.equal(await readFile(join(root, `${slot}.json`), 'utf8'), raw)
    assert.deepEqual(await readdir(root), [`${slot}.json`])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('unsupported disk responses survive replica selection and allow a valid browser fallback', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(JSON.stringify({ error: 'unsupported version. Create a new world.' }), { status: 409 }),
  )
  await assert.rejects(restoreSave([diskBackend(), backend('browser', null)]), UnsupportedSaveError)
  const restored = await restoreSave([diskBackend(), backend('browser', record(1))])
  assert.equal(restored.source, 'browser')
  assert.deepEqual(restored.world, world)
})

test('browser restoration accepts current byte snapshots and rejects retired object records', async (t) => {
  let stored: unknown = null
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
  // Model only the asynchronous read transaction contract; no legacy data is rewritten.
  const database = {
    transaction() {
      const transaction = {
        oncomplete: () => {},
        objectStore: () => ({
          get() {
            const request = { result: stored, onsuccess: () => {} }
            queueMicrotask(() => {
              request.onsuccess()
              transaction.oncomplete()
            })
            return request
          },
        }),
      }
      return transaction
    },
  }
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: {
      open() {
        const request = { result: database, onsuccess: () => {} }
        queueMicrotask(() => request.onsuccess())
        return request
      },
    },
  })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'indexedDB', original)
    else Reflect.deleteProperty(globalThis, 'indexedDB')
  })
  const backend = browserBackend()
  assert.equal(await backend.read(), null)
  stored = record(1)
  await assert.rejects(backend.read(), UnsupportedSaveError)
  assert.equal((stored as WorldSave).world, world)
  stored = new Blob([JSON.stringify(record(2))])
  assert.deepEqual(await backend.read(), record(2))
})
