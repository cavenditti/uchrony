import type { World } from '../sim/types'
import type { RestoredSave } from './autosave'

export class AutosaveClient {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  private next = 0
  private failed = false
  private closed = false
  private requests = new Map<
    number,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  constructor() {
    this.bind()
  }
  private bind() {
    this.worker.onmessage = ({ data }) => {
      const pending = this.requests.get(data.id)
      if (!pending) return
      this.requests.delete(data.id)
      clearTimeout(pending.timer)
      if (data.error) pending.reject(new Error(data.error))
      else pending.resolve(data.result)
    }
    this.worker.onerror = () => {
      this.failed = true
      for (const request of this.requests.values()) {
        clearTimeout(request.timer)
        request.reject(new Error('The autosave worker stopped. Your previous save remains intact.'))
      }
      this.requests.clear()
    }
  }
  private request(type: 'restore' | 'save', extra: { world?: World; legacy?: string | null }) {
    return new Promise<unknown>((resolve, reject) => {
      if (this.closed) {
        reject(new Error('Autosave session closed.'))
        return
      }
      if (this.failed) {
        this.worker.terminate()
        this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
        this.failed = false
        this.bind()
      }
      const id = ++this.next
      const timer = setTimeout(() => {
        this.requests.delete(id)
        this.failed = true
        reject(
          new Error(
            'Autosave did not complete in time. The previous save remains intact; saving will retry.',
          ),
        )
      }, 45000)
      this.requests.set(id, { resolve, reject, timer })
      try {
        this.worker.postMessage({ id, type, ...extra })
      } catch (error) {
        clearTimeout(timer)
        this.requests.delete(id)
        reject(error)
      }
    })
  }
  restore(legacy: string | null) {
    return this.request('restore', { legacy }) as Promise<RestoredSave>
  }
  save(world: World) {
    return this.request('save', { world }) as Promise<string>
  }
  dispose() {
    this.closed = true
    this.worker.terminate()
    for (const request of this.requests.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('Autosave session closed.'))
    }
    this.requests.clear()
  }
}
