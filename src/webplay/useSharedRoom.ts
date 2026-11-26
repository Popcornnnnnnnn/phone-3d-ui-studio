import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { Quaternion, Vector3 } from 'three'
import {
  generateRoomCode,
  type WebDeviceMessage,
  type WebPlayGameMessage,
  type WebWorldSnapshot,
} from '../../shared/webPlayProtocol.mjs'
import type { Quat } from '../../shared/spatialProtocol.mjs'
import { RoomConnection, type RoomConnectionStatus } from './roomConnection'

export interface SharedRoomController {
  roomCode: string
  status: RoomConnectionStatus
  paired: boolean
  peerDevice: WebDeviceMessage | null
  peerPoseRef: RefObject<Quat | null>
  peerTiltRef: RefObject<{ x: number; y: number }>
  sendWorldSnapshot: (snapshot: Omit<WebWorldSnapshot, 'type' | 'seq'>) => void
  subscribeMessages: (handler: (msg: WebPlayGameMessage) => void) => () => void
  regenerateRoom: () => void
}

export function useSharedRoom(enabled: boolean): SharedRoomController {
  const [roomCode, setRoomCode] = useState(() => generateRoomCode())
  const [status, setStatus] = useState<RoomConnectionStatus>('idle')
  const [peerDevice, setPeerDevice] = useState<WebDeviceMessage | null>(null)
  const peerPoseRef = useRef<Quat | null>(null)
  const peerTiltRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const listenersRef = useRef(new Set<(msg: WebPlayGameMessage) => void>())
  const connRef = useRef<RoomConnection | null>(null)
  const seqRef = useRef(0)
  const lastSendMsRef = useRef(0)

  useEffect(() => {
    if (!enabled) {
      connRef.current?.close()
      connRef.current = null
      peerPoseRef.current = null
      peerTiltRef.current = { x: 0, y: 0 }
      return
    }

    const conn = new RoomConnection({
      roomCode,
      role: 'desktop',
      onStatus: (next) => {
        setStatus(next)
        if (next !== 'paired-relay' && next !== 'paired-p2p') {
          peerPoseRef.current = null
          peerTiltRef.current = { x: 0, y: 0 }
          setPeerDevice(null)
        }
      },
      onMessage: (msg) => {
        if (msg.type === 'web-pose') {
          peerPoseRef.current = msg.quaternion
          const q = new Quaternion(...msg.quaternion)
          const right = new Vector3(1, 0, 0).applyQuaternion(q)
          const top = new Vector3(0, 1, 0).applyQuaternion(q)
          peerTiltRef.current = {
            x: Math.max(-1, Math.min(1, -right.y * 2)),
            y: Math.max(-1, Math.min(1, -top.y * 2)),
          }
        } else if (msg.type === 'web-device') {
          setPeerDevice(msg)
        }
        listenersRef.current.forEach((fn) => fn(msg))
      },
    })
    connRef.current = conn
    conn.connect()

    return () => {
      conn.close()
      if (connRef.current === conn) connRef.current = null
    }
  }, [enabled, roomCode])

  const sendWorldSnapshot = useCallback((snapshot: Omit<WebWorldSnapshot, 'type' | 'seq'>) => {
    const conn = connRef.current
    if (!conn) return
    const currentStatus = conn.getStatus()
    if (currentStatus !== 'paired-relay' && currentStatus !== 'paired-p2p') return
    const now = performance.now()
    if (now - lastSendMsRef.current < 16) return
    lastSendMsRef.current = now
    seqRef.current += 1
    conn.send({ type: 'web-world', seq: seqRef.current, ...snapshot }, { droppable: true })
  }, [])

  const subscribeMessages = useCallback((handler: (msg: WebPlayGameMessage) => void) => {
    listenersRef.current.add(handler)
    return () => {
      listenersRef.current.delete(handler)
    }
  }, [])

  const regenerateRoom = useCallback(() => {
    peerPoseRef.current = null
    setPeerDevice(null)
    setRoomCode(generateRoomCode())
  }, [])

  const effectiveStatus = enabled ? status : 'idle'
  return {
    roomCode,
    status: effectiveStatus,
    paired: effectiveStatus === 'paired-relay' || effectiveStatus === 'paired-p2p',
    peerDevice: enabled ? peerDevice : null,
    peerPoseRef,
    peerTiltRef,
    sendWorldSnapshot,
    subscribeMessages,
    regenerateRoom,
  }
}
