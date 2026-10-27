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
interface PendingWrite {
  message: ByteWrite
  attempts: number
  error?: string
  timer: ReturnType<typeof setTimeout>
  resolve: () => void
  reject: (error: Error) => void
}

/** A private worker-to-worker channel. Only immutable save bytes cross it. */
export class ByteStorageClient {
  private port: MessagePort | null = null
  private next = 0
  private pending = new Map<number, PendingWrite>()
  constructor(private timeout = 90000) {}
  private closePort() {
    if (this.port) {
      this.port.onmessage = null
      this.port.onmessageerror = null
      this.port.close()
      this.port = null
    }
  }
  private finish(id: number, error?: string) {
    const request = this.pending.get(id)
    if (!request) return
    this.pending.delete(id)
    clearTimeout(request.timer)
    if (error) request.reject(new Error(error))
    else request.resolve()
  }
  private send(request: PendingWrite) {
    if (!this.port) return
    request.attempts++
    try {
      this.port.postMessage(request.message)
    } catch (error) {
      this.finish(
        request.message.id,
        error instanceof Error ? error.message : 'Save bytes could not be sent.',
      )
    }
  }
  connect(port: MessagePort) {
    this.closePort()
    this.port = port
    port.onmessage = ({ data }: MessageEvent<ByteResult>) => {
      if (this.port === port) this.finish(data.id, data.error)
    }
    port.onmessageerror = () => {
      if (this.port === port) this.disconnect('The save response could not be read; saving will retry.')
    }
    // A replacement writer resumes the one captured snapshot. Confirmed
    // replicas have already left this map and must not be written again.
    for (const request of this.pending.values()) {
      if (request.attempts >= 3)
        this.finish(request.message.id, request.error ?? 'The save worker repeatedly stopped.')
      else this.send(request)
    }
  }
  /** A crashed writer can be replaced without dropping the immutable snapshot.
   * The app reconnects on its next save attempt; deadlines never restart. */
  interrupted(message = 'The save worker stopped.') {
    this.closePort()
    for (const request of this.pending.values()) {
      request.error = message
      if (request.attempts >= 3) this.finish(request.message.id, message)
    }
  }
  disconnect(message = 'The save worker stopped; your previous save is intact.') {
    this.closePort()
    for (const id of this.pending.keys()) this.finish(id, message)
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
          const timer = setTimeout(() => {
            const reason = this.pending.get(id)?.error
            this.finish(
              id,
              reason
                ? `${reason} Reconnecting timed out; saving will retry.`
                : 'The save worker did not respond in time; saving will retry.',
            )
          }, this.timeout)
          const request: PendingWrite = {
            message: { id, backend: name, blob },
            attempts: 0,
            timer,
            resolve,
            reject,
          }
          this.pending.set(id, request)
          this.send(request)
        }),
    }
  }
}
