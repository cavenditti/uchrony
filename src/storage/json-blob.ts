import { packWorldSave } from '../sim/save-codec'
import type { World } from '../sim/types'
import { MAX_SAVE_BYTES } from './save-types'

/** Capture synchronously so a tick cannot change half a save. Nested registries
 * must be streamed too: a single economic section can exceed 50 MiB, even after
 * compression. Never flatten it into one temporary JavaScript string. */
export function worldBlob(world: World, savedAt?: number): Blob {
  if (world.viewOnly) throw new Error('A display snapshot cannot be saved.')
  const snapshot = packWorldSave(world)
  const parts: BlobPart[] = []
  let batch: string[] = [],
    batchSize = 0
  const append = (text: string) => {
    batch.push(text)
    batchSize += text.length
    if (batchSize >= 1024 * 1024) {
      // One backing segment per bounded chunk, not one segment per tiny token.
      // Hundreds of thousands of Blob segments also exhaust renderer memory.
      parts.push(new Blob([batch.join('')]))
      batch = []
      batchSize = 0
    }
  }
  const omitted = (v: unknown) => ['undefined', 'function', 'symbol'].includes(typeof v)
  const small = (v: unknown) =>
    v === null || (typeof v !== 'object' && (typeof v !== 'string' || v.length <= 1024))
  const active = new Set<object>()
  const emit = (value: unknown, key = ''): void => {
    if (value && typeof value === 'object' && 'toJSON' in value && typeof value.toJSON === 'function')
      value = value.toJSON(key)
    if (typeof value === 'string') {
      append('"')
      for (let i = 0; i < value.length;) {
        let end = Math.min(value.length, i + 65536)
        // Keep surrogate pairs together so UTF-8 and JSON escaping match native stringify.
        const last = value.charCodeAt(end - 1)
        if (end < value.length && last >= 0xd800 && last <= 0xdbff) end--
        append(JSON.stringify(value.slice(i, end)).slice(1, -1))
        i = end
      }
      append('"')
    } else if (!value || typeof value !== 'object') {
      append(JSON.stringify(value) ?? 'null')
    } else {
      if (active.has(value)) throw new TypeError('Cannot serialize a circular world')
      active.add(value)
      if (Array.isArray(value)) {
        append('[')
        // Tables are already partitioned into bounded records/blocks by the
        // save codec. Keep each record on native JSON's fast path.
        for (let i = 0; i < value.length; i++) {
          if (i) append(',')
          append(JSON.stringify(value[i]) ?? 'null')
        }
        append(']')
      } else {
        const entries = Object.entries(value).filter(([, v]) => !omitted(v))
        // Geography cells and other small flat records keep native serialization speed.
        if (entries.length <= 64 && entries.every(([k, v]) => k.length <= 1024 && small(v)))
          append(JSON.stringify(value))
        else {
          append('{')
          entries.forEach(([k, v], i) => {
            if (i) append(',')
            emit(k)
            append(':')
            emit(v, k)
          })
          append('}')
        }
      }
      active.delete(value)
    }
  }
  if (savedAt !== undefined) append(`{"version":1,"savedAt":${savedAt},"world":`)
  emit(snapshot)
  if (savedAt !== undefined) append('}')
  if (batch.length) parts.push(new Blob([batch.join('')]))
  const blob = new Blob(parts, { type: 'application/json' })
  if (blob.size > MAX_SAVE_BYTES) throw new Error('The world exceeds the supported save size.')
  return blob
}
