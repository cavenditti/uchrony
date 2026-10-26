import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../..', import.meta.url))
export default defineConfig({
  root,
  worker: { format: 'es' },
  build: {
    outDir: '/private/tmp/uchrony-living-browser',
    emptyOutDir: true,
    rollupOptions: { input: `${root}/tests/browser/living-world.html` },
  },
  preview: { host: '127.0.0.1', port: 5199, strictPort: true },
})
