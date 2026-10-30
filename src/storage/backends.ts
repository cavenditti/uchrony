import { UnsupportedSaveError } from '../sim/save-version'
import { MAX_SAVE_BYTES, type WorldSave } from './save-types'
import { worldBlob } from './json-blob'

export interface SaveBackend {
  name: 'disk' | 'browser'
  read(): Promise<WorldSave | null>
  write(save: WorldSave): Promise<void>
  writeBlob?(blob: Blob): Promise<void>
}
export function diskBackend(): SaveBackend {
  let slot: string | undefined
  const request = async (method: 'GET' | 'PUT', save?: Blob) => {
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 60000)
    try {
      const response = await fetch('/api/saves/current', {
        method,
        credentials: 'same-origin',
        signal: controller.signal,
        headers: {
          ...(save ? { 'Content-Type': 'application/json' } : {}),
          ...(slot ? { 'X-Uchrony-Save-Slot': slot } : {}),
        },
        ...(save ? { body: save } : {}),
      })
      if (method === 'GET' && response.status === 404) return { save: null }
      const result = await response.json()
      if (!response.ok) {
        if (response.status === 409) throw new UnsupportedSaveError(result.error)
        throw new Error(result.error ?? `Local disk autosave returned HTTP ${response.status}.`)
      }
      if (typeof result.slot === 'string') slot = result.slot
      return result
    } finally {
      clearTimeout(timeout)
    }
  }
  return {
    name: 'disk',
    async writeBlob(blob) {
      await request('PUT', blob)
    },
    async read() {
      return (await request('GET')).save
    },
    async write(save) {
      await request('PUT', worldBlob(save.world, save.savedAt))
    },
  }
}

export function browserBackend(): SaveBackend {
  let opening: Promise<IDBDatabase> | undefined
  const database = () => {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('The browser database is unavailable.'))
        return
      }
      const request = indexedDB.open('uchrony-square-saves', 1)
      let finished = false
      const timer = setTimeout(() => {
        finished = true
        reject(new Error('The browser database did not open in time.'))
      }, 8000)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('worlds')) request.result.createObjectStore('worlds')
      }
      request.onerror = () => {
        finished = true
        clearTimeout(timer)
        reject(request.error ?? new Error('The browser database could not open.'))
      }
      request.onblocked = () => {
        finished = true
        clearTimeout(timer)
        reject(new Error('Another tab is blocking the browser database.'))
      }
      request.onsuccess = () => {
        const db = request.result
        if (finished) {
          db.close()
          return
        }
        finished = true
        clearTimeout(timer)
        db.onversionchange = () => {
          db.close()
          opening = undefined
        }
        resolve(db)
      }
    }).catch((error) => {
      opening = undefined
      throw error
    })
    return opening
  }
  const transaction = async (write?: Blob) => {
    const db = await database()
    return new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction('worlds', write ? 'readwrite' : 'readonly'),
        store = tx.objectStore('worlds')
      let result: Blob | null = null
      const timer = setTimeout(() => {
        try {
          tx.abort()
        } catch {
          /* It may have just committed. */
        }
        reject(new Error('The browser database transaction timed out.'))
      }, 60000)
      let request: IDBRequest
      try {
        request = write ? store.put(write, 'current') : store.get('current')
      } catch (error) {
        clearTimeout(timer)
        tx.abort()
        reject(error)
        return
      }
      request.onsuccess = () => {
        if (!write) result = request.result ?? null
      }
      tx.oncomplete = () => {
        clearTimeout(timer)
        resolve(result)
      }
      tx.onerror = () => {
        clearTimeout(timer)
        reject(tx.error ?? request.error ?? new Error('Browser database write failed.'))
      }
      tx.onabort = () => {
        clearTimeout(timer)
        reject(tx.error ?? new Error('Browser database transaction was interrupted.'))
      }
    })
  }
  return {
    name: 'browser',
    async read() {
      const stored = await transaction()
      if (stored === null) return null
      if (!(stored instanceof Blob))
        throw new UnsupportedSaveError('Unsupported browser save format. Create a new world.')
      if (stored.size > MAX_SAVE_BYTES) throw new Error('The browser save exceeds the supported size.')
      return JSON.parse(await stored.text()) as WorldSave
    },
    async writeBlob(blob) {
      await transaction(blob)
    },
    async write(save) {
      await transaction(worldBlob(save.world, save.savedAt))
    },
  }
}
