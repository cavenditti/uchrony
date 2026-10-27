import { ByteStorageClient } from '../../src/storage/byte-client'
import { WorldStorage } from '../../src/storage/world-storage'
import { browserBackend, diskBackend } from '../../src/storage/backends'
import { worldBlob } from '../../src/storage/json-blob'
import { generateWorld } from '../../src/sim/generate'
import { tick } from '../../src/sim/engine'
import { restoreWorld } from '../../src/sim/persistence'

const check = (value: unknown, message: string) => {
  if (!value) throw new Error(message)
}
async function run() {
  const disk = diskBackend(),
    browser = browserBackend()
  check(
    (await disk.read()) === null && (await browser.read()) === null,
    'Use an empty isolated browser origin and disk slot.',
  )
  const world = generateWorld('Save worker crash recovery', 3, 8, undefined, 'regional', 'frontier')
  const initial = worldBlob(restoreWorld(world), Date.now())
  await Promise.all([disk.writeBlob!(initial), browser.writeBlob!(initial)])
  tick(world)
  const client = new ByteStorageClient(20000)
  const statuses: { state: string; replicas?: string[]; message?: string }[] = []
  const storage = new WorldStorage([client.backend('disk'), client.backend('browser')], (status) =>
    statuses.push(status),
  )
  let writer: Worker | undefined,
    crash = '',
    previousIntact = false
  let recovered!: () => void, failed!: (error: unknown) => void
  const restarted = new Promise<void>((resolve, reject) => {
    recovered = resolve
    failed = reject
  })
  const connect = (injectCrash: boolean) => {
    const current = new Worker(new URL('../../src/storage/byte-worker.ts', import.meta.url), {
      type: 'module',
    })
    writer = current
    current.onerror = (event) => {
      event.preventDefault()
      if (writer !== current) return
      client.interrupted(event.message)
      current.terminate()
      if (!injectCrash) {
        failed(new Error(event.message))
        return
      }
      crash = event.message
      void Promise.all([disk.read(), browser.read()]).then(([d, b]) => {
        previousIntact = d?.world.month === 0 && b?.world.month === 0
        connect(false)
        recovered()
      }, failed)
    }
    // A malformed startup message triggers a real worker error before any write.
    if (injectCrash) current.postMessage({})
    const channel = new MessageChannel()
    current.postMessage({ port: channel.port1 }, [channel.port1])
    client.connect(channel.port2)
  }
  try {
    connect(true)
    const pending = storage.save(world, 1)
    await restarted
    await pending
    const [d, b] = await Promise.all([disk.read(), browser.read()])
    check(previousIntact, 'A crash changed a previous save before recovery.')
    check(statuses.at(-1)?.state === 'saved', JSON.stringify(statuses))
    check(statuses.at(-1)?.replicas?.length === 2, 'Both replicas must confirm recovery.')
    check(JSON.stringify(d) === JSON.stringify(b), 'Recovered replicas differ.')
    const restored = restoreWorld(d!.world)
    check(restored.month === world.month && restored.rng === world.rng, 'Recovered world state differs.')
    return {
      previousIntact,
      month: restored.month,
      crash,
      replicas: statuses.at(-1)?.replicas,
      states: statuses.map((s) => s.state),
      exactReplicas: true,
    }
  } finally {
    client.disconnect()
    writer?.terminate()
  }
}
Object.assign(window, { runSaveWorkerRecovery: run })
