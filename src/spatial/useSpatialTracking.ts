import { useEffect, useState } from 'react'
import { SpatialTracker } from './spatialTracking'

export function useSpatialTracking() {
  const [tracker] = useState(() => new SpatialTracker())
  const [, refresh] = useState(0)
  useEffect(() => {
    let stopped = false
    let socket: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    const connect = () => {
      if (stopped) return
      const override = new URLSearchParams(location.search).get('bridge')
      const url = new URL(override ?? 'ws://127.0.0.1:4319')
      url.searchParams.set('role', 'browser-spatial')
      const current = new WebSocket(url)
      socket = current
      current.onopen = () => { attempt = 0 }
      current.onmessage = (event) => {
        if (socket !== current || stopped) return
        try { tracker.receive(JSON.parse(event.data)) } catch { /* Ignore malformed metadata. */ }
      }
      current.onerror = () => current.close()
      current.onclose = () => {
        if (stopped || socket !== current) return
        tracker.disconnect('Bridge disconnected. Reconnecting…')
        retry = setTimeout(connect, Math.min(500 * 2 ** Math.min(attempt++, 4), 5000))
      }
    }
    connect()
    const interval = setInterval(() => { tracker.checkFreshness(); refresh((n) => n + 1) }, 100)
    const visibility = () => {
      if (document.hidden) tracker.invalidate('stale', 'Workspace hidden. Set origin again when you return.')
    }
    document.addEventListener('visibilitychange', visibility)
    return () => {
      stopped = true; clearTimeout(retry); clearInterval(interval)
      document.removeEventListener('visibilitychange', visibility)
      socket?.close()
      tracker.disconnect()
    }
  }, [tracker])
  return tracker
}
