import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { historicalServer } from './server/storyteller'
export default defineConfig(({ mode }) => ({
  plugins: [react(), historicalServer(mode)],
  server: { port: 5173, strictPort: true },
}))
