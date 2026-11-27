import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { ContactShadows, OrbitControls } from '@react-three/drei'
import {
  CanvasTexture,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Group,
} from 'three'
import { initMarblePhysics } from '../../shared/marbleWorld.mjs'
import { MARBLE_GEOMETRY as G } from '../../shared/marbleMath.mjs'
import { DEFAULT_MARBLE_SETTINGS, MARBLE_SETTING_LIMITS } from '../../shared/marbleSettings.mjs'
import {
  PHONE_FINISHES,
  PHONE_PROFILES,
  type PhoneFinishId,
  type PhoneProfile,
  type PhoneProfileId,
} from '../../shared/phoneGeometry.mjs'
import { SPATIAL_START } from '../../shared/spatialMath.mjs'
import { WORLD_VERSION, type WorldSnapshot } from '../../shared/worldProtocol.mjs'
import { formatRoomCode } from '../../shared/webPlayProtocol.mjs'
import { useAppearance } from '../appearance'
import { drawMarbleScreen } from '../marble/drawMarbleScreen'
import { createClippedMarbleMaterial } from '../marble/marbleMaterials'
import { fittedPhoneDisplayMetrics } from '../model/publicPhoneAssets'
import { usePhoneAppearance } from '../model/usePhoneAppearance'
import { SpatialPhoneModel } from '../spatial/SpatialPhoneModel'
import { WorkspaceGrid } from '../spatial/WorkspaceGrid'
import { WorkspaceLighting } from '../workspace/WorkspaceLighting'
import { DeviceAppearancePicker } from './DeviceAppearancePicker'
import { NativeDialog } from './NativeDialog'
import { QrCodeSvg } from './QrCodeSvg'
import { soundFeedback } from './soundFeedback'
import type { SharedRoomController } from './useSharedRoom'
import { DEFAULT_WEB_PLAY_SETTINGS, WebTrayDriver, type WebPlaySettings } from './webTrayDriver'
import '../spatial/spatial.css'
import '../marble/marble.css'
import './webplay.css'

const DOCK_MODELS: readonly PhoneProfileId[] = [
  'iphone-17-pro',
  'iphone-17-pro-max',
  'iphone-17',
  'iphone-16-pro',
  'iphone-16-pro-max',
  'iphone-16',
  'iphone-16-plus',
  'android-adaptive',
]

interface HudState {
  hitCount: number
  canAddBall: boolean
  region: 'tray' | 'air' | 'needs-ball'
  ballsCount: number
  hasActive: boolean
}

function WebPlayScene({
  driver,
  profile,
  finishId,
  sharedRoom,
  tiltInputRef,
  onHudUpdate,
}: {
  driver: WebTrayDriver
  profile: PhoneProfile
  finishId: PhoneFinishId
  sharedRoom: SharedRoomController
  tiltInputRef: React.RefObject<{ x: number; y: number }>
  onHudUpdate: (hud: HudState) => void
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
      media: { kind: 'texture' as const, name: 'Online Elastic Tray', width: canvas.width, height: canvas.height, texture },
    }
  }, [profile])

  const material = useMemo(() => createClippedMarbleMaterial('#34d888', inverse, slotGeometry, screenBounds), [inverse, slotGeometry, screenBounds])
  const marker = useMemo(() => createClippedMarbleMaterial('#082418', inverse, slotGeometry, screenBounds), [inverse, slotGeometry, screenBounds])
  const trailMaterial = useMemo(() => new MeshStandardMaterial({ color: '#454d5c', roughness: 0.45, metalness: 0.2 }), [])
  const trailMarker = useMemo(() => new MeshStandardMaterial({ color: '#222833', roughness: 0.55 }), [])
  const surfaceRef = useRef(surface)

  useEffect(() => {
    surfaceRef.current = surface
    return () => surface.media.texture.dispose()
  }, [surface])
  useEffect(() => () => {
    material.dispose()
    marker.dispose()
    trailMaterial.dispose()
    trailMarker.dispose()
  }, [material, marker, trailMaterial, trailMarker])

  const lastHudSyncRef = useRef(0)

  useFrame((_, delta) => {
    const peerPose = sharedRoom.paired ? sharedRoom.peerPoseRef.current : null
    if (peerPose) {
      driver.setTargetQuaternion(peerPose)
    } else {
      driver.setTiltInput(tiltInputRef.current.x, tiltInputRef.current.y)
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
      worldId: 'web-play',
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
      geometry: curG,
      phone: snap.phone,
      balls: snap.balls,
      activeBallId: snap.activeBallId,
      lastImpact: snap.lastImpact,
    }
    const display = surfaceRef.current
    drawMarbleScreen(display.context, display.canvas.width, display.canvas.height, drawSnap)
    display.media.texture.needsUpdate = true

    if (sharedRoom.paired) {
      sharedRoom.sendWorldSnapshot({
        phone: snap.phone,
        balls: snap.balls,
        activeBallId: snap.activeBallId,
        hitCount: snap.hitCount,
        lastImpact: snap.lastImpact,
        canAddBall: snap.canAddBall,
        region: snap.region,
        geometry: curG,
        mode: 'marble',
        activeScreenId: 'marble',
      })
    }

    const now = performance.now()
    if (now - lastHudSyncRef.current > 100) {
      lastHudSyncRef.current = now
      onHudUpdate({
        hitCount: snap.hitCount,
        canAddBall: snap.canAddBall,
        region: snap.region,
        ballsCount: snap.balls.length,
        hasActive: snap.activeBallId !== null,
      })
    }
  })

  return (
    <>
      <WorkspaceLighting />
      <WorkspaceGrid />
      <ContactShadows
        frames={1}
        position={[0, 0.001, 0]}
        opacity={isDark ? 0.55 : 0.28}
        scale={1.1}
        blur={2.1}
        far={0.45}
        resolution={256}
        color={isDark ? '#000000' : '#1b2029'}
      />
      <group ref={phone}>
        <SpatialPhoneModel profile={profile} finishId={finishId} media={surface.media} />
      </group>
      {Array.from({ length: 5 }, (_, index) => (
        <group key={index} ref={(group) => { balls.current[index] = group }} visible={false}>
          <group>
            <mesh material={material}><sphereGeometry args={[G.radius, 40, 24]} /></mesh>
            <mesh material={marker} position={[0, 0, G.radius * 0.994]}><sphereGeometry args={[G.radius * 0.13, 16, 12]} /></mesh>
          </group>
          <group>
            <mesh material={trailMaterial}><sphereGeometry args={[G.radius, 24, 16]} /></mesh>
            <mesh material={trailMarker} position={[0, 0, G.radius * 0.994]}><sphereGeometry args={[G.radius * 0.13, 12, 8]} /></mesh>
          </group>
        </group>
      ))}
      <OrbitControls makeDefault target={SPATIAL_START} minDistance={0.14} maxDistance={1.1} />
    </>
  )
}

export function WebPlayWorkspace({
  active = true,
  sharedRoom,
}: {
  active?: boolean
  sharedRoom: SharedRoomController
}) {
  const appearance = usePhoneAppearance()
  const [physicsReady, setPhysicsReady] = useState(false)
  const [physicsError, setPhysicsError] = useState<string | null>(null)
  const [driver, setDriver] = useState<WebTrayDriver | null>(null)
  const initialProfileRef = useRef(appearance.profile)
  const [settings, setSettings] = useState<WebPlaySettings>({ ...DEFAULT_WEB_PLAY_SETTINGS })
  const [muted, setMuted] = useState(false)
  const [viewRev, setViewRev] = useState(0)
  const [qrOpen, setQrOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [hud, setHud] = useState<HudState>({
    hitCount: 0,
    canAddBall: false,
    region: 'tray',
    ballsCount: 1,
    hasActive: true,
  })

  const stageRef = useRef<HTMLElement>(null)
  const tiltInputRef = useRef({ x: 0, y: 0 })
  const [thumbPos, setThumbPos] = useState({ x: 0, y: 0 })
  const padRef = useRef<HTMLDivElement>(null)
  const draggingPadRef = useRef(false)
  const keysPressedRef = useRef(new Set<string>())

  useEffect(() => {
    let cancelled = false
    void initMarblePhysics()
      .then(() => {
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
        setPhysicsReady(true)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setPhysicsError(err instanceof Error ? err.message : 'Failed to initialize physics engine.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return () => {
      driver?.free()
    }
  }, [driver])

  const { applyRemoteDevice } = appearance
  useEffect(() => {
    applyRemoteDevice(sharedRoom.peerDevice)
  }, [applyRemoteDevice, sharedRoom.peerDevice])

  useEffect(() => {
    driver?.setProfile(appearance.profile)
  }, [appearance.profile, driver])

  useEffect(() => {
    if (!driver || !active) return
    return sharedRoom.subscribeMessages((msg) => {
      if (msg.type === 'web-pose' && msg.flickStrength) {
        driver.triggerToss(msg.flickStrength)
      } else if (msg.type === 'web-action') {
        if (msg.action === 'toss') driver.triggerToss(msg.strength ?? 1)
        else if (msg.action === 'add-ball') driver.addBall()
      }
    })
  }, [active, driver, sharedRoom])

  useEffect(() => {
    const onFullscreen = () => {
      if (document.fullscreenElement === stageRef.current) setExpanded(true)
      else setExpanded(false)
    }
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => document.removeEventListener('fullscreenchange', onFullscreen)
  }, [])

  useEffect(() => {
    if (!active || !driver) return
    const syncKeys = () => {
      if (draggingPadRef.current) return
      const keys = keysPressedRef.current
      const x = (keys.has('ArrowRight') || keys.has('KeyD') ? 0.75 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 0.75 : 0)
      const y = (keys.has('ArrowDown') || keys.has('KeyS') ? 0.75 : 0) - (keys.has('ArrowUp') || keys.has('KeyW') ? 0.75 : 0)
      tiltInputRef.current = { x, y }
      setThumbPos({ x, y })
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && settingsOpen) {
        setSettingsOpen(false)
        return
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if (e.code === 'Space') {
        e.preventDefault()
        soundFeedback.unlock()
        driver.triggerToss(1)
        return
      }
      if (e.code === 'KeyB') {
        soundFeedback.unlock()
        driver.addBall()
        return
      }
      if (e.code === 'KeyR') {
        driver.restart(settings)
        return
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyS', 'KeyA', 'KeyD'].includes(e.code)) {
        e.preventDefault()
        keysPressedRef.current.add(e.code)
        syncKeys()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (keysPressedRef.current.delete(e.code)) syncKeys()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [active, driver, settings, settingsOpen])

  const pairUrl = useMemo(() => {
    if (typeof window === 'undefined') return `https://phone3d.popcornnn.xyz/?pair=${sharedRoom.roomCode}`
    const u = new URL(window.location.href)
    u.search = `?pair=${sharedRoom.roomCode}`
    u.hash = ''
    return u.toString()
  }, [sharedRoom.roomCode])

  const updateTiltFromPointer = useCallback((clientX: number, clientY: number) => {
    const pad = padRef.current
    if (!pad) return
    const r = pad.getBoundingClientRect()
    const nx = Math.max(-1, Math.min(1, ((clientX - r.left) / r.width) * 2 - 1))
    const ny = Math.max(-1, Math.min(1, ((clientY - r.top) / r.height) * 2 - 1))
    tiltInputRef.current = { x: nx, y: ny }
    setThumbPos({ x: nx, y: ny })
  }, [])

  const applySetting = useCallback(
    (key: keyof WebPlaySettings, val: number) => {
      const next = { ...settings, [key]: val }
      setSettings(next)
      driver?.restart(next)
    },
    [driver, settings],
  )

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(pairUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* ignore */
    }
  }, [pairUrl])

  const toggleFullscreen = useCallback(async () => {
    if (expanded) {
      if (document.fullscreenElement === stageRef.current) {
        await document.exitFullscreen().catch(() => {})
      }
      setExpanded(false)
    } else {
      setExpanded(true)
      if (document.fullscreenEnabled && stageRef.current?.requestFullscreen) {
        await stageRef.current.requestFullscreen().catch(() => {})
      }
    }
  }, [expanded])

  const statusLabel = sharedRoom.status === 'paired-p2p'
    ? 'Phone Paired · P2P'
    : sharedRoom.status === 'paired-relay'
      ? 'Phone Paired · Relay'
      : sharedRoom.status === 'replaced'
        ? 'Room replaced · Generate new code'
        : 'Solo · Drag pad or Keys'

  return (
    <main ref={stageRef} className={'webplay-stage-shell' + (expanded ? ' is-expanded' : '')} aria-label="Online 3D Elastic Tray">
      <div className="webplay-stage-canvas">
        {physicsReady && driver ? (
          <Canvas
            frameloop={active ? 'always' : 'never'}
            key={viewRev}
            dpr={[1, 2]}
            camera={{ position: [0.175, 0.34, 0.235], fov: 34, near: 0.01, far: 100 }}
            gl={{ antialias: true, alpha: true }}
          >
            <WebPlayScene
              driver={driver}
              profile={appearance.profile}
              finishId={appearance.finishId}
              sharedRoom={sharedRoom}
              tiltInputRef={tiltInputRef}
              onHudUpdate={setHud}
            />
          </Canvas>
        ) : (
          <div className="webplay-stage-loading">
            {physicsError ?? 'Loading 120 Hz Rapier physics…'}
          </div>
        )}
      </div>

      {/* Top-left floating live HUD pill */}
      <div className="webplay-hud-top-left" role="status">
        <span className={'webplay-status-dot' + (sharedRoom.paired ? ' is-paired' : physicsReady ? ' is-ready' : '')} aria-hidden="true" />
        <strong>{hud.hitCount} {hud.hitCount === 1 ? 'catch' : 'catches'}</strong>
        <span className="webplay-hud-sep">·</span>
        <span>{hud.ballsCount}/5 balls</span>
        <span className="webplay-hud-sep webplay-hide-narrow">·</span>
        <span className="webplay-hud-muted webplay-hide-narrow">{statusLabel}</span>
      </div>

      {/* Top-right floating Pair & Settings actions */}
      <div className="webplay-hud-top-right">
        <button
          type="button"
          className={'webplay-glass-pill' + (sharedRoom.paired ? ' is-paired' : '')}
          aria-expanded={qrOpen}
          onClick={() => setQrOpen(true)}
        >
          <span className={'webplay-status-dot' + (sharedRoom.paired ? ' is-paired' : '')} aria-hidden="true" />
          <span>{sharedRoom.paired ? 'Paired' : 'Pair Phone'}</span>
          <code className="webplay-code-chip">{formatRoomCode(sharedRoom.roomCode)}</code>
        </button>
        <button
          type="button"
          className="webplay-glass-pill"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((v) => !v)}
        >
          Settings
        </button>
      </div>

      {/* Collapsible right-side glassmorphic drawer */}
      {settingsOpen && (
        <aside className="webplay-settings-drawer" aria-label="Studio settings">
          <div className="webplay-drawer-head">
            <h2>Studio Settings</h2>
            <button type="button" className="webplay-icon-btn" aria-label="Close settings" onClick={() => setSettingsOpen(false)}>
              ✕
            </button>
          </div>

          <DeviceAppearancePicker compact appearance={appearance} />

          <fieldset className="marble-settings">
            <legend className="visually-hidden">Physics settings</legend>
            <label htmlFor="wp-diameter">
              <span>Ball size<output htmlFor="wp-diameter">{settings.ballDiameterMm} mm</output></span>
              <input
                id="wp-diameter"
                type="range"
                {...MARBLE_SETTING_LIMITS.ballDiameterMm}
                value={settings.ballDiameterMm}
                onChange={(e) => applySetting('ballDiameterMm', Number(e.target.value))}
              />
            </label>
            <label htmlFor="wp-bounce">
              <span>Bounce<output htmlFor="wp-bounce">{settings.restitution.toFixed(2)}</output></span>
              <input
                id="wp-bounce"
                type="range"
                {...MARBLE_SETTING_LIMITS.restitution}
                value={settings.restitution}
                onChange={(e) => applySetting('restitution', Number(e.target.value))}
              />
            </label>
            <label htmlFor="wp-flick">
              <span>Flick boost<output htmlFor="wp-flick">{Math.round(settings.flickPower * 100)}%</output></span>
              <input
                id="wp-flick"
                type="range"
                min={0.6}
                max={1.5}
                step={0.05}
                value={settings.flickPower}
                onChange={(e) => applySetting('flickPower', Number(e.target.value))}
              />
            </label>
            <div className="marble-settings-foot">
              <button
                type="button"
                onClick={() => {
                  setSettings({ ...DEFAULT_WEB_PLAY_SETTINGS })
                  driver?.restart(DEFAULT_WEB_PLAY_SETTINGS)
                }}
              >
                Reset defaults ({DEFAULT_MARBLE_SETTINGS.ballDiameterMm} mm)
              </button>
            </div>
          </fieldset>

          <p className="spatial-hint">
            Orbit stage by dragging outside the pad · <strong>WASD</strong> / Arrows tilt · <strong>Space</strong> toss · <strong>B</strong> add ball · <strong>R</strong> reset.
          </p>
        </aside>
      )}

      {/* Bottom-center floating glass dock */}
      <div className="webplay-dock" role="toolbar" aria-label="Playground controls">
        <div
          ref={padRef}
          className="webplay-mini-pad"
          role="application"
          aria-label="Tilt pad — drag to tilt the 3D phone"
          title="Drag to tilt phone"
          onPointerDown={(e) => {
            soundFeedback.unlock()
            draggingPadRef.current = true
            e.currentTarget.setPointerCapture(e.pointerId)
            updateTiltFromPointer(e.clientX, e.clientY)
          }}
          onPointerMove={(e) => {
            if (!draggingPadRef.current) return
            updateTiltFromPointer(e.clientX, e.clientY)
          }}
          onPointerUp={() => {
            draggingPadRef.current = false
            tiltInputRef.current = { x: 0, y: 0 }
            setThumbPos({ x: 0, y: 0 })
          }}
          onPointerCancel={() => {
            draggingPadRef.current = false
            tiltInputRef.current = { x: 0, y: 0 }
            setThumbPos({ x: 0, y: 0 })
          }}
        >
          <div
            className="webplay-mini-thumb"
            style={{
              transform: `translate(calc(-50% + ${thumbPos.x * 20}px), calc(-50% + ${thumbPos.y * 13}px))`,
            }}
          />
        </div>

        <div className="webplay-dock-group">
          <button
            type="button"
            className="webplay-btn-primary"
            disabled={!driver || !hud.hasActive}
            onClick={() => {
              soundFeedback.unlock()
              driver?.triggerToss(1)
            }}
          >
            Toss
          </button>
          <button
            type="button"
            className={hud.canAddBall ? 'webplay-btn-primary' : ''}
            disabled={!driver || !hud.canAddBall}
            onClick={() => {
              soundFeedback.unlock()
              driver?.addBall()
            }}
          >
            Add ball
          </button>
          <button
            type="button"
            onClick={() => {
              soundFeedback.unlock()
              driver?.restart(settings)
            }}
            disabled={!driver}
          >
            Reset
          </button>
        </div>

        <span className="webplay-dock-divider" aria-hidden="true" />

        <div className="webplay-dock-group">
          <select
            className="webplay-dock-select"
            aria-label="Phone model"
            value={appearance.profileId}
            onChange={(event) => appearance.setProfileId(event.target.value as PhoneProfileId)}
          >
            {DOCK_MODELS.map((id) => (
              <option key={id} value={id}>
                {id === 'android-adaptive' && appearance.detectedDevice?.modelHint
                  ? `Android (${appearance.detectedDevice.modelHint})`
                  : PHONE_PROFILES[id].name}
              </option>
            ))}
          </select>

          <div className="webplay-dock-swatches" role="group" aria-label="Chassis finish">
            {PHONE_FINISHES.map((finish) => {
              const activeSwatch = appearance.finishId === finish.id
              return (
                <button
                  key={finish.id}
                  type="button"
                  className={'device-swatch' + (activeSwatch ? ' is-active' : '')}
                  aria-pressed={activeSwatch}
                  aria-label={finish.label}
                  title={finish.label}
                  style={{ backgroundColor: finish.swatch }}
                  onClick={() => appearance.setFinishId(finish.id)}
                />
              )
            })}
          </div>
        </div>

        <span className="webplay-dock-divider webplay-hide-narrow" aria-hidden="true" />

        <div className="webplay-dock-group webplay-hide-narrow">
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
          <button type="button" onClick={() => setViewRev((n) => n + 1)}>
            Reset view
          </button>
          <button type="button" aria-pressed={expanded} onClick={() => void toggleFullscreen()}>
            {expanded ? 'Exit' : 'Expand'}
          </button>
        </div>
      </div>

      <NativeDialog open={qrOpen} title="Pair with your phone" onClose={() => setQrOpen(false)}>
        <p>Scan with your iPhone or Android camera to drive the 3D phone live and auto-match your hardware shell.</p>
        <div className="webplay-dialog-qr">
          <QrCodeSvg value={pairUrl} size={200} label="Large QR pairing code" />
          <div className="webplay-room-code">{formatRoomCode(sharedRoom.roomCode)}</div>
        </div>
        <div className="webplay-dialog-actions">
          <button type="button" onClick={() => void handleCopyLink()}>
            {copied ? 'Copied link' : 'Copy URL'}
          </button>
          <button type="button" onClick={sharedRoom.regenerateRoom}>
            New code
          </button>
          <button type="button" autoFocus onClick={() => setQrOpen(false)}>
            Done
          </button>
        </div>
      </NativeDialog>
    </main>
  )
}
