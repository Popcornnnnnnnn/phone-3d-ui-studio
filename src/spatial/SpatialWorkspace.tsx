import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BufferAttribute, BufferGeometry, CanvasTexture, Line, LineBasicMaterial, SRGBColorSpace, type Group } from 'three'
import { IPhone17Model } from '../scene/IPhone17Model'
import type { TextureScreenMedia } from '../studio/screenMedia'
import { SPATIAL_MODEL_SCALE, SPATIAL_START, type SpatialTracker } from './spatialTracking'
import { useSpatialTracking } from './useSpatialTracking'
import './spatial.css'

function SpatialPhone({ tracker }: { tracker: SpatialTracker }) {
  const group = useRef<Group>(null)
  const media = useMemo<TextureScreenMedia>(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 402; canvas.height = 874
    const context = canvas.getContext('2d')!
    context.fillStyle = '#112c2b'; context.fillRect(0, 0, canvas.width, canvas.height)
    context.textAlign = 'center'
    context.fillStyle = '#9ae4c1'; context.font = '600 30px system-ui'; context.fillText('TOP', 201, 130)
    context.fillStyle = '#f2f7ee'; context.font = '500 48px system-ui'; context.fillText('Spatial', 201, 432)
    context.font = '24px system-ui'; context.fillText('6DoF · S1', 201, 480)
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    return { kind: 'texture', name: 'Spatial direction reference', width: 402, height: 874, texture }
  }, [])
  useEffect(() => () => media.texture.dispose(), [media])
  useFrame(() => {
    const pose = tracker.render()
    group.current?.position.set(...pose.position)
    group.current?.quaternion.set(...pose.quaternion)
  }, -1)
  return <group ref={group} position={SPATIAL_START} scale={SPATIAL_MODEL_SCALE}>
    <IPhone17Model externallyDriven animate={false} view="front" orientation="portrait" screenMedia={media} />
  </group>
}

function PositionTrail({ tracker }: { tracker: SpatialTracker }) {
  const trail = useRef<{ points: number[][]; sequence: number; revision: number }>({ points: [], sequence: -1, revision: -1 })
  const geometry = useMemo(() => {
    const value = new BufferGeometry()
    value.setAttribute('position', new BufferAttribute(new Float32Array(600 * 3), 3))
    value.setDrawRange(0, 0)
    return value
  }, [])
  const line = useMemo(() => {
    const value = new Line(geometry, new LineBasicMaterial({ color: '#218878', transparent: true, opacity: 0.6 }))
    value.frustumCulled = false
    return value
  }, [geometry])
  useEffect(() => () => { geometry.dispose(); line.material.dispose() }, [geometry, line])
  useFrame(() => {
    const t = trail.current
    if (t.revision !== tracker.revision) {
      t.points = []; t.revision = tracker.revision; t.sequence = -1
      geometry.setDrawRange(0, 0)
    }
    if (tracker.phase !== 'tracking' || t.sequence === tracker.sequence) return
    t.sequence = tracker.sequence
    t.points.push([...tracker.rendered.position])
    if (t.points.length > 600) t.points.shift()
    const attribute = geometry.getAttribute('position') as BufferAttribute
    t.points.forEach((p, i) => attribute.setXYZ(i, p[0], p[1], p[2]))
    attribute.needsUpdate = true
    geometry.setDrawRange(0, t.points.length)
  })
  return <primitive object={line} />
}

const labels = {
  connecting: 'Connecting', disconnected: 'Waiting for iPhone', initializing: 'Starting tracking',
  calibrate: 'Ready to set origin', tracking: 'Tracking live', limited: 'Tracking limited',
  stale: 'Tracking paused', error: 'Needs attention',
}
const vector = (values: readonly number[]) => values.map((v) => v.toFixed(3)).join(', ')

export function SpatialWorkspace() {
  const tracker = useSpatialTracking()
  const [cameraRevision, resetCamera] = useState(0)
  const live = tracker.phase === 'tracking'
  const relative = tracker.rendered.position.map((value, axis) => value - SPATIAL_START[axis])
  function downloadRecording() {
    const report = tracker.report()
    const url = URL.createObjectURL(new Blob([JSON.stringify(report)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = 'phone3d-spatial-telemetry.json'; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }
  return <main className="spatial-workspace">
    <header className="spatial-header">
      <div><p className="spatial-eyebrow">Spatial interaction / S1</p>
        <h1>Your phone, in space.</h1>
        <p>Move the real phone. Explore its position in a shared workspace.</p></div>
      <span className={'spatial-status ' + (live ? 'is-live' : '')} role="status">{labels[tracker.phase]}</span>
    </header>
    <div className="spatial-layout">
      <section className="spatial-viewport" aria-label="Spatial phone workspace">
        <Canvas key={cameraRevision} dpr={[1, 2]} camera={{ position: [0.48, 0.52, 0.62], fov: 42, near: 0.01, far: 20 }}
          gl={{ antialias: true }} onCreated={({ gl }) => gl.setClearColor('#f0f2eb')}>
          <ambientLight intensity={1.4} />
          <hemisphereLight args={['#ffffff', '#c2c7b4', 1.4]} />
          <directionalLight position={[1, 2, 1]} intensity={3} />
          <directionalLight position={[-1, 0.8, -1]} intensity={2} />
          <gridHelper args={[2, 20, '#9ba99e', '#d0d8cc']} />
          <axesHelper args={[0.1]} position={SPATIAL_START} />
          <SpatialPhone tracker={tracker} />
          <PositionTrail tracker={tracker} />
          <OrbitControls target={SPATIAL_START} minDistance={0.18} maxDistance={3} />
        </Canvas>
        <div className="spatial-canvas-label">10 cm grid · relative workspace</div>
        {!live && <div className="spatial-paused-label">{tracker.renderedAtMs === null ? 'Reference view · set origin to move' : 'Position frozen · restore tracking and set origin'}</div>}
        <button className="spatial-reset" onClick={() => resetCamera((v) => v + 1)}>Reset view</button>
      </section>
      <aside className="spatial-panel">
        <p className="spatial-eyebrow">01 / Connect & calibrate</p>
        <h2>{labels[tracker.phase]}</h2>
        {tracker.source === 'fixture' && <p className="spatial-hint">Synthetic test input — no physical device.</p>}
        <p className="spatial-guidance">{tracker.reason}</p>
        <button className="spatial-primary" disabled={!tracker.isFresh()} onClick={() => tracker.setOrigin()}>Set origin</button>
        <p className="spatial-hint">Hold the phone above a textured desk, screen up, top toward the Mac. Keep the rear camera clear.</p>
        <div className="spatial-position" aria-label="Relative phone position" data-rendered-position={vector(tracker.rendered.position)}>
          {['X', 'Y', 'Z'].map((axis, i) => <div key={axis}><span>{axis}</span><strong>{relative[i].toFixed(3)}</strong><small>m</small></div>)}
        </div>
        <p className="spatial-hint">Position relative to your origin. The starting height of 20 cm is a display reference, not a measured tabletop.</p>
        <details className="spatial-details">
          <summary>Tracking details</summary>
          <dl>
            <dt>Sequence</dt><dd>{tracker.sequence < 0 ? '—' : tracker.sequence}</dd>
            <dt>Raw camera XYZ / m</dt><dd>{tracker.latest ? vector(tracker.latest.positionMeters) : '—'}</dd>
            <dt>Rendered body XYZ / m</dt><dd>{vector(tracker.rendered.position)}</dd>
            <dt>Rendered quaternion</dt><dd>{vector(tracker.rendered.quaternion)}</dd>
            <dt>Sample age</dt><dd>{tracker.sampleAge() === null ? 'Unavailable — clock not verified' : tracker.sampleAge()!.toFixed(1) + ' ms'}</dd>
            <dt>Render submission</dt><dd>{tracker.renderedAtMs === null ? '—' : tracker.renderedAtMs.toFixed(0) + ' ms'}</dd>
          </dl>
          <p>Body offset uses approximate model geometry. Timing describes software submission, not visible latency.</p>
          <button onClick={() => tracker.recording ? downloadRecording() : tracker.startRecording()}>
            {tracker.recording ? 'Stop & download telemetry' : 'Record numeric telemetry'}
          </button>
          <p>No camera images or phone screens are recorded.</p>
        </details>
      </aside>
    </div>
    <footer className="spatial-footer">S1 · Position & orientation validation <span>Next: one marble crossing the screen boundary.</span></footer>
  </main>
}
