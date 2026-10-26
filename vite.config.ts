import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { historicalServer } from './server/storyteller'
import { autosaveServer } from './server/autosave'
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}
export default defineConfig(({ mode }) => ({
  plugins: [react(), autosaveServer(), historicalServer(mode)],
  server: { port: 5173, strictPort: true, headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  worker: { format: 'es' },
}))
