import type { World } from './types'
import { habitableLand } from './terrain-access'
import { movementNeighbors } from './grid'

const cache = new WeakMap<World['cells'], Int32Array>()

/** Administrative neighbours do not imply a crossing of the ridge between them.
 * Used by migration before considering destination housing or political access. */
export function landComponents(w: World) {
  let components = cache.get(w.cells)
  if (components) return components
  components = new Int32Array(w.cells.length).fill(-1)
  for (const cell of w.cells) {
    if (!habitableLand(cell) || components[cell.id] >= 0) continue
    const queue = [cell.id]
    components[cell.id] = cell.id
    for (let i = 0; i < queue.length; i++)
      for (const next of movementNeighbors(w.cells, queue[i], w.width, w.height)) {
        if (!habitableLand(w.cells[next]) || components[next] >= 0) continue
        components[next] = cell.id
        queue.push(next)
      }
  }
  cache.set(w.cells, components)
  return components
}
