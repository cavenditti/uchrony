import type { World } from '../sim/types'

export const MAX_SAVE_BYTES = 128 * 1024 * 1024
export interface WorldSave {
  version: 1
  savedAt: number
  world: World
}
