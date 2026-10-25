import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from 'vite'

// Keep concurrent project edits and provider/save services out of this fixture.
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  cacheDir: join(tmpdir(), 'uchrony-map-stress-vite-cache'),
  esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: 5192, strictPort: true, hmr: false },
  optimizeDeps: { include: ['react', 'react-dom/client', 'three', 'lucide-react'] },
})
