import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import {
  CanvasTexture,
  Matrix4,
  Quaternion,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Group,
} from 'three'
import { initMarblePhysics } from '../../shared/marbleWorld.mjs'
import { MARBLE_GEOMETRY as G } from '../../shared/marbleMath.mjs'
import {
  type PhoneFinishId,
  type PhoneProfile,
  type PhoneProfileId,
} from '../../shared/phoneGeometry.mjs'
import { SPATIAL_MODEL_SCALE } from '../../shared/spatialMath.mjs'
import { WORLD_VERSION, type WorldSnapshot } from '../../shared/worldProtocol.mjs'
import {
  normalizeRoomCode,
  formatRoomCode,
  type WebDeviceMessage,
  type WebPlayMode,
  type WebWorldSnapshot,
} from '../../shared/webPlayProtocol.mjs'
import { useAppearance } from '../appearance'
import { drawMarbleScreen } from '../marble/drawMarbleScreen'
import { createMarbleMaterialSet } from '../marble/marbleMaterials'
import { fittedPhoneDisplayMetrics } from '../model/publicPhoneAssets'
import { usePhoneAppearance } from '../model/usePhoneAppearance'
import { SpatialPhoneModel } from '../spatial/SpatialPhoneModel'
import { DEMO_SCREENS, type DemoScreenId } from '../studio/demoScreens'
import { WorkspaceLighting } from '../workspace/WorkspaceLighting'
import { DeviceAppearancePicker } from './DeviceAppearancePicker'
import { detectLocalDeviceInfo, type DetectedDeviceInfo } from './deviceDetect'
import { NativeDialog } from './NativeDialog'
import {
  applyHandheldNeutral,
  applyTabletopYaw,
  calibrateHandheldNeutral,
  calibrateTabletopYaw,
  FlickDetector,
  orientationToBodyQuaternion,
  requestMotionPermissions,
  type HandheldCalibration,
} from './phoneSensors'
import { RoomConnection, type RoomConnectionStatus } from './roomConnection'
import { soundFeedback } from './soundFeedback'
import { DEFAULT_WEB_PLAY_SETTINGS, WebTrayDriver } from './webTrayDriver'
import './webplay.css'
import './mobile.css'

function SoloMobileScene({
  driver,
  profile,
  finishId,
  gyroQuatRef,
  dragTiltRef,
  motionActive,
  onHud,
}: {
  driver: WebTrayDriver
  profile: PhoneProfile
  finishId: PhoneFinishId
  gyroQuatRef: React.RefObject<[number, number, number, number] | null>
  dragTiltRef: React.RefObject<{ x: number; y: number }>
  motionActive: boolean
  onHud: (hitCount: number, canAddBall: boolean, hasActive: boolean) => void
}) {
  const { colorScheme } = useAppearance()
  const isDark = colorScheme === 'dark'
  const phone = useRef<Group>(null)
  const balls = useRef<Array<Group | null>>([])
  const inverse = useMemo(() => new Matrix4(), [])
  const g = driver.getGeometry()
  const slotGeometry = useMemo(() => new Vector2(g.radius, g.screenZ), [g.radius, g.screenZ])
  const screenBounds = useMemo(
    () => new Vector3(g.width / 2 - g.cornerRadius, g.height / 2 - g.cornerRadius, g.cornerRadius),
    [g.cornerRadius, g.height, g.width],
  )
  const surface = useMemo(() => {
    const { displayWidth, displayHeight } = fittedPhoneDisplayMetrics(profile)
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = Math.round(640 * (displayHeight / displayWidth))
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    texture.anisotropy = 8
    return {
      canvas,
      context: canvas.getContext('2d')!,
      displayWidthMeters: displayWidth * SPATIAL_MODEL_SCALE,
      displayHeightMeters: displayHeight * SPATIAL_MODEL_SCALE,
      media: { kind: 'texture' as const, name: 'Solo Tray', width: canvas.width, height: canvas.height, texture },
    }
  }, [profile])

  const marbleMaterials = useMemo(() => createMarbleMaterialSet(inverse, slotGeometry, screenBounds), [inverse, slotGeometry, screenBounds])
  const surfaceRef = useRef(surface)

  useEffect(() => {
    surfaceRef.current = surface
    return () => surface.media.texture.dispose()
  }, [surface])
  useEffect(() => {
    marbleMaterials.ensureTexturesUploaded()
    return () => marbleMaterials.dispose()
  }, [marbleMaterials])

  const lastHudRef = useRef(0)

  useFrame((_, delta) => {
    if (motionActive && gyroQuatRef.current) {
      driver.setTargetQuaternion(gyroQuatRef.current)
    } else {
      driver.setTiltInput(dragTiltRef.current.x, dragTiltRef.current.y)
    }
    const snap = driver.stepFrame(delta)
    const curG = driver.getGeometry()
    slotGeometry.set(curG.radius, curG.screenZ)
    screenBounds.set(curG.width / 2 - curG.cornerRadius, curG.height / 2 - curG.cornerRadius, curG.cornerRadius)
    phone.current?.position.set(...snap.phone.position)
    phone.current?.quaternion.set(...snap.phone.quaternion)
    inverse
      .compose(new Vector3(...snap.phone.position), new Quaternion(...snap.phone.quaternion), new Vector3(1, 1, 1))
      .invert()

    balls.current.forEach((group, index) => {
      if (!group) return
      const body = snap.balls[index]
      group.visible = !!body
      if (!body) return
      group.position.set(...body.position)
      group.quaternion.set(...body.quaternion)
      group.scale.setScalar(body.radius / G.radius)
      group.children[0].visible = body.state === 'active'
      group.children[1].visible = body.state !== 'active'
    })

    const drawSnap: WorldSnapshot = {
      type: 'world-snapshot',
      protocolVersion: WORLD_VERSION,
      worldId: 'solo-mobile',
      epoch: 1,
      sequence: 1,
      serverTimeMs: Date.now(),
      phase: 'running',
      reason: '',
      ownerId: null,
      phoneSessionId: null,
      phoneConnectionId: null,
      source: null,
      canStart: false,
      canAddBall: snap.canAddBall,
      active: true,
      hitCount: snap.hitCount,
      region: snap.region,
      geometry: driver.getGeometry(),
      phone: snap.phone,
      balls: snap.balls,
      activeBallId: snap.activeBallId,
      lastImpact: snap.lastImpact,
    }
    const display = surfaceRef.current
    drawMarbleScreen(display.context, display.canvas.width, display.canvas.height, drawSnap, {
      mode: 'surface',
      displayWidthMeters: display.displayWidthMeters,
      displayHeightMeters: display.displayHeightMeters,
    })
    display.media.texture.needsUpdate = true

    const now = performance.now()
    if (now - lastHudRef.current > 100) {
      lastHudRef.current = now
      onHud(snap.hitCount, snap.canAddBall, snap.activeBallId !== null)
    }
  })

  return (
    <>
      <WorkspaceLighting />
      <ContactShadows
        frames={1}
        position={[0, 0.02, 0]}
        opacity={isDark ? 0.52 : 0.24}
        scale={0.7}
        blur={2.1}
        far={0.35}
        resolution={256}
        color={isDark ? '#000000' : '#1b2029'}
      />
      <group ref={phone}>
        <SpatialPhoneModel profile={profile} finishId={finishId} media={surface.media} />
      </group>
      {Array.from({ length: 5 }, (_, index) => (
        <group key={index} ref={(group) => { balls.current[index] = group }} visible={false}>
          <mesh material={marbleMaterials.active}><sphereGeometry args={[G.radius, 48, 32]} /></mesh>
          <mesh material={marbleMaterials.trail}><sphereGeometry args={[G.radius, 32, 24]} /></mesh>
        </group>
      ))}
    </>
  )
}

export function MobilePlayView({
  initialRoomCode,
  onSwitchToDesktop,
}: {
  initialRoomCode: string | null
  onSwitchToDesktop: () => void
}) {
  const appearance = usePhoneAppearance()
  const { applyDetectedDevice } = appearance
  const localDeviceRef = useRef<DetectedDeviceInfo | null>(null)
  const [deviceDialogOpen, setDeviceDialogOpen] = useState(false)

  const [roomCode, setRoomCode] = useState<string | null>(initialRoomCode)
  const isPairedMode = roomCode !== null

  const [gateOpen, setGateOpen] = useState(true)
  const [motionActive, setMotionActive] = useState(false)
  const [permissionNote, setPermissionNote] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)

  // Solo physics state
  const [driver, setDriver] = useState<WebTrayDriver | null>(null)
  const initialProfileRef = useRef(appearance.profile)
  const [soloHud, setSoloHud] = useState({ hitCount: 0, canAddBall: false, hasActive: true })

  // Paired room state
  const [roomStatus, setRoomStatus] = useState<RoomConnectionStatus>('idle')
  const [pairedSnapshot, setPairedSnapshot] = useState<WebWorldSnapshot | null>(null)
  const connRef = useRef<RoomConnection | null>(null)
  const pairedCanvasRef = useRef<HTMLCanvasElement>(null)

  // Pair modal state (for jumping from Solo -> Paired)
  const [pairDialogOpen, setPairDialogOpen] = useState(false)
  const [codeDraft, setCodeDraft] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)

  // Sensors & calibration refs
  const rawBodyQuatRef = useRef<[number, number, number, number] | null>(null)
  const gyroQuatRef = useRef<[number, number, number, number] | null>(null)
  const soloCalRef = useRef<HandheldCalibration | null>(null)
  const pairedCalRef = useRef<ReturnType<typeof calibrateTabletopYaw>>(null)
  const flickDetectorRef = useRef(new FlickDetector())
  const seqRef = useRef(0)
  const lastPoseSendMsRef = useRef(0)
  const lastImpactPlayedRef = useRef(0)

  // Touch drag fallback tilt (for Solo mode without gyro or desktop testing)
  const dragTiltRef = useRef({ x: 0, y: 0 })
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null)

  const sendLocalDeviceInfo = useCallback(
    (overrideProfileId?: PhoneProfileId) => {
      const info = localDeviceRef.current
      if (!info || !connRef.current) return
      const payload: WebDeviceMessage = {
        type: 'web-device',
        platform: info.platform,
        screenWidth: info.screenWidth,
        screenHeight: info.screenHeight,
        dpr: info.dpr,
        ...(info.modelHint ? { modelHint: info.modelHint } : {}),
        ...(overrideProfileId ? { preferredProfileId: overrideProfileId } : !appearance.autoMatch ? { preferredProfileId: appearance.profileId } : {}),
        preferredFinishId: appearance.finishId,
      }
      connRef.current.send(payload)
    },
    [appearance.autoMatch, appearance.finishId, appearance.profileId],
  )

  useEffect(() => {
    let cancelled = false
    void detectLocalDeviceInfo().then((info) => {
      if (cancelled) return
      localDeviceRef.current = info
      applyDetectedDevice(info)
    })
    return () => {
      cancelled = true
    }
  }, [applyDetectedDevice])

  useEffect(() => {
    driver?.setProfile(appearance.profile)
  }, [appearance.profile, driver])

  useEffect(() => {
    if (isPairedMode) return
    let cancelled = false
    void initMarblePhysics().then(() => {
      if (cancelled) return
      const instance = new WebTrayDriver(
        DEFAULT_WEB_PLAY_SETTINGS,
        {
          onCatch: () => soundFeedback.playCatch(),
          onDrop: () => soundFeedback.playDrop(),
          onSpawn: () => soundFeedback.playSpawn(),
        },
        initialProfileRef.current,
      )
      setDriver(instance)
    })
    return () => {
      cancelled = true
    }
  }, [isPairedMode])

  useEffect(() => {
    return () => {
      driver?.free()
    }
  }, [driver])

  useEffect(() => {
    if (!roomCode) {
      connRef.current?.close()
      connRef.current = null
      return
    }

    const conn = new RoomConnection({
      roomCode,
      role: 'phone',
      onStatus: setRoomStatus,
      onMessage: (msg) => {
        if (msg.type === 'web-world') {
          setPairedSnapshot(msg)
          if (msg.lastImpact && msg.lastImpact.sequence > lastImpactPlayedRef.current) {
            lastImpactPlayedRef.current = msg.lastImpact.sequence
            soundFeedback.playCatch()
          }
        }
      },
    })
    connRef.current = conn
    conn.connect()

    return () => {
      conn.close()
      if (connRef.current === conn) connRef.current = null
    }
  }, [roomCode])

  useEffect(() => {
    if (roomStatus === 'paired-relay' || roomStatus === 'paired-p2p') {
      sendLocalDeviceInfo()
    }
  }, [roomStatus, sendLocalDeviceInfo])

  useEffect(() => {
    const canvas = pairedCanvasRef.current
    if (!canvas || !pairedSnapshot || pairedSnapshot.mode !== 'marble') return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const drawSnap: WorldSnapshot = {
      type: 'world-snapshot',
      protocolVersion: WORLD_VERSION,
      worldId: roomCode ?? 'paired',
      epoch: 1,
      sequence: pairedSnapshot.seq,
      serverTimeMs: Date.now(),
      phase: 'running',
      reason: '',
      ownerId: null,
      phoneSessionId: null,
      phoneConnectionId: null,
      source: null,
      canStart: false,
      canAddBall: pairedSnapshot.canAddBall,
      active: true,
      hitCount: pairedSnapshot.hitCount,
      region: pairedSnapshot.region,
      geometry: pairedSnapshot.geometry,
      phone: pairedSnapshot.phone,
      balls: pairedSnapshot.balls,
      activeBallId: pairedSnapshot.activeBallId,
      lastImpact: pairedSnapshot.lastImpact,
    }
    drawMarbleScreen(ctx, canvas.width, canvas.height, drawSnap, { mode: '2d' })
  }, [pairedSnapshot, roomCode])

  const recenter = useCallback(() => {
    const raw = rawBodyQuatRef.current
    if (!raw) return
    if (isPairedMode) {
      pairedCalRef.current = calibrateTabletopYaw(raw)
    } else {
      soloCalRef.current = calibrateHandheldNeutral(raw)
    }
  }, [isPairedMode])

  useEffect(() => {
    if (!motionActive) return

    const onOrientation = (event: DeviceOrientationEvent) => {
      if (event.alpha === null || event.beta === null || event.gamma === null) return
      const screenAngle = window.screen?.orientation?.angle ?? 0
      const body = orientationToBodyQuaternion(event.alpha, event.beta, event.gamma, screenAngle)
      rawBodyQuatRef.current = body

      if (isPairedMode) {
        if (!pairedCalRef.current) pairedCalRef.current = calibrateTabletopYaw(body)
        const calibrated = applyTabletopYaw(body, pairedCalRef.current)
        gyroQuatRef.current = calibrated

        const now = performance.now()
        if (now - lastPoseSendMsRef.current >= 16) {
          lastPoseSendMsRef.current = now
          seqRef.current += 1
          connRef.current?.send(
            { type: 'web-pose', seq: seqRef.current, sentAtMs: Date.now(), quaternion: calibrated },
            { droppable: true },
          )
        }
      } else {
        if (!soloCalRef.current) soloCalRef.current = calibrateHandheldNeutral(body)
        gyroQuatRef.current = applyHandheldNeutral(body, soloCalRef.current)
      }
    }

    const onMotion = (event: DeviceMotionEvent) => {
      const strength = flickDetectorRef.current.sample(event.acceleration)
      if (!strength) return
      if (isPairedMode) {
        connRef.current?.send({ type: 'web-action', action: 'toss', strength })
      } else {
        driver?.triggerToss(strength)
      }
    }

    window.addEventListener('deviceorientation', onOrientation)
    window.addEventListener('devicemotion', onMotion)
    return () => {
      window.removeEventListener('deviceorientation', onOrientation)
      window.removeEventListener('devicemotion', onMotion)
    }
  }, [driver, isPairedMode, motionActive])

  const startWithSensors = useCallback(async () => {
    soundFeedback.unlock()
    const result = await requestMotionPermissions()
    if (result === 'granted') {
      setMotionActive(true)
      setPermissionNote(null)
    } else {
      setMotionActive(false)
      setPermissionNote(
        result === 'denied'
          ? 'Motion permission was denied. You can still play by dragging on screen.'
          : 'Motion sensors unavailable here. Drag on screen to tilt.',
      )
    }
    if ('wakeLock' in navigator) {
      void navigator.wakeLock.request('screen').catch(() => {})
    }
    setGateOpen(false)
  }, [])

  const desktopMode: WebPlayMode = pairedSnapshot?.mode ?? 'marble'
  const pairedLabel = roomStatus === 'paired-p2p'
    ? `Room ${formatRoomCode(roomCode ?? '')} · Direct P2P`
    : roomStatus === 'paired-relay'
      ? `Room ${formatRoomCode(roomCode ?? '')} · Cloud Relay`
      : roomStatus === 'waiting-peer'
        ? `Room ${formatRoomCode(roomCode ?? '')} · Waiting for desktop`
        : roomStatus === 'unavailable'
          ? 'Signaling server unreachable'
          : 'Connecting to desktop…'

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault()
    const normalized = normalizeRoomCode(codeDraft)
    if (!normalized) {
      setCodeError('Enter a valid 6-character code (for example ABC-234).')
      return
    }
    setCodeError(null)
    setPairDialogOpen(false)
    pairedCalRef.current = null
    setRoomCode(normalized)
    const url = new URL(window.location.href)
    url.searchParams.set('pair', normalized)
    window.history.replaceState(null, '', url)
  }

  return (
    <div className="mobile-play-shell">
      <header className="mobile-play-header">
        <div className="mobile-play-title">
          <strong>{isPairedMode ? 'Phone Controller' : 'Phone 3D · Elastic Tray'}</strong>
          <span>{isPairedMode ? pairedLabel : motionActive ? 'Tilt to roll · Flick up to toss' : 'Drag screen to tilt'}</span>
        </div>
        <div className="mobile-play-header-actions">
          <button type="button" onClick={() => setDeviceDialogOpen(true)}>
            Device
          </button>
          {!isPairedMode && (
            <button type="button" onClick={onSwitchToDesktop}>
              Desktop
            </button>
          )}
          {isPairedMode ? (
            <button
              type="button"
              onClick={() => {
                setRoomCode(null)
                setRoomStatus('idle')
                setPairedSnapshot(null)
                const url = new URL(window.location.href)
                url.searchParams.delete('pair')
                window.history.replaceState(null, '', url)
              }}
            >
              Solo
            </button>
          ) : (
            <button type="button" onClick={() => setPairDialogOpen(true)}>
              Pair Desktop
            </button>
          )}
        </div>
      </header>

      <main
        className="mobile-play-stage"
        onPointerDown={(e) => {
          if (isPairedMode || motionActive) return
          dragOriginRef.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerMove={(e) => {
          if (!dragOriginRef.current) return
          const dx = Math.max(-1, Math.min(1, (e.clientX - dragOriginRef.current.x) / 90))
          const dy = Math.max(-1, Math.min(1, (e.clientY - dragOriginRef.current.y) / 90))
          dragTiltRef.current = { x: dx, y: dy }
        }}
        onPointerUp={() => {
          dragOriginRef.current = null
          dragTiltRef.current = { x: 0, y: 0 }
        }}
        onPointerCancel={() => {
          dragOriginRef.current = null
          dragTiltRef.current = { x: 0, y: 0 }
        }}
      >
        {isPairedMode ? (
          desktopMode === 'showcase' ? (
            <div className="mobile-showcase-remote">
              <h2>3D UI Showcase Remote</h2>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                Tilt your phone to rotate the 3D iPhone on desktop, and tap below to control the screen live.
              </p>
              <div className="mobile-remote-row">
                {DEMO_SCREENS.map((scr) => (
                  <button
                    key={scr.id}
                    type="button"
                    className={pairedSnapshot?.activeScreenId === scr.id ? 'is-primary' : ''}
                    onClick={() => connRef.current?.send({ type: 'web-ui-event', screenId: scr.id, control: 'select-screen', value: scr.id })}
                  >
                    {scr.label}
                  </button>
                ))}
              </div>
              {((pairedSnapshot?.activeScreenId as DemoScreenId | undefined) ?? 'audio') === 'audio' && (
                <div className="mobile-remote-row">
                  <button type="button" onClick={() => connRef.current?.send({ type: 'web-ui-event', screenId: 'audio', control: 'prev-track' })}>Prev</button>
                  <button type="button" className="is-primary" onClick={() => connRef.current?.send({ type: 'web-ui-event', screenId: 'audio', control: 'toggle-play' })}>Play / Pause</button>
                  <button type="button" onClick={() => connRef.current?.send({ type: 'web-ui-event', screenId: 'audio', control: 'next-track' })}>Next</button>
                </div>
              )}
              {pairedSnapshot?.activeScreenId === 'weather' && (
                <div className="mobile-remote-row">
                  <button type="button" className="is-primary" onClick={() => connRef.current?.send({ type: 'web-ui-event', screenId: 'weather', control: 'cycle-weather' })}>Switch Weather</button>
                </div>
              )}
              {pairedSnapshot?.activeScreenId === 'notifications' && (
                <div className="mobile-remote-row">
                  <button type="button" className="is-primary" onClick={() => connRef.current?.send({ type: 'web-ui-event', screenId: 'notifications', control: 'cycle-notification' })}>Next Notification Card</button>
                </div>
              )}
            </div>
          ) : (
            <>
              <canvas
                ref={pairedCanvasRef}
                width={390}
                height={844}
                className="mobile-play-canvas-2d"
                aria-label="Paired Elastic Tray display"
              />
              <div className="mobile-play-hud">
                <span className="mobile-hud-pill">{pairedSnapshot?.hitCount ?? 0} catches</span>
                <span className="mobile-hud-pill">
                  {pairedSnapshot?.canAddBall ? 'Tap Add ball' : pairedSnapshot?.region === 'air' ? 'In air' : 'On tray'}
                </span>
              </div>
            </>
          )
        ) : (
          <>
            {driver && (
              <Canvas
                dpr={[1, 2]}
                camera={{ position: [0.05, 0.45, 0.16], fov: 36, near: 0.01, far: 100 }}
                gl={{ antialias: true, alpha: true }}
              >
                <SoloMobileScene
                  driver={driver}
                  profile={appearance.profile}
                  finishId={appearance.finishId}
                  gyroQuatRef={gyroQuatRef}
                  dragTiltRef={dragTiltRef}
                  motionActive={motionActive}
                  onHud={(hitCount, canAddBall, hasActive) => setSoloHud({ hitCount, canAddBall, hasActive })}
                />
              </Canvas>
            )}
            <div className="mobile-play-hud">
              <span className="mobile-hud-pill">{soloHud.hitCount} catches</span>
              {permissionNote && <span className="mobile-hud-pill">Touch drag mode</span>}
            </div>
          </>
        )}

        {gateOpen && (
          <div className="mobile-play-gate">
            <div className="mobile-gate-card">
              <h1>{isPairedMode ? 'Connect Motion Controller' : 'Play Elastic Tray'}</h1>
              <p>
                {isPairedMode
                  ? 'Allow motion access so your phone tilts the 3D iPhone and tosses marbles live on your desktop.'
                  : 'Tilt your phone to roll the marble through the right exit, or flick upward to toss and catch it.'}
              </p>
              <button type="button" className="is-primary" onClick={() => void startWithSensors()}>
                {isPairedMode ? 'Enable Motion & Connect' : 'Enable Motion & Play'}
              </button>
              {!isPairedMode && (
                <button
                  type="button"
                  onClick={() => {
                    soundFeedback.unlock()
                    setMotionActive(false)
                    setGateOpen(false)
                  }}
                >
                  Play with Touch Drag
                </button>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="mobile-play-bar">
        {isPairedMode ? (
          <>
            <button
              type="button"
              className={pairedSnapshot?.canAddBall ? 'is-primary' : ''}
              disabled={!pairedSnapshot?.canAddBall}
              onClick={() => {
                soundFeedback.unlock()
                connRef.current?.send({ type: 'web-action', action: 'add-ball' })
              }}
            >
              Add ball
            </button>
            <button
              type="button"
              onClick={() => {
                soundFeedback.unlock()
                connRef.current?.send({ type: 'web-action', action: 'toss', strength: 1 })
              }}
            >
              Toss
            </button>
            <button type="button" onClick={recenter}>
              Recenter
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={soloHud.canAddBall ? 'is-primary' : ''}
              disabled={!driver || !soloHud.canAddBall}
              onClick={() => {
                soundFeedback.unlock()
                driver?.addBall()
              }}
            >
              Add ball
            </button>
            <button
              type="button"
              className={!soloHud.canAddBall ? 'is-primary' : ''}
              disabled={!driver || !soloHud.hasActive}
              onClick={() => {
                soundFeedback.unlock()
                driver?.triggerToss(1)
              }}
            >
              Toss
            </button>
            <button type="button" onClick={recenter}>
              Recenter
            </button>
            <button type="button" onClick={() => driver?.restart(DEFAULT_WEB_PLAY_SETTINGS)}>
              Reset
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => {
            const next = !muted
            setMuted(next)
            soundFeedback.setMuted(next)
          }}
        >
          {muted ? 'Muted' : 'Sound'}
        </button>
      </footer>

      <NativeDialog open={deviceDialogOpen} title="Device Appearance" onClose={() => setDeviceDialogOpen(false)}>
        <DeviceAppearancePicker
          compact
          appearance={appearance}
          onUserChange={(profileId) => {
            if (isPairedMode) sendLocalDeviceInfo(profileId)
          }}
        />
        <div className="webplay-dialog-actions">
          <button type="button" autoFocus onClick={() => setDeviceDialogOpen(false)}>
            Done
          </button>
        </div>
      </NativeDialog>

      <NativeDialog open={pairDialogOpen} title="Pair with Desktop" onClose={() => setPairDialogOpen(false)}>
        <p>Open Phone 3D UI Studio on your computer and enter its 6-character room code.</p>
        <form className="mobile-pair-form" onSubmit={handleJoinRoom}>
          <input
            type="text"
            value={codeDraft}
            onChange={(e) => setCodeDraft(e.target.value.toUpperCase())}
            placeholder="ABC-234"
            maxLength={8}
            autoCapitalize="characters"
            autoCorrect="off"
            aria-label="Room code"
            autoFocus
          />
          {codeError && <p style={{ margin: 0, color: 'var(--error)' }}>{codeError}</p>}
          <div className="webplay-dialog-actions">
            <button type="button" onClick={() => setPairDialogOpen(false)}>Cancel</button>
            <button type="submit" className="spatial-primary" style={{ width: 'auto' }}>Connect</button>
          </div>
        </form>
      </NativeDialog>
    </div>
  )
}
