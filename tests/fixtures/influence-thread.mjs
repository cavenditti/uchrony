import { parentPort } from 'node:worker_threads'
import { tsImport } from 'tsx/esm/api'
const { runInfluenceJobs } = await tsImport('../../src/sim/influence-kernel.ts', import.meta.url)
parentPort.on('message', runInfluenceJobs)
