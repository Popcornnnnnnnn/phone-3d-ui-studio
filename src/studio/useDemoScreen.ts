import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import {
  DemoScreenRenderer,
  INITIAL_DEMO_STATE,
  type DemoScreenState,
} from './demoScreens'
import type { PoseSample } from './contracts'
import type { SharedRoomController } from '../webplay/useSharedRoom'
import { MARBLE_GEOMETRY } from '../../shared/marbleMath.mjs'
import { SPATIAL_START } from '../../shared/spatialMath.mjs'

export function useDemoScreen(active: boolean, sharedRoom?: SharedRoomController) {
  const [renderer] = useState(() => new DemoScreenRenderer())
  const [demoState, setDemoState] = useState<DemoScreenState>(INITIAL_DEMO_STATE)
  const poseRef = useRef<PoseSample | null>(null)

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
      if (paired && sharedRoom?.peerPoseRef.current) {
        poseRef.current = {
          timestampMs: Date.now(),
          quaternion: sharedRoom.peerPoseRef.current,
        }
      } else {
        poseRef.current = null
      }
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

  useEffect(() => {
    if (!active || !sharedRoom?.paired) return
    const timer = setInterval(() => {
      sharedRoom.sendWorldSnapshot({
        phone: { position: [...SPATIAL_START], quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] },
        balls: [],
        activeBallId: null,
        hitCount: 0,
        lastImpact: null,
        canAddBall: false,
        region: 'tray',
        geometry: MARBLE_GEOMETRY,
        mode: 'showcase',
        activeScreenId: demoState.screenId,
      })
    }, 250)
    return () => clearInterval(timer)
  }, [active, demoState.screenId, sharedRoom])

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
      poseRef: poseRef as RefObject<PoseSample | null>,
    }),
    [demoState, dispatchControl, poseRef, renderer.media],
  )
}
