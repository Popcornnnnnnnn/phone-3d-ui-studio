import { WorkspaceConnection, WorkspaceInspector, WorkspaceStatus } from '../workspace/WorkspaceUI'
import { WorkspaceLighting } from '../workspace/WorkspaceLighting'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BufferAttribute, BufferGeometry, CanvasTexture, Line, LineBasicMaterial, SRGBColorSpace, type Group } from 'three'
import { SpatialPhoneModel } from './SpatialPhoneModel'
import { phoneProfileNotice } from '../../shared/phoneGeometry.mjs'
import type { TextureScreenMedia } from '../studio/screenMedia'
import { SPATIAL_START, type SpatialTracker } from './spatialTracking'
import { useSpatialTracking } from './useSpatialTracking'
import { SpatialViewport } from './SpatialViewport'
import { WorkspaceGrid } from './WorkspaceGrid'
import './spatial.css'

function SpatialPhone({ tracker }: { tracker: SpatialTracker }) {
  const group = useRef<Group>(null)
  const profile = tracker.profile
  const media = useMemo<TextureScreenMedia>(() => {
    const canvas = document.createElement('canvas')
    canvas.width = profile.displayPixels.width / 3; canvas.height = profile.displayPixels.height / 3
    const context = canvas.getContext('2d')!
    context.scale(canvas.width / 402, canvas.height / 874)
    const background = context.createLinearGradient(0, 0, 402, 874)
    background.addColorStop(0, '#252a34'); background.addColorStop(0.55, '#181d26'); background.addColorStop(1, '#11151c')
    context.fillStyle = background; context.fillRect(0, 0, 402, 874)
    context.textAlign = 'center'
    context.fillStyle = '#a4aebc'; context.font = '600 18px system-ui'; context.fillText('TOP', 201, 130)
    context.fillStyle = '#eef1f5'; context.font = '500 34px system-ui'; context.fillText('Tracking', 201, 432)
    context.fillStyle = '#9ea8b7'; context.font = '17px system-ui'; context.fillText('Position & orientation', 201, 466)
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    return { kind: 'texture', name: 'Spatial direction reference', width: canvas.width, height: canvas.height, texture }
  }, [profile])
  useEffect(() => () => media.texture.dispose(), [media])
  useFrame(() => {
    const pose = tracker.render()
    group.current?.position.set(...pose.position)
    group.current?.quaternion.set(...pose.quaternion)
  }, -1)
  return <group ref={group} position={SPATIAL_START}>
    <SpatialPhoneModel profile={profile} media={media} />
  </group>
}

const TRAIL_HOLD_MS = 2_500

function PositionTrail({ tracker }: { tracker: SpatialTracker }) {
  const trail = useRef<{ points: number[][]; sequence: number; revision: number; lastTrackingAtMs: number }>({
    points: [], sequence: -1, revision: -1, lastTrackingAtMs: 0,
  })
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
    const now = performance.now()
    if (tracker.phase !== 'tracking') {
      if (t.points.length > 0 && now - t.lastTrackingAtMs >= TRAIL_HOLD_MS) {
        t.points = []; t.sequence = -1
        geometry.setDrawRange(0, 0)
      }
      return
    }
    if (t.revision !== tracker.revision) {
      t.points = []; t.revision = tracker.revision; t.sequence = -1
      geometry.setDrawRange(0, 0)
    }
    t.lastTrackingAtMs = now
    if (t.sequence === tracker.sequence) return
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

export function SpatialWorkspace({ active = true }: { active?: boolean }) {
  const tracker = useSpatialTracking(active)
  const [cameraRevision, resetCamera] = useState(0)
  const live = tracker.phase === 'tracking'
  const preview = !tracker.sessionId
  const nextStep = tracker.phase === 'connecting' ? 'Wait for the local session to connect.'
    : preview ? 'On iPhone, open Tracking and tap Start tracking.'
    : tracker.phase === 'initializing' ? 'Keep the iPhone open and move slowly above a textured surface.'
    : tracker.phase === 'calibrate' ? 'Hold the iPhone flat, then choose Set origin on this Mac.'
    : tracker.phase === 'tracking' ? 'Move the iPhone to explore its position and orientation.'
    : 'Restore normal tracking, then choose Set origin again.'
  const relative = tracker.rendered.position.map((value, axis) => value - SPATIAL_START[axis])
  function downloadRecording() {
    const report = tracker.report()
    const url = URL.createObjectURL(new Blob([JSON.stringify(report)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = 'phone3d-spatial-telemetry.json'; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }
  return <main className="workspace-shell tracking-workspace">
    <div className="workspace-content">
      <SpatialViewport label="Spatial phone workspace" onReset={() => resetCamera((v) => v + 1)} controls={<>
        <span className="spatial-fullscreen-status" role="status">{labels[tracker.phase]}</span>
        <button disabled={!tracker.isFresh()} onClick={() => tracker.setOrigin()}>Set origin</button>
      </>}>
        <Canvas frameloop={active ? 'always' : 'never'} key={cameraRevision} dpr={[1, 2]} camera={{ position: [0.135, 0.425, 0.225], fov: 36, near: 0.01, far: 2000 }}
          gl={{ antialias: true, alpha: true }}>
          <WorkspaceLighting />
          {!preview && <><WorkspaceGrid /><axesHelper args={[0.1]} position={SPATIAL_START} /></>}
          <SpatialPhone tracker={tracker} />
          <PositionTrail tracker={tracker} />
          <OrbitControls makeDefault target={[0, 0.18, 0]} minDistance={0.08} />
        </Canvas>
        <WorkspaceStatus live={live}>{preview ? 'Preview' : labels[tracker.phase]}</WorkspaceStatus>
        {!preview && !live && <div className="spatial-paused-label">{nextStep}</div>}
      </SpatialViewport>
      <WorkspaceInspector title="Tracking" description="Explore position and orientation.">
        {preview ? <WorkspaceConnection description="iPhone Tracking powers this view and Marble on your Mac." status={labels[tracker.phase]} nextStep={nextStep} /> : <section className="workspace-section workspace-session">
          <h2>{labels[tracker.phase]}</h2>
          {tracker.source === 'fixture' && <p className="workspace-notice">Synthetic test input · no physical device</p>}
          <p className="spatial-guidance">{tracker.reason}</p>
          <p className="spatial-hint" role="status">Next: {nextStep}</p>
          <button className="workspace-primary" disabled={!tracker.isFresh()} onClick={() => tracker.setOrigin()}>Set origin</button>
        </section>}
        <section className="workspace-section"><h2>Position</h2>
        <div className="spatial-position" aria-label="Relative phone position" data-rendered-position={vector(tracker.rendered.position)}>
          {['X', 'Y', 'Z'].map((axis, i) => <div key={axis}><span>{axis}</span><strong>{preview ? '—' : relative[i].toFixed(3)}</strong><small>m</small></div>)}
        </div>
        <p className="spatial-hint">Relative to the origin you set.</p></section>
        <details className="workspace-disclosure"><summary>Setup guide</summary><p>Hold your phone screen up, top toward your Mac. Keep the rear camera above a textured surface, then set the origin.</p><p>The initial 20 cm height is a display reference, not a measured tabletop.</p></details>
        <details className="workspace-disclosure spatial-details">
          <summary>Device & tracking details</summary>
          {tracker.sessionId && <p>{phoneProfileNotice(tracker.deviceProfile)} Camera offset and visual shell are approximate.</p>}
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
          {tracker.droppedRecords > 0 && <p role="status">Recording full. Stop and download; {tracker.droppedRecords.toLocaleString()} later records were not saved.</p>}
          <p>No camera images or phone screens are recorded.</p>
        </details>
        <p className="workspace-footnote">Prototype · physical validation pending</p>
      </WorkspaceInspector>
    </div>
  </main>
}
