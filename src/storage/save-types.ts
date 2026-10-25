import type { World } from '../sim/types'

// The largest map grows beyond 256 MiB as its dated census evolves. Keep an
// explicit bound below the engine's single-string limit for JSON recovery.
export const MAX_SAVE_BYTES = 384 * 1024 * 1024
export interface WorldSave {
  version: 1
  savedAt: number
  world: World
}
