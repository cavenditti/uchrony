import type { World } from '../sim/types'
import type { SaveBackend } from './backends'
import { worldBlob } from './json-blob'
import { restoreWorld } from '../sim/persistence'

/** Owns no world snapshot: capture once into immutable bytes, with no queued copies. */
export class WorldStorage {
  private flight: Promise<void> | null = null
  private savedRevision = -1
  private epoch = 0
  constructor(
    private backends: Pick<SaveBackend, 'name' | 'writeBlob'>[],
    private report: (status: {
      state: 'saving' | 'saved' | 'error'
      month: number
      startYear: number
      source?: string
      message?: string
      bytes?: number
      replicas?: string[]
    }) => void,
  ) {}
  reset() {
    this.epoch++
    this.savedRevision = -1
  }
  save(world: World, revision: number, force = false) {
    if (this.flight || (!force && revision === this.savedRevision)) return this.flight
    const epoch = this.epoch,
      month = world.month,
      startYear = world.startYear
    const report: typeof this.report = (status) => {
      if (epoch === this.epoch) this.report(status)
    }
    report({ state: 'saving', month, startYear })
    // Capture before the first await. The world may advance once the Blob exists.
    let blob: Blob
    try {
      // Validate before either replica can replace its last good save. Recovery
      // performs the same narrow legacy/roundoff repairs as imports, without
      // changing the running world's records.
      blob = worldBlob(restoreWorld(world), Date.now())
    } catch (error) {
      report({
        state: 'error',
        month,
        startYear,
        message: error instanceof Error ? error.message : 'Save capture failed.',
      })
      return null
    }
    this.flight = (async () => {
      const writes = await Promise.allSettled(
        this.backends.map(async (backend) => {
          if (!backend.writeBlob) throw new Error('This save backend does not support byte snapshots.')
          return backend.writeBlob(blob)
        }),
      )
      const message = writes
        .flatMap((result, i) =>
          result.status === 'rejected' ? [`${this.backends[i].name}: ${String(result.reason)}`] : [],
        )
        .join(' ')
      const replicas = this.backends.filter((_, i) => writes[i].status === 'fulfilled').map((b) => b.name)
      if (replicas.length) {
        // Retry degraded replication on the next interval even if the world is paused.
        if (epoch === this.epoch && replicas.length === this.backends.length) this.savedRevision = revision
        report({
          state: 'saved',
          month,
          startYear,
          source: replicas[0],
          replicas,
          bytes: blob.size,
          message: message || undefined,
        })
      } else
        report({
          state: 'error',
          month,
          startYear,
          message:
            writes
              .map((r, i) => `${this.backends[i].name}: ${r.status === 'rejected' ? String(r.reason) : ''}`)
              .join(' ') + ' Your previous save remains intact.',
        })
    })().finally(() => {
      this.flight = null
    })
    return this.flight
  }
}
