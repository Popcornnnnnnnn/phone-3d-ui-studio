import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DemoScreenRenderer,
  INITIAL_DEMO_STATE,
  type DemoScreenState,
} from './demoScreens'
import type { SharedRoomController } from '../webplay/useSharedRoom'

export function useDemoScreen(active: boolean, sharedRoom?: SharedRoomController) {
  const [renderer] = useState(() => new DemoScreenRenderer())
  const [demoState, setDemoState] = useState<DemoScreenState>(INITIAL_DEMO_STATE)

  useEffect(() => {
    return () => {
      renderer.dispose()
    }
  }, [renderer])

  useEffect(() => {
    if (!active) return
    let rafId = 0
    const tick = (nowMs: number) => {
      const paired = Boolean(sharedRoom?.paired && sharedRoom.peerPoseRef.current)
      const tilt = paired && sharedRoom
        ? sharedRoom.peerTiltRef.current
        : { x: Math.sin(nowMs / 1700) * 0.35, y: Math.cos(nowMs / 2100) * 0.25 }
      renderer.draw(nowMs, tilt)
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [active, renderer, sharedRoom])

  useEffect(() => {
    if (!active || !sharedRoom) return
    return sharedRoom.subscribeMessages((msg) => {
      if (msg.type === 'web-ui-event') {
        const next = renderer.handleControl(msg.control, msg.value)
        setDemoState(next)
      }
    })
  }, [active, renderer, sharedRoom])

  const dispatchControl = useCallback(
    (control: string, value?: string | number | boolean) => {
      const next = renderer.handleControl(control, value)
      setDemoState(next)
    },
    [renderer],
  )

  return useMemo(
    () => ({
      media: renderer.media,
      demoState,
      dispatchControl,
    }),
    [demoState, dispatchControl, renderer.media],
  )
}
