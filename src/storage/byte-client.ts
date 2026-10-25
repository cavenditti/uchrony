import type { SaveBackend } from './backends'

export interface ByteWrite {
  id: number
  backend: 'disk' | 'browser'
  blob: Blob
}
export interface ByteResult {
  id: number
  error?: string
}

/** A private worker-to-worker channel. Only immutable save bytes cross it. */
export class ByteStorageClient {
  private port: MessagePort | null = null
  private next = 0
  private pending = new Map<number, { resolve: () => void; reject: (error: Error) => void }>()
  connect(port: MessagePort) {
    this.disconnect('The save connection was replaced; saving will retry.')
    this.port = port
    port.onmessage = ({ data }: MessageEvent<ByteResult>) => {
      const request = this.pending.get(data.id)
      if (!request) return
      this.pending.delete(data.id)
      if (data.error) request.reject(new Error(data.error))
      else request.resolve()
    }
    port.onmessageerror = () => this.disconnect('The save response could not be read; saving will retry.')
  }
  disconnect(message = 'The save worker stopped; your previous save is intact.') {
    this.port?.close()
    this.port = null
    for (const request of this.pending.values()) request.reject(new Error(message))
    this.pending.clear()
  }
  backend(name: 'disk' | 'browser'): Pick<SaveBackend, 'name' | 'writeBlob'> {
    return {
      name,
      writeBlob: (blob) =>
        new Promise<void>((resolve, reject) => {
          if (!this.port) {
            reject(new Error('The save worker is unavailable; saving will retry.'))
            return
          }
          const id = ++this.next
          this.pending.set(id, { resolve, reject })
          try {
            this.port.postMessage({ id, backend: name, blob } satisfies ByteWrite)
          } catch (error) {
            this.pending.delete(id)
            reject(error)
          }
        }),
    }
  }
}
