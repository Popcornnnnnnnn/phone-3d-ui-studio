import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { CanvasTexture, Matrix4, MeshStandardMaterial, Quaternion, SRGBColorSpace, Vector3, type Group, type Mesh } from 'three'
import { IPhone17Model } from '../scene/IPhone17Model'
import { SPATIAL_MODEL_SCALE, SPATIAL_START } from '../../shared/spatialMath.mjs'
import { MARBLE_GEOMETRY as G } from '../../shared/marbleMath.mjs'
import { useMarbleWorld } from './useMarbleWorld'
import { drawMarbleScreen } from './drawMarbleScreen'
import type { WorldClient } from './WorldClient'
import { SpatialViewport } from '../spatial/SpatialViewport'
import { WorkspaceGrid } from '../spatial/WorkspaceGrid'
import '../spatial/spatial.css'
import './marble.css'

function clippedMaterial(color: string, inverse: Matrix4) {
  const material = new MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.05 })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.inversePhone = { value: inverse }
    shader.vertexShader = 'uniform mat4 inversePhone; varying vec3 phoneFragment;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nphoneFragment = (inversePhone * modelMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader = 'varying vec3 phoneFragment;\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      vec2 delta = abs(phoneFragment.xy) - vec2(${G.width / 2 - G.cornerRadius}, ${G.height / 2 - G.cornerRadius});
      float edgeDistance = length(max(delta, 0.0)) + min(max(delta.x, delta.y), 0.0) - ${G.cornerRadius};
      if (edgeDistance <= 0.0 && phoneFragment.z < ${G.screenZ}) discard;`)
  }
  material.customProgramCacheKey = () => 'marble-complementary-screen-clip-v1'
  return material
}
function MarbleScene({ client }: { client: WorldClient }) {
  const phone = useRef<Group>(null), ball = useRef<Group>(null), ring = useRef<Mesh>(null)
  const inverse = useMemo(() => new Matrix4(), [])
  const surface = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 402; canvas.height = 874
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace
    return { canvas, context: canvas.getContext('2d')!, media: { kind: 'texture' as const, name: 'Shared marble', width: 402, height: 874, texture } }
  }, [])
  const material = useMemo(() => clippedMaterial('#a4df83', inverse), [inverse])
  const marker = useMemo(() => clippedMaterial('#264b39', inverse), [inverse])
  const surfaceRef = useRef(surface)
  useEffect(() => () => { surface.media.texture.dispose(); material.dispose(); marker.dispose() }, [surface, material, marker])
  useFrame(() => {
    const state = client.render()
    const transform = state?.phone ?? { position: SPATIAL_START, quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const }
    phone.current?.position.set(...transform.position); phone.current?.quaternion.set(...transform.quaternion)
    inverse.compose(new Vector3(...transform.position), new Quaternion(...transform.quaternion), new Vector3(1, 1, 1)).invert()
    if (ball.current) {
      ball.current.visible = !!state?.ball
      if (state?.ball) { ball.current.position.set(...state.ball.position); ball.current.quaternion.set(...state.ball.quaternion) }
    }
    if (ring.current) { ring.current.visible = !!state?.active && state.region !== 'phone'; if (state) ring.current.position.set(...state.catchTarget) }
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
    <group ref={ball} visible={false}>
      <mesh material={material}><sphereGeometry args={[G.radius, 40, 24]} /></mesh>
      <mesh material={marker} position={[0, 0, G.radius * 0.994]}><sphereGeometry args={[G.radius * 0.13, 16, 12]} /></mesh>
    </group>
    <mesh ref={ring} visible={false} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.025, 0.028, 48]} /><meshBasicMaterial color="#3a9971" transparent opacity={0.5} side={2} depthWrite={false} />
    </mesh>
    <OrbitControls makeDefault target={SPATIAL_START} minDistance={0.08} />
  </>
}
export function MarbleWorkspace() {
  const client = useMarbleWorld(), s = client.latest
  const [view, resetView] = useState(0)
  const running = s?.phase === 'running' && !client.needsRestart && client.connected
  const title = !client.connected ? 'Connecting' : client.needsRestart ? 'Paused' : ({ waiting: 'Waiting for iPhone', unsupported: 'S2 app required', ready: 'Ready to begin', running: s?.region === 'returning' ? 'Catch the marble' : s?.canReturn ? 'Ready to return' : 'Marble live', paused: 'Paused', lost: 'Reset the marble' }[s?.phase ?? 'waiting'])
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(client.report())], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = 'phone3d-marble-telemetry.json'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }
  return <main className="spatial-workspace marble-workspace">
    <header className="spatial-header"><div><p className="spatial-eyebrow">Spatial interaction / S2</p><h1>One marble. Two worlds.</h1><p>Tilt to pour. Return to catch. The same marble, all the way.</p></div><span className={'spatial-status ' + (running ? 'is-live' : '')} role="status">{title}</span></header>
    <div className="spatial-layout">
      <SpatialViewport label="Shared marble workspace" onReset={() => resetView((n) => n + 1)} controls={<>
        <span className="spatial-fullscreen-status" role="status">{title}</span>
        <button disabled={!s?.canStart || !client.connected || (running && !client.isOwner)} onClick={() => client.command('start')}>{s?.active ? 'Restart round' : 'Start round'}</button>
        <button disabled={!running || !client.isOwner || !s?.canReturn} onClick={() => client.command('return')}>Return</button>
        <button disabled={!client.isOwner || !s?.canStart || !client.connected || !['running', 'lost'].includes(s.phase)} onClick={() => client.command('reset')}>Reset ball</button>
        <button disabled={!running || !client.isOwner} onClick={() => client.command('pause')}>Pause</button>
        <span>{s?.catchCount ?? 0} catches</span>
      </>}>
        <Canvas key={view} dpr={[1, 2]} camera={{ position: [0.4, 0.49, 0.54], fov: 42, near: 0.01, far: 2000 }} gl={{ antialias: true }} onCreated={({ gl }) => gl.setClearColor('#f0f2eb')}><MarbleScene client={client} /></Canvas>
        <div className="spatial-canvas-label">Slow demo · gravity 1.5 m/s² · 10 cm grid nearby</div>
        {!running && <div className="spatial-paused-label">{s?.active ? 'World frozen · start a new round to continue' : 'Start round to place the marble in your phone'}</div>}
      </SpatialViewport>
      <aside className="spatial-panel">
        <p className="spatial-eyebrow">Pour / Return / Catch</p><h2>{title}</h2>
        {s?.source === 'fixture' && <p className="spatial-hint">Synthetic test input — no physical device.</p>}
        <p className="spatial-guidance">{client.message}</p>
        <button className="spatial-primary" disabled={!s?.canStart || !client.connected || (running && !client.isOwner)} onClick={() => client.command('start')}>
          {!s?.active ? 'Start round' : !client.isOwner && s.phase !== 'running' ? 'Take control & restart' : 'Recalibrate & restart'}</button>
        <p className="spatial-hint">Screen up, top toward the Mac. Keep the rear camera above a textured surface. Starting a round sets a new origin.</p>
        <div className="marble-actions"><button disabled={!running || !client.isOwner || !s?.canReturn} onClick={() => client.command('return')}>Return</button><button disabled={!client.isOwner || !client.connected || !s?.canStart || !['running', 'lost'].includes(s.phase)} onClick={() => client.command('reset')}>Reset ball</button><button disabled={!running || !client.isOwner} onClick={() => client.command('pause')}>Pause</button></div>
        <ol className="marble-instructions"><li>Tilt the right edge down to pour.</li><li>Let the marble settle, then click Return.</li><li>Move your phone into the marked catch zone.</li></ol>
        <div className="marble-catches"><strong>{s?.catchCount ?? 0}</strong><span>catches this round</span></div>
        {s?.ownerId && !client.isOwner && <p className="spatial-hint">Observing another page’s round.</p>}
        <details className="spatial-details"><summary>World details</summary><dl>
          <dt>Round / snapshot</dt><dd>{s ? `${s.epoch} / ${s.sequence}` : '—'}</dd>
          <dt>Ball XYZ / m</dt><dd>{s?.ball?.position.map((x) => x.toFixed(3)).join(', ') ?? '—'}</dd>
          <dt>Phone XYZ / m</dt><dd>{s?.phone?.position.map((x) => x.toFixed(3)).join(', ') ?? '—'}</dd>
          <dt>Ball identity</dt><dd>{s?.ball?.id ?? '—'}</dd>
          <dt>Presentation</dt><dd>50 ms shared buffer · no prediction</dd>
        </dl><button onClick={() => client.recording ? download() : client.startRecording()}>{client.recording ? 'Stop & download telemetry' : 'Record numeric telemetry'}</button>
        {client.droppedRecords > 0 && <p role="status">Recording full; {client.droppedRecords} later records were not saved.</p>}
        <p>Numeric state only. Software timestamps are not visible latency. Body offset remains approximate.</p></details>
      </aside>
    </div><footer className="spatial-footer">S2 prototype · formal physical acceptance pending<span>One object · server-owned physics</span></footer>
  </main>
}
