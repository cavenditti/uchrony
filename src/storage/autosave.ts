import { UnsupportedSaveError } from '../sim/save-version'
import { restoreWorld } from '../sim/persistence'
import type { World } from '../sim/types'
import type { SaveBackend } from './backends'
import type { WorldSave } from './save-types'

export interface RestoredSave {
  world: World | null
  source: 'disk' | 'browser' | 'none'
}
function checked(record: WorldSave) {
  if (!record || record.version !== 1 || !Number.isSafeInteger(record.savedAt) || record.savedAt < 0)
    throw new Error('The autosave envelope is invalid.')
  return { ...record, world: restoreWorld(record.world) }
}
/** Restore the newest valid replica, retaining corruption recovery within the current schema. */
export async function restoreSave(backends: SaveBackend[]): Promise<RestoredSave> {
  // Read encoded replicas together, but never expand two complete worlds just to
  // choose a timestamp. Invalid newer copies still fall back to an older one.
  const reads = await Promise.allSettled(backends.map((backend) => backend.read()))
  let invalid = reads.some((result) => result.status === 'rejected')
  let unsupported: UnsupportedSaveError | undefined
  for (const result of reads)
    if (result.status === 'rejected' && result.reason instanceof UnsupportedSaveError)
      unsupported = result.reason
  const candidates = reads
    .flatMap((result, index) =>
      result.status === 'fulfilled' && result.value
        ? [{ record: result.value, source: backends[index].name }]
        : [],
    )
    .filter(({ record }) => {
      const valid = record.version === 1 && Number.isSafeInteger(record.savedAt) && record.savedAt >= 0
      invalid ||= !valid
      return valid
    })
    .sort((a, b) => b.record.savedAt - a.record.savedAt)
  for (const candidate of candidates) {
    try {
      return { world: checked(candidate.record).world, source: candidate.source }
    } catch (error) {
      if (error instanceof UnsupportedSaveError) unsupported = error
      invalid = true
    }
  }
  if (unsupported) throw unsupported
  if (invalid)
    throw new Error(
      'Your saved world could not be checked. Existing saves have been kept. Retry restoring before starting a new world.',
    )
  return { world: null, source: 'none' }
}
