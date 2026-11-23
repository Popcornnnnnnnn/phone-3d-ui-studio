import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const basePath =
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.VITE_BASE_PATH ?? './'

export default defineConfig({
  base: basePath,
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4317,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4318,
    strictPort: true,
  },
})
