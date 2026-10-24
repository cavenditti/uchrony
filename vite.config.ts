import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { historicalServer } from './server/storyteller'
import { autosaveServer } from './server/autosave'
export default defineConfig(({ mode }) => ({
  plugins: [react(), autosaveServer(), historicalServer(mode)],
  server: { port: 5173, strictPort: true },
}))
