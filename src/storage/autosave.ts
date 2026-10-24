import { parseSave, validateWorld } from '../sim/persistence'
import type { World } from '../sim/types'
import type { SaveBackend } from './backends'
import type { WorldSave } from './save-types'

export const LEGACY_SAVE_KEY = 'uchrony.world.v1'
export interface RestoredSave {
  world: World | null
  source: 'disk' | 'browser' | 'legacy' | 'none'
}
function checked(record: WorldSave) {
  if (!record || record.version !== 1 || !Number.isSafeInteger(record.savedAt) || record.savedAt < 0)
    throw new Error('The autosave envelope is invalid.')
  validateWorld(record.world)
  return record
}
export async function restoreSave(backends: SaveBackend[], legacy: string | null): Promise<RestoredSave> {
  const reads = await Promise.allSettled(
    backends.map(async (backend) => {
      const record = await backend.read()
      return record ? checked(record) : null
    }),
  )
  const candidates = reads
    .flatMap((result, index) =>
      result.status === 'fulfilled' && result.value
        ? [{ record: result.value, source: backends[index].name }]
        : [],
    )
    .sort((a, b) => b.record.savedAt - a.record.savedAt)
  if (candidates.length) return { world: candidates[0].record.world, source: candidates[0].source }
  if (legacy) return { world: parseSave(legacy), source: 'legacy' }
  if (reads.some((result) => result.status === 'rejected'))
    throw new Error(
      'Your saved world could not be checked. Existing saves have been kept. Retry restoring before starting a new world.',
    )
  return { world: null, source: 'none' }
}
export async function persistSave(backends: SaveBackend[], record: WorldSave) {
  checked(record)
  const writes = await Promise.allSettled(backends.map((backend) => backend.write(record)))
  const success = writes.findIndex((result) => result.status === 'fulfilled')
  if (success >= 0) return backends[success].name
  const reasons = writes
    .map(
      (result, i) =>
        `${backends[i].name === 'disk' ? 'Local disk' : 'Browser database'}: ${result.status === 'rejected' && result.reason instanceof Error ? result.reason.message : 'unavailable'}`,
    )
    .join(' ')
  throw new Error(
    `Autosave could not complete. ${reasons} Your previous save is intact; keep this tab open and retry saving or export the world.`,
  )
}

/** At most one write runs; a burst of snapshots retains only the newest pending world. */
export class LatestSaveQueue {
  private pending: { world: World; epoch: number } | null = null
  private flight: Promise<void> | null = null
  private epoch = 0
  constructor(
    private write: (world: World) => Promise<string>,
    private report: (result: { world: World; source?: string; error?: string }) => void,
  ) {}
  reset() {
    this.epoch++
    this.pending = null
  }
  enqueue(world: World) {
    this.pending = { world, epoch: this.epoch }
    if (!this.flight)
      this.flight = this.drain().finally(() => {
        this.flight = null
        if (this.pending) void this.enqueue(this.pending.world)
      })
    return this.flight
  }
  private async drain() {
    while (this.pending) {
      const next = this.pending
      this.pending = null
      try {
        const source = await this.write(next.world)
        if (next.epoch === this.epoch) this.report({ world: next.world, source })
      } catch (error) {
        if (next.epoch === this.epoch)
          this.report({
            world: next.world,
            error: error instanceof Error ? error.message : 'Autosave failed.',
          })
      }
    }
  }
}
