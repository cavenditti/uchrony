import { packWorldSave } from '../sim/save-codec'
import type { World } from '../sim/types'
import { MAX_SAVE_BYTES } from './save-types'

/** Serialize one array member at a time, without a world-sized intermediate string.
 * Synchronous capture is intentional: a tick cannot change half of this save.
 * Blob parts are immutable bytes, shared with storage instead of cloning millions of JS objects.
 */
export function worldBlob(world: World, savedAt?: number): Blob {
  if (world.viewOnly) throw new Error('A display snapshot cannot be saved.')
  const snapshot = packWorldSave(world) as Record<string, unknown>
  const stringify = JSON.stringify
  const parts: BlobPart[] = []
  let batch: string[] = [],
    batchSize = 0
  const append = (text: string) => {
    batch.push(text)
    batchSize += text.length
    if (batchSize >= 1024 * 1024) {
      parts.push(new Blob(batch))
      batch = []
      batchSize = 0
    }
  }
  if (savedAt !== undefined) append(`{"version":1,"savedAt":${savedAt},"world":`)
  append('{')
  let first = true
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) continue
    append(`${first ? '' : ','}${JSON.stringify(key)}:`)
    first = false
    if (Array.isArray(value)) {
      append('[')
      value.forEach((entry, i) => append(`${i ? ',' : ''}${stringify(entry)}`))
      append(']')
    } else append(stringify(value))
  }
  append(savedAt === undefined ? '}' : '}}')
  if (batch.length) parts.push(new Blob(batch))
  const blob = new Blob(parts, { type: 'application/json' })
  if (blob.size > MAX_SAVE_BYTES) throw new Error('The world exceeds the supported save size.')
  return blob
}
