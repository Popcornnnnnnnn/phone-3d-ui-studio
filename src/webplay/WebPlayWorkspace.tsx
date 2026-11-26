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
import { type PhoneFinishId, type PhoneProfile } from '../../shared/phoneGeometry.mjs'
import { SPATIAL_START } from '../../shared/spatialMath.mjs'
import { WORLD_VERSION, type WorldSnapshot } from '../../shared/worldProtocol.mjs'
import { formatRoomCode } from '../../shared/webPlayProtocol.mjs'
import { drawMarbleScreen } from '../marble/drawMarbleScreen'
import { usePhoneAppearance } from '../model/usePhoneAppearance'
import { SpatialPhoneModel } from '../spatial/SpatialPhoneModel'
import { SpatialViewport } from '../spatial/SpatialViewport'
import { WorkspaceGrid } from '../spatial/WorkspaceGrid'
import { WorkspaceLighting } from '../workspace/WorkspaceLighting'
import { WorkspaceInspector, WorkspaceStatus } from '../workspace/WorkspaceUI'
import { DeviceAppearancePicker } from './DeviceAppearancePicker'
import { NativeDialog } from './NativeDialog'
import { QrCodeSvg } from './QrCodeSvg'
import { soundFeedback } from './soundFeedback'
import type { SharedRoomController } from './useSharedRoom'
import { DEFAULT_WEB_PLAY_SETTINGS, WebTrayDriver, type WebPlaySettings } from './webTrayDriver'
import '../spatial/spatial.css'
import '../marble/marble.css'
import './webplay.css'

function clippedMaterial(color: string, inverse: Matrix4, slotGeometry: Vector2, screenBounds: Vector3) {
  const material = new MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.05 })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.inversePhone = { value: inverse }
    shader.uniforms.slotGeometry = { value: slotGeometry }
    shader.uniforms.screenBounds = { value: screenBounds }
    shader.vertexShader = 'uniform mat4 inversePhone; varying vec3 phoneFragment;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\nphoneFragment = (inversePhone * modelMatrix * vec4(transformed, 1.0)).xyz;',
    )
    shader.fragmentShader = 'uniform vec2 slotGeometry; uniform vec3 screenBounds; varying vec3 phoneFragment;\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>
      vec2 delta = abs(phoneFragment.xy) - screenBounds.xy;
      float edgeDistance = length(max(delta, 0.0)) + min(max(delta.x, delta.y), 0.0) - screenBounds.z;
      if (edgeDistance <= 0.0 && phoneFragment.z >= slotGeometry.y - slotGeometry.x && phoneFragment.z < slotGeometry.y) discard;`,
    )
  }
  material.customProgramCacheKey = () => 'marble-finite-slot-device-profile-v2'
  return material
}

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
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(240, Math.round(profile.displayPixels.width / 3))
    canvas.height = Math.max(480, Math.round(profile.displayPixels.height / 3))
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    return {
      canvas,
      context: canvas.getContext('2d')!,
      media: { kind: 'texture' as const, name: 'Online Elastic Tray', width: canvas.width, height: canvas.height, texture },
    }
  }, [profile.displayPixels.height, profile.displayPixels.width])

  const material = useMemo(() => clippedMaterial('#a4df83', inverse, slotGeometry, screenBounds), [inverse, slotGeometry, screenBounds])
  const marker = useMemo(() => clippedMaterial('#264b39', inverse, slotGeometry, screenBounds), [inverse, slotGeometry, screenBounds])
  const trailMaterial = useMemo(() => new MeshStandardMaterial({ color: '#9eafa0', roughness: 0.75 }), [])
  const trailMarker = useMemo(() => new MeshStandardMaterial({ color: '#647969', roughness: 0.75 }), [])
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
      <ContactShadows frames={1} position={[0, 0.001, 0]} opacity={0.22} scale={1.2} blur={2.4} far={0.4} resolution={256} color="#303747" />
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
  const [copied, setCopied] = useState(false)
  const [hud, setHud] = useState<HudState>({
    hitCount: 0,
    canAddBall: false,
    region: 'tray',
    ballsCount: 1,
    hasActive: true,
  })

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
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyS'].includes(e.code)) {
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
  }, [active, driver, settings])

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

  const statusText = sharedRoom.status === 'paired-p2p'
    ? 'Phone paired · Direct P2P'
    : sharedRoom.status === 'paired-relay'
      ? 'Phone paired · Relay'
      : sharedRoom.status === 'unavailable'
        ? 'Desktop solo · Pairing offline'
        : 'Desktop playable · Scan QR to pair'

  const pairBadgeText = sharedRoom.status === 'paired-p2p'
    ? 'Direct P2P'
    : sharedRoom.status === 'paired-relay'
      ? 'Cloud Relay'
      : sharedRoom.status === 'unavailable'
        ? 'Relay Offline'
        : 'Waiting'

  return (
    <main className="workspace-shell marble-workspace">
      <div className="workspace-content">
        <SpatialViewport
          label="Online 3D Elastic Tray"
          onReset={() => setViewRev((n) => n + 1)}
          controls={
            <>
              <span className="spatial-fullscreen-status" role="status">{hud.hitCount} catches</span>
              <button
                type="button"
                onClick={() => { soundFeedback.unlock(); driver?.triggerToss(1) }}
                disabled={!driver || !hud.hasActive}
              >
                Toss (Space)
              </button>
              <button
                type="button"
                onClick={() => { soundFeedback.unlock(); driver?.addBall() }}
                disabled={!driver || !hud.canAddBall}
              >
                Add ball (B)
              </button>
              <button type="button" onClick={() => driver?.restart(settings)} disabled={!driver}>
                Reset
              </button>
            </>
          }
        >
          {physicsReady && driver ? (
            <Canvas
              frameloop={active ? 'always' : 'never'}
              key={viewRev}
              dpr={[1, 2]}
              camera={{ position: [0.22, 0.42, 0.29], fov: 36, near: 0.01, far: 100 }}
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
            <div style={{ display: 'grid', placeItems: 'center', height: '100%', fontSize: 13, color: 'var(--text-secondary)' }}>
              {physicsError ?? 'Loading 120 Hz Rapier physics…'}
            </div>
          )}
          <WorkspaceStatus live={sharedRoom.paired || physicsReady}>{statusText}</WorkspaceStatus>
        </SpatialViewport>

        <WorkspaceInspector title="Elastic Tray" description="Toss, tilt, and catch in your browser — or pair your real phone.">
          <section className="webplay-pair-card" aria-label="Phone pairing">
            <div className="webplay-pair-header">
              <h2>Play with your phone</h2>
              <span className={'webplay-badge' + (sharedRoom.paired ? ' is-paired' : '')}>{pairBadgeText}</span>
            </div>
            <div className="webplay-qr-row">
              <button
                type="button"
                className="webplay-qr-button"
                onClick={() => setQrOpen(true)}
                aria-label="Enlarge pairing QR code"
                title="Enlarge QR code"
              >
                <QrCodeSvg value={pairUrl} size={92} />
              </button>
              <div className="webplay-pair-meta">
                <div className="webplay-room-code">{formatRoomCode(sharedRoom.roomCode)}</div>
                <p style={{ margin: 0, fontSize: 11 }}>
                  {sharedRoom.paired
                    ? 'Tilt your phone to roll, flick upward to toss.'
                    : sharedRoom.status === 'unavailable'
                      ? 'WebSocket relay unavailable on static preview; use Desktop controls below.'
                      : 'Scan with your phone camera (iOS or Android).'}
                </p>
                <div className="webplay-pair-actions">
                  <button type="button" onClick={() => void handleCopyLink()}>
                    {copied ? 'Copied!' : 'Copy link'}
                  </button>
                  <button type="button" onClick={() => setQrOpen(true)}>
                    Zoom QR
                  </button>
                  <button type="button" onClick={sharedRoom.regenerateRoom}>
                    New code
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="workspace-section">
            <div className="marble-session-heading" style={{ marginTop: 0 }}>
              <p className="spatial-eyebrow">Active session</p>
              <span>{hud.hitCount} catches · {hud.ballsCount}/5 balls</span>
            </div>
            <div className="webplay-tilt-pad-wrap">
              <div
                ref={padRef}
                className="webplay-tilt-pad"
                role="application"
                aria-label="Tilt pad — drag to tilt the 3D phone"
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
                  className="webplay-tilt-thumb"
                  style={{
                    transform: `translate(calc(-50% + ${thumbPos.x * 48}px), calc(-50% + ${thumbPos.y * 42}px))`,
                  }}
                />
              </div>
              <div className="webplay-quick-actions">
                <button
                  type="button"
                  className="spatial-primary"
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
                  className={hud.canAddBall ? 'spatial-primary' : ''}
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
              <p className="spatial-hint">
                Drag pad or use Arrow keys to tilt · <strong>Space</strong> to toss · <strong>B</strong> to add ball · <strong>R</strong> to reset.
              </p>
            </div>
          </section>

          <details className="workspace-disclosure" open>
            <summary>Play settings</summary>
            <DeviceAppearancePicker appearance={appearance} />
            <fieldset className="marble-settings">
              <legend className="visually-hidden">Play settings</legend>
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
                    const next = !muted
                    setMuted(next)
                    soundFeedback.setMuted(next)
                  }}
                >
                  {muted ? 'Sound: Off' : 'Sound: On'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSettings({ ...DEFAULT_WEB_PLAY_SETTINGS })
                    driver?.restart(DEFAULT_WEB_PLAY_SETTINGS)
                  }}
                >
                  Defaults ({DEFAULT_MARBLE_SETTINGS.ballDiameterMm} mm)
                </button>
              </div>
            </fieldset>
          </details>
        </WorkspaceInspector>
      </div>

      <NativeDialog open={qrOpen} title="Scan with your phone" onClose={() => setQrOpen(false)}>
        <p>Open your phone camera and scan this code to control the 3D iPhone and toss marbles live in your browser.</p>
        <div className="webplay-dialog-qr">
          <QrCodeSvg value={pairUrl} size={210} label="Large QR pairing code" />
          <div className="webplay-room-code">{formatRoomCode(sharedRoom.roomCode)}</div>
        </div>
        <div className="webplay-dialog-actions">
          <button type="button" onClick={() => void handleCopyLink()}>
            {copied ? 'Copied link' : 'Copy URL'}
          </button>
          <button type="button" autoFocus onClick={() => setQrOpen(false)}>
            Close
          </button>
        </div>
      </NativeDialog>
    </main>
  )
}
