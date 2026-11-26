import { WorkspaceConnection, WorkspaceInspector, WorkspaceStatus } from '../workspace/WorkspaceUI'
import { WorkspaceLighting } from '../workspace/WorkspaceLighting'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { ContactShadows, OrbitControls } from '@react-three/drei'
import { CanvasTexture, Matrix4, MeshStandardMaterial, Quaternion, SRGBColorSpace, Vector2, Vector3, type Group } from 'three'
import { SpatialPhoneModel } from '../spatial/SpatialPhoneModel'
import { SPATIAL_START } from '../../shared/spatialMath.mjs'
import { phoneProfile, phoneProfileNotice } from '../../shared/phoneGeometry.mjs'
import { MARBLE_GEOMETRY as G } from '../../shared/marbleMath.mjs'
import { DEFAULT_MARBLE_SETTINGS, MARBLE_SETTING_LIMITS, type MarbleSettings } from '../../shared/marbleSettings.mjs'
import { useMarbleWorld } from './useMarbleWorld'
import { drawMarbleScreen } from './drawMarbleScreen'
import type { WorldClient } from './WorldClient'
import { SpatialViewport } from '../spatial/SpatialViewport'
import { WorkspaceGrid } from '../spatial/WorkspaceGrid'
import '../spatial/spatial.css'
import './marble.css'

function clippedMaterial(color: string, inverse: Matrix4, slotGeometry: Vector2, screenBounds: Vector3) {
  const material = new MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.05 })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.inversePhone = { value: inverse }
    shader.uniforms.slotGeometry = { value: slotGeometry }
    shader.uniforms.screenBounds = { value: screenBounds }
    shader.vertexShader = 'uniform mat4 inversePhone; varying vec3 phoneFragment;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nphoneFragment = (inversePhone * modelMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader = 'uniform vec2 slotGeometry; uniform vec3 screenBounds; varying vec3 phoneFragment;\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      vec2 delta = abs(phoneFragment.xy) - screenBounds.xy;
      float edgeDistance = length(max(delta, 0.0)) + min(max(delta.x, delta.y), 0.0) - screenBounds.z;
      if (edgeDistance <= 0.0 && phoneFragment.z >= slotGeometry.y - slotGeometry.x && phoneFragment.z < slotGeometry.y) discard;`)
  }
  material.customProgramCacheKey = () => 'marble-finite-slot-device-profile-v2'
  return material
}
function MarbleScene({ client, preview }: { client: WorldClient; preview: boolean }) {
  const phone = useRef<Group>(null), balls = useRef<Array<Group | null>>([])
  const inverse = useMemo(() => new Matrix4(), [])
  const profile = phoneProfile(client.latest?.deviceProfile?.profileId)
  const slotGeometry = useMemo(() => new Vector2(G.radius, G.screenZ), [])
  const screenBounds = useMemo(() => new Vector3(G.width / 2 - G.cornerRadius, G.height / 2 - G.cornerRadius, G.cornerRadius), [])
  const surface = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = profile.displayPixels.width / 3; canvas.height = profile.displayPixels.height / 3
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace
    return { canvas, context: canvas.getContext('2d')!, media: { kind: 'texture' as const, name: 'Shared marble', width: canvas.width, height: canvas.height, texture } }
  }, [profile])
  const material = useMemo(() => clippedMaterial('#a4df83', inverse, slotGeometry, screenBounds), [inverse, slotGeometry, screenBounds])
  const marker = useMemo(() => clippedMaterial('#264b39', inverse, slotGeometry, screenBounds), [inverse, slotGeometry, screenBounds])
  const trailMaterial = useMemo(() => new MeshStandardMaterial({ color: '#9eafa0', roughness: 0.75 }), [])
  const trailMarker = useMemo(() => new MeshStandardMaterial({ color: '#647969', roughness: 0.75 }), [])
  const surfaceRef = useRef(surface)
  useEffect(() => { surfaceRef.current = surface; return () => surface.media.texture.dispose() }, [surface])
  useEffect(() => () => { material.dispose(); marker.dispose(); trailMaterial.dispose(); trailMarker.dispose() }, [material, marker, trailMaterial, trailMarker])
  useFrame(() => {
    const state = preview ? null : client.render()
    const geometry = state?.geometry ?? G
    slotGeometry.set(geometry.radius, geometry.screenZ)
    screenBounds.set(geometry.width / 2 - geometry.cornerRadius, geometry.height / 2 - geometry.cornerRadius, geometry.cornerRadius)
    const transform = state?.phone ?? { position: SPATIAL_START, quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const }
    phone.current?.position.set(...transform.position); phone.current?.quaternion.set(...transform.quaternion)
    inverse.compose(new Vector3(...transform.position), new Quaternion(...transform.quaternion), new Vector3(1, 1, 1)).invert()
    balls.current.forEach((group, index) => {
      if (!group) return
      const body = state?.balls[index]
      group.visible = !!body
      if (!body) return
      group.position.set(...body.position); group.quaternion.set(...body.quaternion)
      group.scale.setScalar(body.radius / G.radius)
      group.children[0].visible = body.state === 'active'
      group.children[1].visible = body.state !== 'active'
    })
    const display = surfaceRef.current
    drawMarbleScreen(display.context, display.canvas.width, display.canvas.height, state); display.media.texture.needsUpdate = true
  }, -1)
  return <>
    <WorkspaceLighting />
    {!preview && <WorkspaceGrid />}
    {preview && <ContactShadows frames={1} position={[0, 0.15, 0]} opacity={0.28} scale={0.8} blur={2.8} far={0.2} resolution={256} color="#303747" />}
    <group ref={phone}>
      <SpatialPhoneModel profile={profile} media={surface.media} />
      {preview && <mesh position={[0, 0.008, G.screenZ + G.radius]}>
        <sphereGeometry args={[G.radius, 40, 24]} /><meshStandardMaterial color="#b4ec8b" roughness={0.24} metalness={0.12} />
      </mesh>}
    </group>
    {Array.from({ length: 5 }, (_, index) => <group key={index} ref={(group) => { balls.current[index] = group }} visible={false}>
      <group>
        <mesh material={material}><sphereGeometry args={[G.radius, 40, 24]} /></mesh>
        <mesh material={marker} position={[0, 0, G.radius * 0.994]}><sphereGeometry args={[G.radius * 0.13, 16, 12]} /></mesh>
      </group>
      <group>
        <mesh material={trailMaterial}><sphereGeometry args={[G.radius, 24, 16]} /></mesh>
        <mesh material={trailMarker} position={[0, 0, G.radius * 0.994]}><sphereGeometry args={[G.radius * 0.13, 12, 8]} /></mesh>
      </group>
    </group>)}
    <OrbitControls makeDefault target={preview ? [0, 0.18, 0] : SPATIAL_START} minDistance={0.08} />
  </>
}
export function MarbleWorkspace({ active = true }: { active?: boolean }) {
  const client = useMarbleWorld(active), s = client.latest
  const [view, resetView] = useState(0)
  const [draft, setDraft] = useState<MarbleSettings | null>(null)
  const applied = s?.settings ?? DEFAULT_MARBLE_SETTINGS
  const settings = draft ?? applied
  const changed = (Object.keys(DEFAULT_MARBLE_SETTINGS) as Array<keyof MarbleSettings>).some((key) => settings[key] !== applied[key])
  const observing = s?.phase === 'running' && !client.isOwner
  const canStart = !!s?.canStart && client.connected && !observing
  const start = () => client.command('start', settings)
  const running = s?.phase === 'running' && !client.needsRestart && client.connected
  // Preserve a frozen round on disconnect. A preview is only shown before a phone or round exists.
  const preview = !s?.phoneSessionId && !s?.active
  const title = !client.connected ? 'Reconnecting' : client.needsRestart ? 'Paused' : ({ waiting: s?.phoneSessionId ? 'iPhone connected · waiting for tracking' : 'Waiting for iPhone', unsupported: 'Update iPhone app', ready: 'Ready to play', running: !s?.activeBallId ? 'Add a new ball' : s?.region === 'air' ? 'Catch the ball' : 'Round in progress', paused: 'Paused' }[s?.phase ?? 'waiting'])
  const nextStep = !client.connected ? 'Wait for the local session to reconnect.'
    : !s?.phoneSessionId ? 'On iPhone, open Tracking and tap Start tracking.'
    : s.phase === 'unsupported' ? 'Update the iPhone app, then start Tracking again.'
    : s.phase === 'waiting' ? 'Keep the iPhone in the foreground until tracking is normal.'
    : s.phase === 'ready' ? 'Hold the iPhone flat, then choose Start round on this Mac.'
    : s.phase === 'paused' || client.needsRestart ? canStart
      ? 'Tracking ready again. Hold the iPhone flat, then restart the round to recalibrate and clear old balls.'
      : 'Restore normal tracking, then start a new round on this Mac. This recalibrates and clears old balls.'
    : !client.isOwner ? 'Another page controls this round. Watch here or wait until its round ends.'
    : 'Move the iPhone to toss and catch. Pause on this Mac when needed.'
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(client.report())], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = 'phone3d-marble-telemetry.json'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }
  return <main className={'workspace-shell marble-workspace' + (preview ? ' is-preview' : '')}>
    <div className="workspace-content">
      <SpatialViewport label={preview ? 'Marble preview — no device connected' : 'Shared marble workspace'} onReset={() => resetView((n) => n + 1)} controls={!preview && <>
        <span className="spatial-fullscreen-status" role="status">{title}</span>
        <button disabled={!canStart} onClick={start}>{changed && s?.active ? 'Apply & restart' : s?.active ? 'Restart round' : 'Start round'}</button>
        <button disabled={!running || !client.isOwner} onClick={() => client.command('pause')}>Pause</button>
        <span>{s?.hitCount ?? 0} contacts</span>
      </>}>
        <Canvas frameloop={active ? 'always' : 'never'} key={`${view}-${preview}`} dpr={[1, 2]} camera={{ position: preview ? [0.135, 0.425, 0.225] : [0.24, 0.43, 0.32], fov: 36, near: 0.01, far: 2000 }} gl={{ antialias: true, alpha: true }}><MarbleScene client={client} preview={preview} /></Canvas>
        <WorkspaceStatus live={running}>{preview ? 'Preview' : title}</WorkspaceStatus>
        {!preview && !running && <div className="spatial-paused-label">{nextStep}</div>}
      </SpatialViewport>
      <WorkspaceInspector title="Marble" description="Toss and catch in a shared space.">
          {preview ? <>
            <WorkspaceConnection description="iPhone Tracking powers Marble on this Mac." status={client.connected ? 'Waiting for iPhone' : 'Connecting to local session'} nextStep={nextStep} />
            <section className="workspace-section"><h2>How to play</h2>
              <ol className="workspace-steps">
                <li><strong>Hold your phone flat</strong><p>Screen up, top toward your Mac. Keep the rear camera above a textured surface.</p></li>
                <li><strong>Start a round</strong><p>A marble appears in your phone. Lift gently to toss it.</p></li>
                <li><strong>Move to catch</strong><p>Keep your phone under the marble. Add another after it lands.</p></li>
              </ol>
            </section>
            {!client.connected && <p className="workspace-notice" role="status">{s ? client.message : 'Connecting to the local session…'}</p>}
          </> : <>
            <div className="marble-session-heading"><p className="spatial-eyebrow">{s?.source === 'fixture' ? 'Test session' : 'Round'}</p><span>{s?.hitCount ?? 0} contacts</span></div>
            <h2>{title}</h2>
            <p className="spatial-guidance">{client.message}</p>
            <p className="spatial-hint" role="status">Next: {nextStep}</p>
            {s?.source === 'fixture' && <p className="workspace-notice">Synthetic input · no physical iPhone</p>}
            <div className="marble-round-actions"><button className="spatial-primary" disabled={!canStart} onClick={start}>
              {!s?.active ? 'Start round' : !client.isOwner && s.phase !== 'running' ? 'Take control & restart' : changed ? 'Apply & restart' : 'Restart round'}</button>
              {running && <button disabled={!client.isOwner} onClick={() => client.command('pause')}>Pause</button>}
            </div>
            {s?.active && <p className="spatial-hint">Restarting sets a new origin and clears the current balls.</p>}
            {s?.ownerId && !client.isOwner && <p className="spatial-hint">Observing another page’s round.</p>}
            <details className="workspace-disclosure" open><summary>Play settings</summary>
              <fieldset className="marble-settings" disabled={observing}><legend className="visually-hidden">Play settings</legend>
                {([
                  ['movementScale', 'Movement', `${Math.round(settings.movementScale * 100)}%`],
                  ['ballDiameterMm', 'Ball size', `${settings.ballDiameterMm} mm`],
                  ['restitution', 'Bounce', settings.restitution.toFixed(2)],
                ] as const).map(([key, label, value]) => <label key={key} htmlFor={`marble-${key}`}>
                  <span>{label}<output htmlFor={`marble-${key}`}>{value}</output></span>
                  <input id={`marble-${key}`} type="range" {...MARBLE_SETTING_LIMITS[key]} value={settings[key]}
                    onChange={(event) => setDraft({ ...settings, [key]: Number(event.target.value) })} />
                </label>)}
                <div className="marble-settings-foot"><span>20 cm → {Number((20 * settings.movementScale).toFixed(1))} cm</span><button type="button" onClick={() => setDraft({ ...DEFAULT_MARBLE_SETTINGS })}>Reset</button></div>
              </fieldset>
              {changed && <p className="spatial-hint" role="status">Restart to apply changes, recalibrate, and clear the current balls.</p>}
            </details>
            <details className="workspace-disclosure"><summary>How to play</summary>
              <ol className="marble-instructions"><li>Gently lift and lower the phone to toss.</li><li>Move the tray under the ball to catch it.</li><li>Tap Add ball on your iPhone after it lands.</li></ol>
              <p className="spatial-hint">Screen up, top toward your Mac. Starting a round sets a new origin. One playable ball, with up to five on the ground. Rotation stays 1:1.</p>
            </details>
            <details className="workspace-disclosure spatial-details"><summary>Device & world details</summary>
              {s?.phoneSessionId && s.deviceProfile && <p>{phoneProfileNotice(s.deviceProfile)} Camera offset and visual shell are approximate.</p>}
              <dl><dt>Round / snapshot</dt><dd>{s ? `${s.epoch} / ${s.sequence}` : '—'}</dd>
                <dt>Ball XYZ / m</dt><dd>{s?.balls.find((b) => b.id === s.activeBallId)?.position.map((x) => x.toFixed(3)).join(', ') ?? '—'}</dd>
                <dt>Phone XYZ / m</dt><dd>{s?.phone?.position.map((x) => x.toFixed(3)).join(', ') ?? '—'}</dd>
                <dt>Balls retained</dt><dd>{s?.balls.length ?? 0} / 5</dd><dt>Active ball identity</dt><dd>{s?.activeBallId ?? '—'}</dd>
                <dt>Applied settings</dt><dd>{Math.round(applied.movementScale * 100)}% movement · {applied.ballDiameterMm} mm · bounce {applied.restitution.toFixed(2)}</dd>
                <dt>Presentation</dt><dd>50 ms shared buffer · no prediction</dd>
              </dl><button onClick={() => client.recording ? download() : client.startRecording()}>{client.recording ? 'Stop & download telemetry' : 'Record numeric telemetry'}</button>
              {client.droppedRecords > 0 && <p role="status">Recording full; {client.droppedRecords} later records were not saved.</p>}
              <p>Numeric state only. Software timestamps are not visible latency. Body offset remains approximate.</p>
            </details>
          </>}
        <p className="workspace-footnote">Prototype · physical validation pending</p>
      </WorkspaceInspector>
    </div>
  </main>
}
