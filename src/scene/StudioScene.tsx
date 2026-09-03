import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Vector3 } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import {
  TABLETOP_PHONE_CENTER_Y,
  type ReviewView,
  type ScreenOrientation,
} from '../model/iphone17'
import type { PoseSample } from '../studio/contracts'
import type { StudioPreset } from '../studio/presets'
import type { ScreenMedia } from '../studio/screenMedia'
import type { LiveFrameRenderSignal } from '../studio/useLivePhoneSource'
import { IPhone17Model } from './IPhone17Model'
import { StudioEnvironment } from './StudioEnvironment'

interface StudioSceneProps {
  preset: StudioPreset
  animate: boolean
  ambientMotion: boolean
  showGrid: boolean
  showAxes: boolean
  view: ReviewView
  orientation: ScreenOrientation
  screenMedia: ScreenMedia | null
  livePoseRef?: RefObject<PoseSample | null>
  liveFrameRenderRef?: RefObject<LiveFrameRenderSignal | null>
  onLiveFrameRendered?: (frameId: number, renderedAtMs: number) => void
  cameraResetRevision?: number
  useTabletopStandard?: boolean
}

function LiveFrameRenderObserver({
  signalRef,
  onRendered,
}: {
  signalRef: RefObject<LiveFrameRenderSignal | null>
  onRendered: (frameId: number, renderedAtMs: number) => void
}) {
  const submittedFrameIdRef = useRef<number | null>(null)

  useFrame(() => {
    const signal = signalRef.current
    if (!signal || signal.frameId === submittedFrameIdRef.current) return
    submittedFrameIdRef.current = signal.frameId
    window.requestAnimationFrame(() => onRendered(signal.frameId, Date.now()))
  })

  return null
}

interface CameraSetup {
  position: [number, number, number]
  target: [number, number, number]
}

const uprightCameraSetups: Record<ReviewView, CameraSetup> = {
  calibration: { position: [0, 0.1, 5.4], target: [0, 0.05, 0] },
  hero: { position: [2.8, 1.5, 5.2], target: [0, 0.05, 0] },
  front: { position: [0, 0.1, 5.4], target: [0, 0.05, 0] },
  back: { position: [0, 0.1, -5.4], target: [0, 0.05, 0] },
}

function cameraSetup(view: ReviewView, useTabletopStandard: boolean): CameraSetup {
  if (!useTabletopStandard) return uprightCameraSetups[view]

  const target: [number, number, number] = [0, TABLETOP_PHONE_CENTER_Y, 0]
  const tabletopSetups: Record<ReviewView, CameraSetup> = {
    calibration: {
      position: [0, TABLETOP_PHONE_CENTER_Y, 5.4],
      target,
    },
    hero: {
      position: [2.9, TABLETOP_PHONE_CENTER_Y + 2.35, 4.75],
      target,
    },
    front: {
      position: [0, TABLETOP_PHONE_CENTER_Y + 5.55, 0.001],
      target,
    },
    back: {
      position: [0, TABLETOP_PHONE_CENTER_Y - 5.55, 0.001],
      target,
    },
  }

  return tabletopSetups[view]
}

function ReviewCamera({
  view,
  resetRevision,
  useTabletopStandard,
  controlsRef,
}: {
  view: ReviewView
  resetRevision: number
  useTabletopStandard: boolean
  controlsRef: RefObject<OrbitControlsImpl | null>
}) {
  const camera = useThree((state) => state.camera)
  const transition = useRef({
    active: false,
    elapsed: 0,
    fromPosition: new Vector3(),
    toPosition: new Vector3(),
    fromTarget: new Vector3(),
    toTarget: new Vector3(),
    currentTarget: new Vector3(),
  })

  useEffect(() => {
    const setup = cameraSetup(view, useTabletopStandard)
    const state = transition.current
    state.active = true
    state.elapsed = 0
    state.fromPosition.copy(camera.position)
    state.toPosition.set(...setup.position)
    state.fromTarget.copy(controlsRef.current?.target ?? state.currentTarget)
    state.toTarget.set(...setup.target)
  }, [camera, controlsRef, resetRevision, useTabletopStandard, view])

  useFrame((_, delta) => {
    const state = transition.current
    if (!state.active) return

    state.elapsed += delta
    const progress = Math.min(state.elapsed / 0.45, 1)
    const eased = 1 - Math.pow(1 - progress, 3)
    camera.position.lerpVectors(state.fromPosition, state.toPosition, eased)
    state.currentTarget.lerpVectors(state.fromTarget, state.toTarget, eased)
    camera.lookAt(state.currentTarget)
    if (controlsRef.current) {
      controlsRef.current.target.copy(state.currentTarget)
      controlsRef.current.update()
    }
    if (progress === 1) {
      camera.position.copy(state.toPosition)
      state.currentTarget.copy(state.toTarget)
      camera.lookAt(state.toTarget)
      controlsRef.current?.target.copy(state.toTarget)
      controlsRef.current?.update()
      state.active = false
    }
  })

  return null
}

export function StudioScene({
  preset,
  animate,
  ambientMotion,
  showGrid,
  showAxes,
  view,
  orientation,
  screenMedia,
  livePoseRef,
  liveFrameRenderRef,
  onLiveFrameRendered,
  cameraResetRevision = 0,
  useTabletopStandard = false,
}: StudioSceneProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const [initialCamera] = useState(() => cameraSetup(view, useTabletopStandard))
  const orbitEnabled = view === 'calibration' || view === 'hero'

  return (
    <Canvas
      shadows="basic"
      dpr={[1, 2]}
      camera={{ position: initialCamera.position, fov: 34, near: 0.1, far: 100 }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
    >
      <StudioEnvironment
        preset={preset}
        ambientMotion={ambientMotion}
        showGrid={showGrid}
        showAxes={showAxes}
        showShadows={view === 'hero' || view === 'front'}
      />
      <hemisphereLight
        color={preset.keyColor}
        groundColor={preset.backgroundBottom}
        intensity={0.8}
      />
      <ambientLight intensity={0.46} />
      <rectAreaLight
        color={preset.keyColor}
        height={5.2}
        intensity={preset.keyLight}
        position={[0.6, 5.5, 1.4]}
        rotation={[-Math.PI / 2, 0, 0]}
        width={4.8}
      />
      <rectAreaLight
        color={preset.fillColor}
        height={3.8}
        intensity={preset.fillLight}
        position={[-2.8, 0.8, 4.8]}
        rotation={[0, 0, 0]}
        width={2.6}
      />
      <directionalLight
        color={preset.rimColor}
        intensity={1.05}
        position={[3.8, 3.2, -3.6]}
      />
      {view === 'calibration' && useTabletopStandard && (
        <rectAreaLight
          color={preset.fillColor}
          height={1.5}
          intensity={1.55}
          position={[0, TABLETOP_PHONE_CENTER_Y + 0.34, 3.8]}
          rotation={[0, 0, 0]}
          width={4.4}
        />
      )}
      {view === 'back' && useTabletopStandard && (
        <rectAreaLight
          color={preset.keyColor}
          height={5.4}
          intensity={2.2}
          position={[0, TABLETOP_PHONE_CENTER_Y - 4.2, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          width={3.6}
        />
      )}
      <ReviewCamera
        controlsRef={controlsRef}
        resetRevision={cameraResetRevision}
        useTabletopStandard={useTabletopStandard}
        view={view}
      />
      {liveFrameRenderRef && onLiveFrameRendered && (
        <LiveFrameRenderObserver
          signalRef={liveFrameRenderRef}
          onRendered={onLiveFrameRendered}
        />
      )}
      <IPhone17Model
        animate={animate}
        view={view}
        orientation={orientation}
        screenMedia={screenMedia}
        livePoseRef={livePoseRef}
        useTabletopStandard={useTabletopStandard}
      />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enabled={orbitEnabled}
        enablePan={false}
        minDistance={3.1}
        maxDistance={7.5}
        minPolarAngle={0.32}
        maxPolarAngle={2.82}
        target={initialCamera.target}
      />
    </Canvas>
  )
}
