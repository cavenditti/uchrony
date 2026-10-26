import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { defineConfig } from 'vite'
import { autosaveMiddleware } from '../../server/autosave'
import { storytellerMiddleware } from '../../server/storyteller'
import { LlmPolicy } from '../../server/llm-policy'

const root = fileURLToPath(new URL('../..', import.meta.url))
const output = '/private/tmp/uchrony-density-browser-20261026'
const policy = new LlmPolicy(() => process.env.UCHRONY_LLM_OFF === '1')
let calls = 0
const saveRequests: { method: string; ms: number; status: number }[] = []
// Ordinary production routes, with a provider stub that cannot access external services.
const models = storytellerMiddleware('test', policy, async () => {
  calls++
  return Response.json({ error: 'No live providers in this qualification.' }, { status: 503 })
})
export default defineConfig({
  root,
  esbuild: { jsx: 'automatic' },
  build: {
    outDir: join(output, 'build'),
    emptyOutDir: true,
    rollupOptions: {
      input: [
        join(root, 'tests/browser/map-soak.html'),
        join(root, 'tests/browser/urban-density.html'),
        join(root, 'tests/browser/storage-check.html'),
        join(root, 'tests/browser/native-replay.html'),
      ],
    },
  },
  preview: { host: '127.0.0.1', port: 5197, strictPort: true },
  plugins: [
    {
      name: 'settlement-qualification',
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/api/saves/current') {
            const started = performance.now()
            res.once('finish', () => {
              saveRequests.push({
                method: req.method ?? '',
                ms: performance.now() - started,
                status: res.statusCode,
              })
              if (saveRequests.length > 20) saveRequests.shift()
            })
          }
          next()
        })
        server.middlewares.use(autosaveMiddleware(join(output, 'saves')))
        server.middlewares.use((req, res, next) => {
          if (req.url !== '/api/qualification') return next()
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ providerCalls: calls, policy: policy.snapshot(), saveRequests }))
        })
        server.middlewares.use(models)
      },
    },
  ],
})
