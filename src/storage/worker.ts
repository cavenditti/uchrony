import { browserBackend, diskBackend } from './backends'
import { persistSave, restoreSave } from './autosave'
import type { World } from '../sim/types'

const backends = [diskBackend(), browserBackend()]
self.onmessage = async ({
  data,
}: MessageEvent<{ id: number; type: 'restore' | 'save'; legacy?: string | null; world?: World }>) => {
  try {
    const result =
      data.type === 'restore'
        ? await restoreSave(backends, data.legacy ?? null)
        : await persistSave(backends, { version: 1, savedAt: Date.now(), world: data.world! })
    self.postMessage({ id: data.id, result })
  } catch (error) {
    self.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : 'Autosave worker failed.',
    })
  }
}
