import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from 'vite'
import { autosaveMiddleware } from '../../server/autosave'

const root = fileURLToPath(new URL('../..', import.meta.url))
const output = process.env.UCHRONY_SOAK_DIR ?? join(tmpdir(), 'uchrony-full-app-soak')
const saves = autosaveMiddleware(join(output, 'saves'), (error) => console.error('Soak disk save:', error))

export default defineConfig({
  root,
  esbuild: { jsx: 'automatic' },
  build: {
    outDir: join(output, 'build'),
    emptyOutDir: true,
    rollupOptions: {
      input: [join(root, 'tests/browser/map-soak.html'), join(root, 'tests/browser/storage-check.html')],
    },
  },
  preview: { host: '127.0.0.1', port: Number(process.env.UCHRONY_SOAK_PORT ?? 5193), strictPort: true },
  plugins: [
    {
      name: 'isolated-endurance-services',
      configurePreviewServer(server) {
        server.middlewares.use(saves)
        server.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith('/api/')) return next()
          res.setHeader('Content-Type', 'application/json')
          // No provider credentials or paid model calls in a rendering test.
          if (req.url === '/api/history/status') res.end(JSON.stringify({ configured: false }))
          else {
            res.statusCode = 503
            res.end(JSON.stringify({ error: 'External services are disabled in this test.' }))
          }
        })
      },
    },
  ],
})
