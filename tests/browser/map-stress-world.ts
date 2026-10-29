import { generateWorld } from '../../src/sim/generate'
import { tick, prepareSpatialWorld } from '../../src/sim/engine'
import { viewSnapshot } from '../../src/sim/view-snapshot'
self.onmessage = ({ data }: MessageEvent<{ months?: number }>) => {
  const world = generateWorld('Map memory stress fixture', 3, 32, undefined, 'world')
  // Exercise the same physical mesh as a prepared game, including at month zero.
  prepareSpatialWorld(world)
  for (let i = 0; i < (data.months ?? 3); i++) tick(world)
  self.postMessage({ ...viewSnapshot(world), cells: world.cells })
}
