import { browserBackend, diskBackend } from './backends'
import type { ByteWrite, ByteResult } from './byte-client'

const backends = { disk: diskBackend(), browser: browserBackend() }
self.onmessage = ({ data }: MessageEvent<{ port: MessagePort }>) => {
  const port = data.port
  port.onmessage = async ({ data }: MessageEvent<ByteWrite>) => {
    try {
      await backends[data.backend].writeBlob!(data.blob)
      port.postMessage({ id: data.id } satisfies ByteResult)
    } catch (error) {
      port.postMessage({
        id: data.id,
        error: error instanceof Error ? error.message : 'Save I/O failed.',
      } satisfies ByteResult)
    }
  }
}
