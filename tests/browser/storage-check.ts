import { browserBackend, diskBackend } from '../../src/storage/backends'
import { worldBlob } from '../../src/storage/json-blob'
import { generateWorld } from '../../src/sim/generate'
import { validateWorld } from '../../src/sim/persistence'

const check = (value: unknown, message: string) => {
  if (!value) throw new Error(message)
}
const digest = async (blob: Blob) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
async function run() {
  const browser = browserBackend(),
    disk = diskBackend()
  check(
    (await browser.read()) === null,
    'Use a fresh isolated origin; this fixture must not replace an existing save.',
  )
  check((await disk.read()) === null, 'Use a fresh isolated disk slot.')
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('uchrony-square-saves', 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const transaction = (value: unknown, abort = false) =>
    new Promise<void>((resolve, reject) => {
      const tx = db.transaction('worlds', 'readwrite')
      tx.objectStore('worlds').put(value, 'current')
      tx.oncomplete = () => resolve()
      tx.onabort = () => (abort ? resolve() : reject(tx.error))
      tx.onerror = () => {
        if (!abort) reject(tx.error)
      }
      if (abort) tx.abort()
    })
  const world = generateWorld('Legacy and large Blob fidelity', 3, 8, undefined, 'regional')
  const legacy = { version: 1 as const, savedAt: Date.now(), world }
  await transaction(legacy)
  check(JSON.stringify(await browser.read()) === JSON.stringify(legacy), 'Legacy object save changed')
  const large = { ...world, storageFixture: Array.from({ length: 35000 }, () => 'abcd'.repeat(1000)) }
  const blob = worldBlob(large, legacy.savedAt + 1),
    expected = await digest(blob)
  check(blob.size > 133169152, 'Fixture does not cross the former single-value limit')
  await Promise.all([browser.writeBlob!(blob), disk.writeBlob!(blob)])
  await transaction(new Blob(['interrupted replacement']), true)
  const stored = await new Promise<Blob>((resolve, reject) => {
    const request = db.transaction('worlds').objectStore('worlds').get('current')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  check(stored instanceof Blob, 'Large saves must be stored as immutable bytes')
  check((await digest(stored)) === expected, 'Interrupted transaction changed the last good save')
  const restored = await browser.read()
  check(restored?.savedAt === legacy.savedAt + 1, 'Save date changed')
  validateWorld(restored!.world)
  check(
    (await digest(worldBlob(restored!.world, restored!.savedAt))) === expected,
    'Browser restoration changed world bytes',
  )
  const diskSave = await disk.read()
  check(
    (await digest(worldBlob(diskSave!.world, diskSave!.savedAt))) === expected,
    'Disk restoration changed world bytes',
  )
  db.close()
  return {
    bytes: blob.size,
    sha256: expected,
    legacy: true,
    browser: true,
    disk: true,
    rollback: true,
    restoreExact: true,
  }
}
Object.assign(window, { runStorageRegression: run })
