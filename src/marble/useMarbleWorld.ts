import { useEffect, useState } from 'react'
import { WorldClient } from './WorldClient'
import { WORLD_VERSION } from '../../shared/worldProtocol.mjs'

export function useMarbleWorld() {
  const [client] = useState(() => new WorldClient())
  const [, update] = useState(0)
  useEffect(() => {
    let stopped = false, attempt = 0
    let socket: WebSocket | null = null, retry: ReturnType<typeof setTimeout> | undefined
    function connect() {
      const url = new URL(new URLSearchParams(location.search).get('bridge') ?? 'ws://127.0.0.1:4319')
      url.searchParams.set('role', 'browser-spatial')
      const current = new WebSocket(url); socket = current
      client.send = (value) => { if (current.readyState === WebSocket.OPEN) current.send(JSON.stringify(value)) }
      current.onopen = () => { attempt = 0; client.send({ type: 'world-hello', protocolVersion: WORLD_VERSION }) }
      current.onmessage = (event) => { if (socket !== current || stopped) return; try { client.receive(JSON.parse(event.data)) } catch { /* Invalid metadata. */ } }
      current.onerror = () => current.close()
      current.onclose = () => {
        if (stopped || socket !== current) return
        client.disconnect(); retry = setTimeout(connect, Math.min(500 * 2 ** Math.min(attempt++, 4), 5000))
      }
    }
    const hidden = () => { if (document.hidden && client.latest?.active) { if (client.isOwner) client.command('pause'); client.stale() } }
    document.addEventListener('visibilitychange', hidden)
    connect()
    const interval = setInterval(() => { client.checkFreshness(); update((n) => n + 1) }, 100)
    return () => {
      if (client.isOwner && client.latest?.active) client.command('stop')
      stopped = true; clearTimeout(retry); clearInterval(interval); socket?.close()
      client.send = () => {}; document.removeEventListener('visibilitychange', hidden)
    }
  }, [client])
  return client
}
