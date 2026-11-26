import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { createWebPlayRoomRelay } from './scripts/webplay-room-relay.mjs'

function webplayRoomRelayPlugin(): Plugin {
  return {
    name: 'webplay-room-relay',
    configureServer(server) {
      if (!server.httpServer) return
      const relay = createWebPlayRoomRelay()
      const detach = relay.attach(server.httpServer)
      server.httpServer.once('close', () => {
        detach()
        relay.close()
      })
    },
    configurePreviewServer(server) {
      if (!server.httpServer) return
      const relay = createWebPlayRoomRelay()
      const detach = relay.attach(server.httpServer)
      server.httpServer.once('close', () => {
        detach()
        relay.close()
      })
    },
  }
}

const basePath =
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.VITE_BASE_PATH ?? './'

export default defineConfig({
  base: basePath,
  plugins: [react(), webplayRoomRelayPlugin()],
  test: {
    exclude: [...configDefaults.exclude, 'build/**', 'captures/**'],
  },
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
