import { generateWorld } from '../../src/sim/generate'
import { tick, prepareSpatialWorld, applyCommand } from '../../src/sim/engine'
import { viewSnapshot } from '../../src/sim/view-snapshot'
import { foundingPlan } from '../../src/sim/founding'
import { validateWorld } from '../../src/sim/persistence'
import type { World, Command } from '../../src/sim/types'

let world: World
self.onmessage = ({
  data,
}: MessageEvent<{
  create?: boolean
  start?: 'frontier' | 'settled'
  months?: number
  command?: Command
}>) => {
  try {
    if (data.create)
      world = generateWorld(
        'Quadtree urban validation',
        3,
        8,
        undefined,
        'regional',
        data.start ?? 'frontier',
      )
    prepareSpatialWorld(world)
    let message = ''
    if (data.command) message = applyCommand(world, data.command)
    for (let i = 0; i < (data.months ?? 0); i++) tick(world)
    validateWorld(world)
    const candidate = world.regions.find((r) => {
      try {
        foundingPlan(world, 0, r.center)
        return true
      } catch {
        return false
      }
    })
    self.postMessage({
      message,
      candidate: candidate ? { cell: candidate.center, region: candidate.id, name: candidate.name } : null,
      world: { ...viewSnapshot(world, null), cells: world.cells },
    })
  } catch (error) {
    self.postMessage({ error: String(error) })
  }
}
