import type { HttpServer } from 'vite'
import type { Duplex } from 'node:stream'
import type { IncomingMessage } from 'node:http'

export interface WebPlayRoomRelay {
  attach(httpServer: HttpServer): () => void
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean
  close(): void
}

export function createWebPlayRoomRelay(): WebPlayRoomRelay
