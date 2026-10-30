import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

/** Isolated manual UI qualification, with no connection to the user's saved world. */
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  server: { host: '127.0.0.1', port: 5198, strictPort: true },
})
