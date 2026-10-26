import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../..', import.meta.url))
export default defineConfig({
  root,
  worker: { format: 'es' },
  build: {
    outDir: '/private/tmp/uchrony-influence-browser',
    emptyOutDir: true,
    rollupOptions: {
      input: [`${root}/tests/browser/influence.html`, `${root}/tests/browser/urban-density.html`],
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 5198,
    strictPort: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
