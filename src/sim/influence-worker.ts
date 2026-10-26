import { runInfluenceJobs, type SharedInfluenceJob } from './influence-kernel'
self.onmessage = ({ data }: MessageEvent<SharedInfluenceJob>) => runInfluenceJobs(data)

self.postMessage({ type: 'ready' })
