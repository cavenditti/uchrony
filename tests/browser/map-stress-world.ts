import { generateWorld } from '../../src/sim/generate'
import { tick } from '../../src/sim/engine'
self.onmessage = () => {
  const world = generateWorld('Map memory stress fixture', 3, 32, undefined, 'world')
  for (let i = 0; i < 3; i++) tick(world)
  self.postMessage(world)
}
