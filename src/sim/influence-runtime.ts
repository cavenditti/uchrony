import { InfluencePool } from './influence-pool'

/** Module workers must finish loading while their owner can still yield.
 * In particular, starting a nested module worker inside Atomics.wait deadlocks
 * startup in Chromium. Playback awaits this one-time readiness handshake. */
export function browserInfluencePool(concurrency = Math.max(1, (navigator.hardwareConcurrency || 2) - 2)) {
  if (!self.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') return undefined
  return new InfluencePool(() => {
    const worker = new Worker(new URL('./influence-worker.ts', import.meta.url), { type: 'module' })
    const ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.terminate()
        reject(new Error('Spatial worker startup timed out'))
      }, 10000)
      worker.addEventListener(
        'message',
        ({ data }) => {
          if (data?.type === 'ready') {
            clearTimeout(timeout)
            resolve()
          }
        },
        { once: true },
      )
      worker.addEventListener(
        'error',
        () => {
          clearTimeout(timeout)
          reject(new Error('Spatial worker startup failed'))
        },
        { once: true },
      )
    })
    return { ready, postMessage: (job) => worker.postMessage(job), terminate: () => worker.terminate() }
  }, concurrency)
}
