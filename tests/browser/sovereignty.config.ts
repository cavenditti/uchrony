import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

/** A local browser fixture avoids the live world's saves and provider services. */
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  server: { host: '127.0.0.1', port: 5197, strictPort: true },
})
