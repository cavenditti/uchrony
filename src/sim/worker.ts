import { generateWorld } from './generate'
import { tick, applyCommand, summarize } from './engine'
import { validateWorld } from './persistence'
import type { World, WorkerRequest, WorkerResponse } from './types'

let world: World | null = null
const send = (message: WorkerResponse) => self.postMessage(message)
self.onmessage = ({ data }: MessageEvent<WorkerRequest>) => {
  try {
    let message: string | undefined
    if (data.type === 'generate') {
      world = generateWorld(data.seed, data.continents, data.nations)
      summarize(world)
    } else if (data.type === 'load') {
      world = validateWorld(data.world)
      message = 'World restored. Simulation is paused.'
    } else if (data.type === 'step') {
      if (!world) throw new Error('Generate a world first.')
      for (let i = 0; i < Math.min(120, Math.max(1, Math.floor(data.count))); i++) tick(world)
    } else if (data.type === 'command') {
      if (!world) throw new Error('Generate a world first.')
      message = applyCommand(world, data.command)
      summarize(world, false)
    }
    if (world) send({ type: 'world', world, message })
  } catch (error) {
    send({
      type: 'error',
      message: error instanceof Error ? error.message : 'The simulation could not complete that action.',
    })
  }
}
