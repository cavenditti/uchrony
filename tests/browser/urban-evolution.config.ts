import { defineConfig } from 'vite'
import { autosaveMiddleware } from '../../server/autosave'
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: 5199, strictPort: true },
  plugins: [
    {
      name: 'urban-validation',
      configureServer(server) {
        server.middlewares.use(autosaveMiddleware('/private/tmp/uchrony-urban-browser-saves'))
      },
    },
  ],
})
