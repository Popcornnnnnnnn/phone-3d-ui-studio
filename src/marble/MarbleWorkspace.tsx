import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { CanvasTexture, Matrix4, MeshStandardMaterial, Quaternion, SRGBColorSpace, Vector2, Vector3, type Group } from 'three'
import { IPhone17Model } from '../scene/IPhone17Model'
import { SPATIAL_MODEL_SCALE, SPATIAL_START } from '../../shared/spatialMath.mjs'
import { MARBLE_GEOMETRY as G } from '../../shared/marbleMath.mjs'
import { DEFAULT_MARBLE_SETTINGS, MARBLE_SETTING_LIMITS, type MarbleSettings } from '../../shared/marbleSettings.mjs'
import { useMarbleWorld } from './useMarbleWorld'
import { drawMarbleScreen } from './drawMarbleScreen'
import type { WorldClient } from './WorldClient'
import { SpatialViewport } from '../spatial/SpatialViewport'
import { WorkspaceGrid } from '../spatial/WorkspaceGrid'
import '../spatial/spatial.css'
import './marble.css'

function clippedMaterial(color: string, inverse: Matrix4, slotGeometry: Vector2) {
  const material = new MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.05 })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.inversePhone = { value: inverse }
    shader.uniforms.slotGeometry = { value: slotGeometry }
    shader.vertexShader = 'uniform mat4 inversePhone; varying vec3 phoneFragment;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nphoneFragment = (inversePhone * modelMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader = 'uniform vec2 slotGeometry; varying vec3 phoneFragment;\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      vec2 delta = abs(phoneFragment.xy) - vec2(${G.width / 2 - G.cornerRadius}, ${G.height / 2 - G.cornerRadius});
      float edgeDistance = length(max(delta, 0.0)) + min(max(delta.x, delta.y), 0.0) - ${G.cornerRadius};
      if (edgeDistance <= 0.0 && phoneFragment.z >= ${G.screenZ} - slotGeometry.x && phoneFragment.z < ${G.screenZ}) discard;`)
  }
  material.customProgramCacheKey = () => 'marble-finite-slot-variable-radius-v2'
  return material
}
function MarbleScene({ client }: { client: WorldClient }) {
  const phone = useRef<Group>(null), balls = useRef<Array<Group | null>>([])
  const inverse = useMemo(() => new Matrix4(), [])
  const slotGeometry = useMemo(() => new Vector2(G.radius, 0), [])
  const surface = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 402; canvas.height = 874
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace
    return { canvas, context: canvas.getContext('2d')!, media: { kind: 'texture' as const, name: 'Shared marble', width: 402, height: 874, texture } }
  }, [])
  const material = useMemo(() => clippedMaterial('#a4df83', inverse, slotGeometry), [inverse, slotGeometry])
  const marker = useMemo(() => clippedMaterial('#264b39', inverse, slotGeometry), [inverse, slotGeometry])
  const trailMaterial = useMemo(() => new MeshStandardMaterial({ color: '#9eafa0', roughness: 0.75 }), [])
  const trailMarker = useMemo(() => new MeshStandardMaterial({ color: '#647969', roughness: 0.75 }), [])
  const surfaceRef = useRef(surface)
  useEffect(() => () => { surface.media.texture.dispose(); material.dispose(); marker.dispose(); trailMaterial.dispose(); trailMarker.dispose() }, [surface, material, marker, trailMaterial, trailMarker])
  useFrame(() => {
    const state = client.render()
    slotGeometry.setX(state?.geometry.radius ?? G.radius)
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
    drawMarbleScreen(surfaceRef.current.context, 402, 874, state); surfaceRef.current.media.texture.needsUpdate = true
  }, -1)
  return <>
    <ambientLight intensity={1.3} /><hemisphereLight args={['#fff', '#a6b49d', 1.4]} />
    <directionalLight position={[1, 2, 1]} intensity={3} />
    <WorkspaceGrid />
    <mesh position={[0, -0.026, 0]}><boxGeometry args={[1.2, 0.05, 1.2]} /><meshStandardMaterial color="#e3e8db" roughness={0.9} /></mesh>
    <group ref={phone}>
      <group scale={SPATIAL_MODEL_SCALE}><IPhone17Model externallyDriven animate={false} view="front" orientation="portrait" screenMedia={surface.media} /></group>
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
    <OrbitControls makeDefault target={SPATIAL_START} minDistance={0.08} />
  </>
}
export function MarbleWorkspace() {
  const client = useMarbleWorld(), s = client.latest
  const [view, resetView] = useState(0)
  const [draft, setDraft] = useState<MarbleSettings | null>(null)
  const applied = s?.settings ?? DEFAULT_MARBLE_SETTINGS
  const settings = draft ?? applied
  const changed = (Object.keys(DEFAULT_MARBLE_SETTINGS) as Array<keyof MarbleSettings>).some((key) => settings[key] !== applied[key])
  const observing = s?.phase === 'running' && !client.isOwner
  const canStart = !!s?.canStart && client.connected && !observing
  const start = () => client.command('start', settings)
  const running = s?.phase === 'running' && !client.needsRestart && client.connected
  const title = !client.connected ? 'Connecting' : client.needsRestart ? 'Paused' : ({ waiting: 'Waiting for iPhone', unsupported: 'Update iPhone app', ready: 'Ready to begin', running: !s?.activeBallId ? 'Add a new ball' : s?.region === 'air' ? 'Catch the ball' : 'Tray live', paused: 'Paused' }[s?.phase ?? 'waiting'])
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(client.report())], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = 'phone3d-marble-telemetry.json'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }
  return <main className="spatial-workspace marble-workspace">
    <header className="spatial-header"><div><p className="spatial-eyebrow">Spatial interaction / S2.1</p><h1>A little bounce. A real connection.</h1><p>Gently toss. Move to catch. Add a ball from your phone.</p></div><span className={'spatial-status ' + (running ? 'is-live' : '')} role="status">{title}</span></header>
    <div className="spatial-layout">
      <SpatialViewport label="Shared marble workspace" onReset={() => resetView((n) => n + 1)} controls={<>
        <span className="spatial-fullscreen-status" role="status">{title}</span>
        <button disabled={!canStart} onClick={start}>{changed && s?.active ? 'Apply & restart' : s?.active ? 'Restart round' : 'Start round'}</button>
        <button disabled={!running || !client.isOwner} onClick={() => client.command('pause')}>Pause</button>
        <span>{s?.hitCount ?? 0} contacts</span>
      </>}>
        <Canvas key={view} dpr={[1, 2]} camera={{ position: [0.4, 0.49, 0.54], fov: 42, near: 0.01, far: 2000 }} gl={{ antialias: true }} onCreated={({ gl }) => gl.setClearColor('#f0f2eb')}><MarbleScene client={client} /></Canvas>
        <div className="spatial-canvas-label">Slow demo · gravity 1.5 m/s² · 10 cm grid nearby</div>
        {!running && <div className="spatial-paused-label">{s?.active ? 'World frozen · start a new round to continue' : 'Start round to place the marble in your phone'}</div>}
      </SpatialViewport>
      <aside className="spatial-panel">
        <p className="spatial-eyebrow">Toss / Catch / Add</p><h2>{title}</h2>
        {s?.source === 'fixture' && <p className="spatial-hint">Synthetic test input — no physical device.</p>}
        <p className="spatial-guidance">{client.message}</p>
        <fieldset className="marble-settings" disabled={observing}>
          <legend>Play settings</legend>
          {([
            ['movementScale', 'Movement scale', `${Math.round(settings.movementScale * 100)}%`],
            ['ballDiameterMm', 'Ball diameter', `${settings.ballDiameterMm} mm`],
            ['restitution', 'Bounce', settings.restitution.toFixed(2)],
          ] as const).map(([key, label, value]) => <label key={key} htmlFor={`marble-${key}`}>
            <span>{label}<output htmlFor={`marble-${key}`}>{value}</output></span>
            <input id={`marble-${key}`} type="range" {...MARBLE_SETTING_LIMITS[key]} value={settings[key]}
              onChange={(event) => setDraft({ ...settings, [key]: Number(event.target.value) })} />
          </label>)}
          <p className="spatial-hint">Real 20 cm → virtual {Number((20 * settings.movementScale).toFixed(1))} cm. Rotation stays 1:1.</p>
          <button type="button" onClick={() => setDraft({ ...DEFAULT_MARBLE_SETTINGS })}>Restore defaults</button>
        </fieldset>
        <p className="spatial-hint" role="status">{changed ? 'Changes pending. Apply to recalibrate and start a new round; existing balls will be cleared.' : 'Settings apply when starting a round. The phone and Web share the same values.'}</p>
        <button className="spatial-primary" disabled={!canStart} onClick={start}>
          {!s?.active ? 'Start round' : !client.isOwner && s.phase !== 'running' ? 'Take control & restart' : changed ? 'Apply & restart' : 'Recalibrate & restart'}</button>
        <p className="spatial-hint">Screen up, top toward the Mac. Keep the rear camera above a textured surface. Starting a round sets a new origin.</p>
        <div className="marble-actions"><button disabled={!running || !client.isOwner} onClick={() => client.command('pause')}>Pause</button></div>
        <ol className="marble-instructions"><li>Gently lift and lower the phone to toss the ball.</li><li>Move the tray under the ball to catch it.</li><li>If it lands, tap Add ball on your phone.</li></ol><p className="spatial-hint">One playable ball. Up to five balls leave a trail on the ground. Connect both devices to the same local network to play without USB.</p>
        <div className="marble-catches"><strong>{s?.hitCount ?? 0}</strong><span>contacts this round</span></div>
        {s?.ownerId && !client.isOwner && <p className="spatial-hint">Observing another page’s round.</p>}
        <details className="spatial-details"><summary>World details</summary><dl>
          <dt>Round / snapshot</dt><dd>{s ? `${s.epoch} / ${s.sequence}` : '—'}</dd>
          <dt>Ball XYZ / m</dt><dd>{s?.balls.find((b) => b.id === s.activeBallId)?.position.map((x) => x.toFixed(3)).join(', ') ?? '—'}</dd>
          <dt>Phone XYZ / m</dt><dd>{s?.phone?.position.map((x) => x.toFixed(3)).join(', ') ?? '—'}</dd>
          <dt>Balls retained</dt><dd>{s?.balls.length ?? 0} / 5</dd><dt>Active ball identity</dt><dd>{s?.activeBallId ?? '—'}</dd>
          <dt>Applied settings</dt><dd>{Math.round(applied.movementScale * 100)}% movement · {applied.ballDiameterMm} mm · bounce {applied.restitution.toFixed(2)}</dd>
          <dt>Presentation</dt><dd>50 ms shared buffer · no prediction</dd>
        </dl><button onClick={() => client.recording ? download() : client.startRecording()}>{client.recording ? 'Stop & download telemetry' : 'Record numeric telemetry'}</button>
        {client.droppedRecords > 0 && <p role="status">Recording full; {client.droppedRecords} later records were not saved.</p>}
        <p>Numeric state only. Software timestamps are not visible latency. Body offset remains approximate.</p></details>
      </aside>
    </div><footer className="spatial-footer">S2.1 prototype · wireless acceptance pending<span>One object · server-owned physics</span></footer>
  </main>
}
