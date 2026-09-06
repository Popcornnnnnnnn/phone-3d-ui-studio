import { OrbitControls, OrthographicCamera } from '@react-three/drei'
import {
  Canvas,
  addAfterEffect,
  flushGlobalEffects,
  useFrame,
  useThree,
} from '@react-three/fiber'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { OrthographicCamera as ThreeOrthographicCamera, Vector3 } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import {
  TABLETOP_PHONE_CENTER_Y,
  TABLETOP_PHONE_MOTION_CENTER_Y,
  groundedTabletopPhoneCenterY,
  type ReviewView,
  type ScreenOrientation,
} from '../model/iphone17'
import type { PoseSample } from '../studio/contracts'
import type { QuaternionTuple } from '../studio/liveProtocol'
import {
  highResolutionEpochNowMs,
  type PoseRenderMeasurementSample,
} from '../studio/liveMeasurement'
import type { StudioPreset } from '../studio/presets'
import type { StudioRenderConfiguration } from '../studio/renderConfiguration'
import type { ScreenMedia } from '../studio/screenMedia'
import type {
  LiveFrameRenderSignal,
  LivePoseKinematics,
  PoseRenderDiagnostics,
} from '../studio/useLivePhoneSource'
import { phoneCenterFollowStep } from './cameraFollow'
import { IPhone17Model } from './IPhone17Model'
import {
  createLiveFrameRenderSubmissionTracker,
  liveFrameSignalMatchesCommittedTexture,
} from './liveFrameRenderSubmission'
import type { LiveRenderScheduler } from './liveRenderScheduler'
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
  livePoseKinematicsRef?: RefObject<LivePoseKinematics | null>
  livePoseSmoothingRate?: number
  onRenderedPoseChange?: (quaternion: QuaternionTuple) => void
  onPoseRenderDiagnostics?: (diagnostics: PoseRenderDiagnostics) => void
  onPoseRenderSample?: (sample: PoseRenderMeasurementSample) => void
  liveFrameRenderRef?: RefObject<LiveFrameRenderSignal | null>
  /**
   * Receives a CPU-side R3F after-render submission timestamp. This is not a
   * compositor presentation timestamp or a measurement of photon time.
   */
  onLiveFrameRendered?: (
    frameId: number,
    schedulerGeneration: number,
    renderRequestedAtMs: number,
    r3fFrameObservedAtMs: number,
    renderSubmittedAtMs: number,
  ) => void
  cameraResetRevision?: number
  liveRenderScheduler: LiveRenderScheduler
  renderConfiguration: StudioRenderConfiguration
  useTabletopStandard?: boolean
}

function LiveFrameRenderObserver({
  signalRef,
  screenMedia,
  scheduler,
  onRendered,
}: {
  signalRef: RefObject<LiveFrameRenderSignal | null>
  screenMedia: ScreenMedia | null
  scheduler: LiveRenderScheduler
  onRendered: (
    frameId: number,
    schedulerGeneration: number,
    renderRequestedAtMs: number,
    r3fFrameObservedAtMs: number,
    renderSubmittedAtMs: number,
  ) => void
}) {
  const [submissionTracker] = useState(createLiveFrameRenderSubmissionTracker)

  useEffect(
    () =>
      addAfterEffect(() => {
        const submission = submissionTracker.consumeAfterRender()
        if (submission === null) return

        // R3F calls global after-effects after gl.render in this animation loop.
        // This is therefore a CPU-side render-submitted marker only; the browser
        // compositor and physical display may present the frame later.
        onRendered(
          submission.frameId,
          submission.schedulerGeneration,
          submission.renderRequestedAtMs,
          submission.r3fFrameObservedAtMs,
          highResolutionEpochNowMs(),
        )
      }),
    [onRendered, submissionTracker],
  )

  useFrame(() => {
    const signal = signalRef.current
    if (
      !signal ||
      !liveFrameSignalMatchesCommittedTexture(
        signal,
        screenMedia,
        scheduler.generation,
      )
    ) {
      return
    }
    submissionTracker.observe(signal, highResolutionEpochNowMs())
  })

  return null
}

function LiveRenderSchedulerBridge({
  scheduler,
}: {
  scheduler: LiveRenderScheduler
}) {
  const advance = useThree((state) => state.advance)
  const setFrameloop = useThree((state) => state.setFrameloop)

  useLayoutEffect(
    () =>
      scheduler.attach({
        setFrameloop,
        advance: (elapsedSeconds, frameTimestampMs) => {
          // Manual R3F clocks consume seconds. Global effects normally receive
          // requestAnimationFrame-style milliseconds, so preserve both units.
          flushGlobalEffects('before', frameTimestampMs)
          advance(elapsedSeconds, false)
          flushGlobalEffects('after', frameTimestampMs)
        },
      }),
    [advance, scheduler, setFrameloop],
  )

  useEffect(() => {
    const updateVisibility = () => {
      scheduler.setVisible(document.visibilityState === 'visible')
    }
    updateVisibility()
    document.addEventListener('visibilitychange', updateVisibility)
    return () => {
      document.removeEventListener('visibilitychange', updateVisibility)
    }
  }, [scheduler])

  return null
}

interface CameraSetup {
  position: [number, number, number]
  target: [number, number, number]
  up: [number, number, number]
}

const uprightCameraSetups: Record<ReviewView, CameraSetup> = {
  calibration: {
    position: [0, 0.1, 5.4],
    target: [0, 0.05, 0],
    up: [0, 1, 0],
  },
  hero: {
    position: [2.8, 1.5, 5.2],
    target: [0, 0.05, 0],
    up: [0, 1, 0],
  },
  side: {
    position: [5.4, 0.1, 0],
    target: [0, 0.05, 0],
    up: [0, 1, 0],
  },
  front: {
    position: [0, 0.1, 5.4],
    target: [0, 0.05, 0],
    up: [0, 1, 0],
  },
  back: {
    position: [0, 0.1, -5.4],
    target: [0, 0.05, 0],
    up: [0, 1, 0],
  },
}

function cameraSetup(view: ReviewView, useTabletopStandard: boolean): CameraSetup {
  if (!useTabletopStandard) return uprightCameraSetups[view]

  const target: [number, number, number] = [0, TABLETOP_PHONE_CENTER_Y, 0]
  const tabletopSetups: Record<ReviewView, CameraSetup> = {
    calibration: {
      position: [0, TABLETOP_PHONE_MOTION_CENTER_Y, 7],
      target: [0, TABLETOP_PHONE_MOTION_CENTER_Y, 0],
      up: [0, 1, 0],
    },
    hero: {
      position: [2.9, TABLETOP_PHONE_CENTER_Y + 2.35, 4.75],
      target,
      up: [0, 1, 0],
    },
    side: {
      position: [5.4, TABLETOP_PHONE_MOTION_CENTER_Y, 0],
      target: [0, TABLETOP_PHONE_MOTION_CENTER_Y, 0],
      up: [0, 1, 0],
    },
    front: {
      position: [0, TABLETOP_PHONE_CENTER_Y + 5.55, 0.001],
      target,
      // The camera looks almost exactly down world -Y. Using Three.js's
      // default +Y up vector here is degenerate and makes screen roll
      // visually ambiguous. World -Z is the calibrated phone's top edge.
      up: [0, 0, -1],
    },
    back: {
      position: [0, TABLETOP_PHONE_CENTER_Y - 5.55, 0.001],
      target,
      up: [0, 0, -1],
    },
  }

  return tabletopSetups[view]
}

function ReviewCamera({
  view,
  resetRevision,
  useTabletopStandard,
  controlsRef,
  livePoseRef,
}: {
  view: ReviewView
  resetRevision: number
  useTabletopStandard: boolean
  controlsRef: RefObject<OrbitControlsImpl | null>
  livePoseRef?: RefObject<PoseSample | null>
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
    followedPhoneCenterY: TABLETOP_PHONE_CENTER_Y,
  })

  useEffect(() => {
    const setup = cameraSetup(view, useTabletopStandard)
    const state = transition.current
    state.active = true
    state.elapsed = 0
    state.followedPhoneCenterY = setup.target[1]
    camera.up.set(...setup.up)
    state.fromPosition.copy(camera.position)
    state.toPosition.set(...setup.position)
    state.fromTarget.copy(controlsRef.current?.target ?? state.currentTarget)
    state.toTarget.set(...setup.target)
  }, [camera, controlsRef, resetRevision, useTabletopStandard, view])

  useFrame((_, delta) => {
    const state = transition.current
    const livePose = livePoseRef?.current
    const followsGroundedPhone =
      view === 'calibration' && useTabletopStandard

    if (followsGroundedPhone) {
      let nextCenterY = TABLETOP_PHONE_CENTER_Y
      if (livePose) {
        const [x, y, z, w] = livePose.quaternion
        nextCenterY = groundedTabletopPhoneCenterY({ x, y, z, w })
      }
      if (state.active) {
        state.followedPhoneCenterY = nextCenterY
        state.toPosition.y = nextCenterY
        state.toTarget.y = nextCenterY
      } else {
        if (controlsRef.current) {
          // OrbitControls owns the user's current pan/orbit target. Mirror it
          // before applying the phone-center translation so mouse adjustments
          // are preserved instead of being overwritten by the calibration
          // follower.
          state.currentTarget.copy(controlsRef.current.target)
        }
        const follow = phoneCenterFollowStep(
          state.followedPhoneCenterY,
          nextCenterY,
          delta,
        )
        state.followedPhoneCenterY = follow.followedCenterY
        const { shiftY } = follow
        state.currentTarget.y += shiftY
        camera.position.set(
          camera.position.x,
          camera.position.y + shiftY,
          camera.position.z,
        )
        camera.lookAt(state.currentTarget)
        if (controlsRef.current) {
          controlsRef.current.target.copy(state.currentTarget)
          controlsRef.current.update()
        }
      }
    }

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

function SideReviewCamera({
  useTabletopStandard,
}: {
  useTabletopStandard: boolean
}) {
  const cameraRef = useRef<ThreeOrthographicCamera>(null)
  const height = useThree((state) => state.size.height)
  const setup = cameraSetup('side', useTabletopStandard)

  useEffect(() => {
    if (!cameraRef.current) return
    cameraRef.current.up.set(...setup.up)
    cameraRef.current.lookAt(...setup.target)
    cameraRef.current.updateProjectionMatrix()
  }, [setup.target, setup.up])

  return (
    <OrthographicCamera
      ref={cameraRef}
      makeDefault
      far={100}
      near={0.1}
      position={setup.position}
      zoom={Math.max(120, height / 4.2)}
    />
  )
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
  livePoseKinematicsRef,
  livePoseSmoothingRate,
  onRenderedPoseChange,
  onPoseRenderDiagnostics,
  onPoseRenderSample,
  liveFrameRenderRef,
  onLiveFrameRendered,
  cameraResetRevision = 0,
  liveRenderScheduler,
  renderConfiguration,
  useTabletopStandard = false,
}: StudioSceneProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const sceneInteractionRef = useRef(false)
  const [initialCamera] = useState(() => cameraSetup(view, useTabletopStandard))
  const orbitEnabled = view === 'calibration' || view === 'hero'

  return (
    <Canvas
      frameloop={
        renderConfiguration.renderScheduleMode === 'phase'
          ? 'never'
          : 'always'
      }
      shadows={renderConfiguration.canvasShadows}
      dpr={renderConfiguration.canvasDpr}
      camera={{
        position: initialCamera.position,
        up: initialCamera.up,
        fov: 34,
        near: 0.1,
        far: 100,
      }}
      gl={{
        antialias: renderConfiguration.antialias,
        alpha: false,
        powerPreference: renderConfiguration.powerPreference,
      }}
    >
      <LiveRenderSchedulerBridge scheduler={liveRenderScheduler} />
      <StudioEnvironment
        preset={preset}
        ambientMotion={ambientMotion}
        interactingRef={sceneInteractionRef}
        showGrid={showGrid}
        showAxes={showAxes}
        showShadows={renderConfiguration.softShadows && view !== 'back'}
      />
      <hemisphereLight
        color={preset.keyColor}
        groundColor={preset.backgroundBottom}
        intensity={0.8}
      />
      <ambientLight
        intensity={
          view === 'back' ? (preset.daylight ? 0.92 : 0.76) : 0.46
        }
      />
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
      {view === 'back' && (
        <>
          <rectAreaLight
            color={preset.daylight ? '#fff0d8' : '#d7e6ff'}
            height={5.6}
            intensity={preset.daylight ? 5.4 : 5.9}
            position={[-0.55, 0.65, -4.6]}
            rotation={[0, Math.PI, 0]}
            width={3.8}
          />
          <directionalLight
            color={preset.daylight ? '#b9dcf2' : '#91bde8'}
            intensity={preset.daylight ? 0.72 : 0.92}
            position={[3.2, 2.8, -4.2]}
          />
        </>
      )}
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
      {view === 'side' ? (
        <SideReviewCamera useTabletopStandard={useTabletopStandard} />
      ) : (
        <ReviewCamera
          controlsRef={controlsRef}
          livePoseRef={livePoseRef}
          resetRevision={cameraResetRevision}
          useTabletopStandard={useTabletopStandard}
          view={view}
        />
      )}
      {liveFrameRenderRef && onLiveFrameRendered && (
        <LiveFrameRenderObserver
          signalRef={liveFrameRenderRef}
          screenMedia={screenMedia}
          scheduler={liveRenderScheduler}
          onRendered={onLiveFrameRendered}
        />
      )}
      <IPhone17Model
        animate={animate}
        view={view}
        orientation={orientation}
        screenMedia={screenMedia}
        livePoseRef={livePoseRef}
        livePoseKinematicsRef={livePoseKinematicsRef}
        livePoseSmoothingRate={livePoseSmoothingRate}
        onRenderedPoseChange={onRenderedPoseChange}
        onPoseRenderDiagnostics={onPoseRenderDiagnostics}
        onPoseRenderSample={onPoseRenderSample}
        useTabletopStandard={useTabletopStandard}
      />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enabled={orbitEnabled}
        enablePan
        minDistance={3.1}
        maxDistance={7.5}
        minPolarAngle={0.32}
        maxPolarAngle={2.82}
        onStart={() => {
          sceneInteractionRef.current = true
          liveRenderScheduler.request({
            cause: 'controls',
            generation: liveRenderScheduler.generation,
          })
        }}
        onChange={() => {
          liveRenderScheduler.request({
            cause: 'controls',
            generation: liveRenderScheduler.generation,
          })
        }}
        onEnd={() => {
          sceneInteractionRef.current = false
          liveRenderScheduler.request({
            cause: 'controls',
            generation: liveRenderScheduler.generation,
          })
        }}
        target={initialCamera.target}
      />
    </Canvas>
  )
}
