import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppearance, type Appearance } from './appearance'
import { SpatialExperience } from './spatial/SpatialExperience'
import { WorkspaceConnection, WorkspaceInspector, WorkspaceStatus } from './workspace/WorkspaceUI'
import { SpatialViewport } from './spatial/SpatialViewport'
import { SpatialWorkspace } from './spatial/SpatialWorkspace'
import { MarbleWorkspace } from './marble/MarbleWorkspace'
import { WebPlayWorkspace } from './webplay/WebPlayWorkspace'
import { MobilePlayView } from './webplay/MobilePlayView'
import { useSharedRoom, type SharedRoomController } from './webplay/useSharedRoom'
import { normalizeRoomCode } from '../shared/webPlayProtocol.mjs'
import { DEMO_SCREENS } from './studio/demoScreens'
import { useDemoScreen } from './studio/useDemoScreen'
import {
  IPHONE_17_MM,
  type ReviewView,
  type ScreenOrientation,
} from './model/iphone17'
import { StudioScene } from './scene/StudioScene'
import { createBrowserLiveRenderScheduler } from './scene/liveRenderScheduler'
import { findStudioPreset, studioPresets } from './studio/presets'
import type { CaptureState, QuaternionTuple } from './studio/liveProtocol'
import type { DetailedMetricSummary } from './studio/liveMeasurement'
import {
  buildPoseAccuracySnapshot,
  type PoseAccuracySnapshot,
} from './studio/poseDiagnostics'
import { POSE_SMOOTHING_RATE } from './studio/posePresentation'
import { studioRenderConfigurationFromSearch } from './studio/renderConfiguration'
import { useLivePhoneSource } from './studio/useLivePhoneSource'
import { useLocalVideoSource } from './studio/useLocalVideoSource'

type ScreenSourceMode = 'demo' | 'local' | 'live'
type WebWorkspaceTab = 'webplay' | 'showcase' | 'local'

function formatLatency(value: number | null) {
  return value === null ? '—' : `${Math.round(value)} ms`
}

function formatDuration(value: number) {
  const seconds = Math.floor(value / 1_000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function formatRate(value: number | null, suffix: string) {
  return value === null ? '—' : `${value.toFixed(1)} ${suffix}`
}

function formatPercent(value: number | null) {
  return value === null ? '—' : `${value.toFixed(2)}%`
}

function formatPoseSyncMode(value: 'live' | 'frame-clock' | 'estimated') {
  if (value === 'frame-clock') return 'Frame clock'
  if (value === 'estimated') return 'Receiver estimate'
  return 'Latest pose'
}

function formatDegrees(value: number) {
  return `${value.toFixed(1)}°`
}

function formatCaptureState(value: CaptureState | null) {
  if (value === 'choosing') return 'Select Full Display'
  if (value === 'starting') return 'Starting'
  if (value === 'streaming') return 'Streaming'
  if (value === 'failed') return 'Needs attention'
  if (value === 'idle') return 'Idle'
  return 'Waiting'
}

function formatMetricTail(
  metric: DetailedMetricSummary,
  formatter: (value: number | null) => string = formatLatency,
) {
  return `${formatter(metric.p95Ms)} / ${formatter(metric.p99Ms)} / ${formatter(metric.maxMs)}`
}

function formatAxis(value: readonly [number, number, number]) {
  return value.map((component) => component.toFixed(2)).join(', ')
}

function formatPoseVerdict(value: PoseAccuracySnapshot['verdict']) {
  const labels: Record<PoseAccuracySnapshot['verdict'], string> = {
    Ready: 'Ready at 0°',
    'Rotate to 90°': 'Rotate to 90°',
    'Hold steady': 'Hold steady',
    'Transform mismatch': 'Transform mismatch',
    'Axis mismatch': 'Axis mismatch',
    Pass: '90° check passed',
  }
  return labels[value]
}

function detectMobileBrowser(): boolean {
  if (typeof window === 'undefined') return false
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  return coarse && window.innerWidth <= 900
}

export function App() {
  const desktop = document.documentElement.dataset.desktop === 'true'
  const initialParams = useMemo(() => new URLSearchParams(location.search), [])
  const initialPairCode = useMemo(() => normalizeRoomCode(initialParams.get('pair') ?? ''), [initialParams])
  const hasExplicitLocalParam = useMemo(
    () => initialParams.has('bridge') || initialParams.get('mode') === 'local',
    [initialParams],
  )
  const [forceDesktopWeb, setForceDesktopWeb] = useState(() => initialParams.get('view') === 'desktop')
  const [mobileScreen] = useState(detectMobileBrowser)

  const [mode, setMode] = useState(() => initialParams.get('mode') === 'mirroring' ? 'mirroring' : 'spatial')
  const [experience, setExperience] = useState<'tracking' | 'marble'>(() => initialParams.get('experience') === 'tracking' ? 'tracking' : 'marble')
  const [webTab, setWebTab] = useState<WebWorkspaceTab>(() => {
    if (hasExplicitLocalParam) return 'local'
    if (initialParams.get('mode') === 'mirroring' || initialParams.get('tab') === 'showcase') return 'showcase'
    return 'webplay'
  })

  const showMobileController = !desktop && (initialPairCode !== null || (mobileScreen && !forceDesktopWeb && !hasExplicitLocalParam))
  const sharedRoom = useSharedRoom(!desktop && !showMobileController)

  const activeWorkspace = mode === 'mirroring' ? 'mirroring' : experience
  const [visited, setVisited] = useState(() => new Set([activeWorkspace]))
  const { appearance } = useAppearance()
  const navigate = useCallback((nextMode: string, nextExperience = experience) => {
    setMode(nextMode)
    setExperience(nextExperience)
    const nextWorkspace = nextMode === 'mirroring' ? 'mirroring' : nextExperience
    setVisited((current) => current.has(nextWorkspace) ? current : new Set([...current, nextWorkspace]))
    const url = new URL(location.href)
    url.searchParams.set('mode', nextMode)
    url.searchParams.set('experience', nextExperience)
    history.replaceState(null, '', url)
  }, [experience])
  useEffect(() => {
    window.phoneStudioSetWorkspace = (workspace) => {
      if (workspace === 'mirroring') navigate('mirroring')
      else if (workspace === 'marble' || workspace === 'tracking') navigate('spatial', workspace)
    }
    return () => { delete window.phoneStudioSetWorkspace }
  }, [navigate])

  if (showMobileController) {
    return (
      <MobilePlayView
        initialRoomCode={initialPairCode}
        onSwitchToDesktop={() => {
          setForceDesktopWeb(true)
          const url = new URL(location.href)
          url.searchParams.set('view', 'desktop')
          history.replaceState(null, '', url)
        }}
      />
    )
  }

  if (desktop) {
    return (
      <div className="studio-app">
        <div className="studio-panels">
          {(['marble', 'tracking', 'mirroring'] as const).map((workspace) => visited.has(workspace) &&
            <div key={workspace} className={'studio-panel' + (workspace === activeWorkspace ? ' is-active' : '')}
              aria-hidden={workspace !== activeWorkspace} inert={workspace !== activeWorkspace}>
              {workspace === 'marble' ? <MarbleWorkspace active={workspace === activeWorkspace} />
                : workspace === 'tracking' ? <SpatialWorkspace active={workspace === activeWorkspace} />
                  : <MirroringApp active={workspace === activeWorkspace} />}
            </div>)}
        </div>
      </div>
    )
  }

  return (
    <div className="studio-app">
      <nav className="studio-mode-nav" aria-label="Studio mode">
        <button aria-pressed={webTab === 'webplay'} onClick={() => setWebTab('webplay')}>
          Play Online
        </button>
        <button aria-pressed={webTab === 'showcase'} onClick={() => setWebTab('showcase')}>
          3D UI Showcase
        </button>
        <button aria-pressed={webTab === 'local'} onClick={() => setWebTab('local')}>
          Local ARKit (Pro)
        </button>
        <label className="appearance-picker">Appearance
          <select value={appearance} onChange={(event) => {
            const value = event.target.value as Appearance
            window.phoneStudioSetAppearance(value)
            const url = new URL(location.href)
            url.searchParams.set('appearance', value)
            history.replaceState(null, '', url)
          }}>
            <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
          </select>
        </label>
      </nav>
      {webTab === 'webplay' ? (
        <WebPlayWorkspace active sharedRoom={sharedRoom} />
      ) : webTab === 'showcase' ? (
        <MirroringApp active defaultSourceMode="demo" sharedRoom={sharedRoom} />
      ) : (
        <>
          <div className="spatial-experience-nav" role="group" aria-label="Local Mac bridge workspace">
            <button aria-pressed={mode === 'spatial'} onClick={() => navigate('spatial', 'marble')}>Local Elastic Tray</button>
            <button aria-pressed={mode === 'mirroring'} onClick={() => navigate('mirroring')}>Local Mirroring</button>
          </div>
          {mode === 'spatial' ? <SpatialExperience experience={experience} onExperienceChange={(value) => navigate('spatial', value)} showNavigation /> : <MirroringApp />}
        </>
      )}
    </div>
  )
}

function MirroringApp({
  active = true,
  defaultSourceMode = 'live',
  sharedRoom,
}: {
  active?: boolean
  defaultSourceMode?: ScreenSourceMode
  sharedRoom?: SharedRoomController
}) {
  const [presetId, setPresetId] = useState('studio')
  const [animate, setAnimate] = useState(true)
  const [ambientMotion, setAmbientMotion] = useState(true)
  const [showGrid, setShowGrid] = useState(false)
  const [showAxes, setShowAxes] = useState(false)
  const [view, setView] = useState<ReviewView>('hero')
  const [cameraResetRevision, setCameraResetRevision] = useState(0)
  const [orientation, setOrientation] = useState<ScreenOrientation>('portrait')
  const [sourceMode, setSourceMode] = useState<ScreenSourceMode>(defaultSourceMode)
  const [renderedPose, setRenderedPose] = useState<QuaternionTuple | null>(null)
  const [renderConfiguration] = useState(() =>
    studioRenderConfigurationFromSearch(
      window.location.search,
      window.devicePixelRatio,
    ),
  )
  const [liveRenderScheduler] = useState(() =>
    createBrowserLiveRenderScheduler(
      renderConfiguration.renderScheduleMode,
      renderConfiguration.renderScheduleCapHz ?? undefined,
    ),
  )
  const preset = useMemo(() => findStudioPreset(presetId), [presetId])
  const demoScreen = useDemoScreen(active && sourceMode === 'demo', sharedRoom)
  const localVideo = useLocalVideoSource(active && sourceMode === 'local')
  const livePhone = useLivePhoneSource(renderConfiguration, liveRenderScheduler, active && sourceMode === 'live')
  const screenMedia = sourceMode === 'demo' ? demoScreen.media : sourceMode === 'live' ? livePhone.media : localVideo.media
  const sourceReady = screenMedia !== null
  const sourceStatus =
    sourceMode === 'demo'
      ? sharedRoom?.paired ? 'Paired phone tilt active' : 'Interactive demo'
      : sourceMode === 'live' && livePhone.screenStale
        ? 'stale'
        : sourceMode === 'live'
          ? livePhone.status
          : localVideo.status
  const sourceError =
    sourceMode === 'live' ? livePhone.error : sourceMode === 'local' ? localVideo.error : null
  const activeOrientation =
    sourceMode === 'live' ? livePhone.orientation : sourceMode === 'demo' ? 'portrait' : orientation
  const demoPairedPose = sourceMode === 'demo' && sharedRoom?.paired
  const poseAccuracy =
    sourceMode === 'live' && livePhone.poseDiagnostics && renderedPose
      ? buildPoseAccuracySnapshot(
          livePhone.poseDiagnostics.latestSensorRelative,
          livePhone.poseDiagnostics.targetQuaternion,
          renderedPose,
        )
      : null

  return (
    <main className="workspace-shell mirroring-workspace">
      <div className="workspace-content">
        <SpatialViewport label="Interactive 3D phone viewport" onReset={() => setCameraResetRevision((value) => value + 1)} controls={null}>
          <StudioScene
            active={active}
            preset={preset}
            animate={sourceMode !== 'live' && !demoPairedPose && animate}
            ambientMotion={ambientMotion}
            showGrid={showGrid}
            showAxes={showAxes}
            view={view}
            orientation={activeOrientation}
            screenMedia={screenMedia}
            livePoseRef={
              demoPairedPose
                ? demoScreen.poseRef
                : sourceMode === 'live' && livePhone.poseReady
                  ? livePhone.poseRef
                  : undefined
            }
            livePoseKinematicsRef={
              sourceMode === 'live' && livePhone.poseReady
                ? livePhone.ultraPoseKinematicsRef
                : undefined
            }
            livePoseSmoothingRate={
              sourceMode === 'live'
                ? POSE_SMOOTHING_RATE[livePhone.posePresentationMode]
                : 24
            }
            onRenderedPoseChange={
              sourceMode === 'live' ? setRenderedPose : undefined
            }
            onPoseRenderDiagnostics={
              sourceMode === 'live'
                ? livePhone.reportPoseRenderDiagnostics
                : undefined
            }
            onPoseRenderSample={
              sourceMode === 'live'
                ? livePhone.recordPoseRenderSample
                : undefined
            }
            liveFrameRenderRef={
              sourceMode === 'live' ? livePhone.liveFrameRenderRef : undefined
            }
            onLiveFrameRendered={
              sourceMode === 'live' ? livePhone.markFrameRendered : undefined
            }
            cameraResetRevision={cameraResetRevision}
            liveRenderScheduler={liveRenderScheduler}
            renderConfiguration={renderConfiguration}
            useTabletopStandard={sourceMode === 'live' || demoPairedPose}
          />
          <WorkspaceStatus live={sourceMode === 'demo' || (sourceReady && !livePhone.screenStale)}>
            {sourceMode === 'demo' ? demoPairedPose ? 'Phone Paired · Demo' : 'Interactive Demo' : sourceMode === 'local' ? sourceReady ? 'Local video' : 'Preview' : livePhone.screenStale ? 'Screen paused' : sourceReady ? 'Live screen' : 'Preview'}
          </WorkspaceStatus>
        </SpatialViewport>
        <WorkspaceInspector title="3D UI Showcase" description="Preview interactive UI screens or your own recording on a 3D iPhone.">
          {sourceMode === 'live' && !livePhone.stats.phones && <WorkspaceConnection description="Pair your iPhone, then start screen sharing in the iPhone app." />}
          <section className="workspace-section">
            <h2>Screen source</h2>
            {sourceReady && <p className="workspace-notice">{sourceStatus}</p>}
            <div className="view-switcher three-column" role="group" aria-label="Screen source mode" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
              {([
                ['demo', 'Demo UI'],
                ['local', 'Local MP4'],
                ['live', 'Local iPhone'],
              ] as const).map(([item, label]) => (
                <button
                  className={item === sourceMode ? 'view-button active' : 'view-button'}
                  key={item}
                  type="button"
                  aria-pressed={item === sourceMode}
                  onClick={() => setSourceMode(item)}
                >
                  {label}
                </button>
              ))}
            </div>
            {sourceMode === 'demo' && (
              <>
                <div className="webplay-demo-grid" role="group" aria-label="Demo screen presets">
                  {DEMO_SCREENS.map((scr) => (
                    <button
                      key={scr.id}
                      type="button"
                      className={demoScreen.demoState.screenId === scr.id ? 'view-button active' : 'view-button'}
                      aria-pressed={demoScreen.demoState.screenId === scr.id}
                      onClick={() => demoScreen.dispatchControl('select-screen', scr.id)}
                    >
                      {scr.label}
                    </button>
                  ))}
                </div>
                {demoScreen.demoState.screenId === 'audio' && (
                  <div className="webplay-demo-controls">
                    <button type="button" onClick={() => demoScreen.dispatchControl('prev-track')}>Prev</button>
                    <button type="button" className="spatial-primary" style={{ flex: 2 }} onClick={() => demoScreen.dispatchControl('toggle-play')}>
                      {demoScreen.demoState.playing ? 'Pause' : 'Play'}
                    </button>
                    <button type="button" onClick={() => demoScreen.dispatchControl('next-track')}>Next</button>
                  </div>
                )}
                {demoScreen.demoState.screenId === 'weather' && (
                  <div className="webplay-demo-controls">
                    {(['aurora', 'sunny', 'rain'] as const).map((cond) => (
                      <button
                        key={cond}
                        type="button"
                        className={demoScreen.demoState.weather === cond ? 'view-button active' : 'view-button'}
                        onClick={() => demoScreen.dispatchControl('set-weather', cond)}
                      >
                        {cond}
                      </button>
                    ))}
                  </div>
                )}
                {demoScreen.demoState.screenId === 'notifications' && (
                  <div className="webplay-demo-controls">
                    <button type="button" className="spatial-primary" onClick={() => demoScreen.dispatchControl('cycle-notification')}>
                      Focus Next Card
                    </button>
                  </div>
                )}
                <p className="source-description">
                  {sharedRoom?.paired
                    ? 'Paired phone is tilting this 3D iPhone and can control this UI remotely.'
                    : 'Pair your phone in Play Online to tilt this screen with your hand, or drag to orbit.'}
                </p>
              </>
            )}
            {sourceMode === 'local' ? (
              <label className="wide-button file-button">
                <span>{sourceReady ? 'Replace local video' : 'Choose local video'}</span>
                <input
                  accept="video/*"
                  aria-label="Choose a local screen recording"
                  type="file"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    if (file) localVideo.selectFile(file)
                    event.currentTarget.value = ''
                  }}
                />
              </label>
            ) : null}
            {screenMedia && (
              <p className="source-meta" title={screenMedia.name}>
                <span>{screenMedia.name}</span>
                <span>{screenMedia.width} × {screenMedia.height}</span>
              </p>
            )}
            {sourceError && <p className="source-error" role="alert">{sourceError}</p>}
            {sourceMode === 'local' ? (
              <>
                <div className="source-actions" role="group" aria-label="Video playback">
                  <button
                    className="view-button"
                    disabled={!sourceReady || localVideo.status === 'playing'}
                    onClick={() => void localVideo.play()}
                    type="button"
                  >
                    Play
                  </button>
                  <button
                    className="view-button"
                    disabled={!sourceReady || localVideo.status !== 'playing'}
                    onClick={localVideo.pause}
                    type="button"
                  >
                    Pause
                  </button>
                  <button
                    className="view-button"
                    disabled={!sourceReady}
                    onClick={localVideo.reset}
                    type="button"
                  >
                    Reset
                  </button>
                </div>
                <div className="view-switcher two-column" role="group" aria-label="Screen orientation">
                  {(['portrait', 'landscape'] as const).map((item) => (
                    <button
                      className={item === orientation ? 'view-button active' : 'view-button'}
                      key={item}
                      type="button"
                      aria-pressed={item === orientation}
                      onClick={() => setOrientation(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            {sourceMode === 'live' && livePhone.stats.captureState === 'choosing' && (
              <p className="source-description">
                The iPhone is connected, but capture has not started. Select Full Display in the iOS system sheet.
              </p>
            )}
            {sourceMode === 'live' && livePhone.stats.captureState === 'starting' && (
              <p className="source-description">
                The display was selected and the first video frame is starting.
              </p>
            )}
            {sourceMode === 'live' && livePhone.stats.codec === 'webrtc' && (
              <p className="source-description">
                Receive estimate covers jitter buffering, decode, and half RTT—not iPhone capture/encode or the final 3D paint.
              </p>
            )}
          </section>

          <section className="workspace-section">
            <h2>View</h2>
            <div className="view-switcher model-views" role="group" aria-label="Model review view">
              {([
                ['calibration', 'Calibration'],
                ['hero', 'Hero'],
                ['side', 'Side'],
                ['front', 'Front'],
                ['back', 'Back'],
              ] as const).map(([item, label]) => (
                <button
                  className={item === view ? 'view-button active' : 'view-button'}
                  key={item}
                  type="button"
                  aria-pressed={item === view}
                  onClick={() => {
                    setView(item)
                    if (item === 'side') setShowGrid(true)
                    setCameraResetRevision((value) => value + 1)
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {view === 'side' && <p className="source-description">
              Side uses an orthographic camera and horizontal grid so a physical 45° lift appears as a true 45° profile.
            </p>}
          </section>

          <details className="workspace-disclosure">
            <summary>Scene</summary>
            <label className="workspace-select-row">Background<select value={presetId} onChange={(event) => setPresetId(event.target.value)}>
              {studioPresets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
            <div className="scene-toggle-grid" role="group" aria-label="Scene helpers">
              <button
                className="scene-toggle"
                role="switch"
                type="button"
                aria-checked={ambientMotion}
                disabled={preset.id === 'studio'}
                onClick={() => setAmbientMotion((value) => !value)}
              >
                <span>Ambient motion</span>
                <span className="toggle-track" aria-hidden="true"><span /></span>
              </button>
              <button
                className="scene-toggle"
                role="switch"
                type="button"
                aria-checked={showGrid}
                onClick={() => setShowGrid((value) => !value)}
              >
                <span>Grid</span>
                <span className="toggle-track" aria-hidden="true"><span /></span>
              </button>
              <button
                className="scene-toggle"
                role="switch"
                type="button"
                aria-checked={showAxes}
                onClick={() => setShowAxes((value) => !value)}
              >
                <span>Axes</span>
                <span className="toggle-track" aria-hidden="true"><span /></span>
              </button>
            </div>
          </details>

          <details className="workspace-disclosure">
            <summary>Motion</summary>
            <span className={sourceMode === 'local' || (livePhone.poseReady && !livePhone.poseStale) ? 'chip ready' : 'chip'}>
              {sourceMode === 'local'
                ? 'Ready'
                : livePhone.poseStale
                  ? 'Stale'
                  : livePhone.poseReady
                    ? 'Ready'
                    : 'Waiting'}
            </span>
            {sourceMode === 'local' ? (
              <button
                className="wide-button"
                type="button"
                onClick={() => setAnimate((value) => !value)}
              >
                {animate ? 'Pause motion' : 'Resume motion'}
              </button>
            ) : (
              <>
                <div
                  className="view-switcher two-column"
                  role="group"
                  aria-label="Pose presentation mode"
                >
                  <button
                    className={
                      livePhone.posePresentationMode === 'synchronized'
                        ? 'view-button active'
                        : 'view-button'
                    }
                    type="button"
                    aria-pressed={
                      livePhone.posePresentationMode === 'synchronized'
                    }
                    onClick={() =>
                      livePhone.setPosePresentationMode('synchronized')
                    }
                  >
                    Synchronized
                  </button>
                  <button
                    className={
                      livePhone.posePresentationMode === 'low-latency'
                        ? 'view-button active'
                        : 'view-button'
                    }
                    type="button"
                    aria-pressed={
                      livePhone.posePresentationMode === 'low-latency'
                    }
                    onClick={() =>
                      livePhone.setPosePresentationMode('low-latency')
                    }
                  >
                    Low latency
                  </button>
                  <button
                    className={
                      livePhone.posePresentationMode === 'instant'
                        ? 'view-button active'
                        : 'view-button'
                    }
                    type="button"
                    aria-pressed={
                      livePhone.posePresentationMode === 'instant'
                    }
                    onClick={() =>
                      livePhone.setPosePresentationMode('instant')
                    }
                  >
                    Instant
                  </button>
                  <button
                    className={
                      livePhone.posePresentationMode === 'ultra'
                        ? 'view-button active'
                        : 'view-button'
                    }
                    type="button"
                    aria-pressed={
                      livePhone.posePresentationMode === 'ultra'
                    }
                    onClick={() =>
                      livePhone.setPosePresentationMode('ultra')
                    }
                  >
                    Ultra
                  </button>
                </div>
                <p className="source-description">
                  {livePhone.posePresentationMode === 'synchronized'
                    ? 'Matches the model pose to each displayed video frame.'
                    : livePhone.posePresentationMode === 'low-latency'
                      ? 'Uses the newest motion sample and faster model tracking; the screen may trail the shell.'
                      : livePhone.posePresentationMode === 'instant'
                        ? 'Uses the newest 60 Hz sample with no 3D smoothing.'
                        : 'Requests the device ceiling, predicts to the next render, and applies no 3D smoothing.'}
                </p>
                <button
                  className="wide-button"
                  disabled={!livePhone.poseReady}
                  type="button"
                  onClick={livePhone.calibratePose}
                >
                  Calibrate tabletop pose
                </button>
                <button
                  className="wide-button"
                  disabled={!livePhone.poseReady}
                  type="button"
                  onClick={() => {
                    livePhone.calibratePose()
                    setView('front')
                    setShowGrid(true)
                    setShowAxes(true)
                    setCameraResetRevision((value) => value + 1)
                  }}
                >
                  Prepare 90° pose check
                </button>
                <p className="source-description">
                  Lay the iPhone screen-up with the Dynamic Island pointing toward the Mac, then calibrate. Synchronized mode aligns motion to the screen frame&apos;s capture time.
                </p>
                {livePhone.hasManualLevel && poseAccuracy && (
                  <>
                    <p className="source-description">
                      Keep the phone flat, rotate it exactly 90° on the table, then hold for two seconds.
                    </p>
                    <div
                      className="measurement-results pose-diagnostics"
                      aria-label="Pose accuracy check"
                    >
                      <div>
                        <span>Check</span>
                        <strong>{formatPoseVerdict(poseAccuracy.verdict)}</strong>
                      </div>
                      <div>
                        <span>Latest sensor delta</span>
                        <strong>{formatDegrees(poseAccuracy.sensorAngleDegrees)}</strong>
                      </div>
                      <div>
                        <span>Video-synced target</span>
                        <strong>{formatDegrees(poseAccuracy.targetAngleDegrees)}</strong>
                      </div>
                      <div>
                        <span>Rendered model</span>
                        <strong>{formatDegrees(poseAccuracy.renderedAngleDegrees)}</strong>
                      </div>
                      <div>
                        <span>Sensor plane tilt</span>
                        <strong>{formatDegrees(poseAccuracy.sensorPlaneInclinationDegrees)}</strong>
                      </div>
                      <div>
                        <span>Target plane tilt</span>
                        <strong>{formatDegrees(poseAccuracy.targetPlaneInclinationDegrees)}</strong>
                      </div>
                      <div>
                        <span>Rendered plane tilt</span>
                        <strong>{formatDegrees(poseAccuracy.renderedPlaneInclinationDegrees)}</strong>
                      </div>
                      <div>
                        <span>Target tracking error</span>
                        <strong>{formatDegrees(poseAccuracy.trackingErrorDegrees)}</strong>
                      </div>
                      <div>
                        <span>Table-axis alignment</span>
                        <strong>
                          {poseAccuracy.tableAxisAlignmentPercent.toFixed(1)}%
                        </strong>
                      </div>
                      <div>
                        <span>Target world axis · X, Y, Z</span>
                        <strong>{formatAxis(poseAccuracy.targetWorldAxis)}</strong>
                      </div>
                    </div>
                  </>
                )}
                <p className="source-meta">
                  <span>Level reference</span>
                  <span>{livePhone.hasManualLevel ? 'Manual · set' : 'Automatic'}</span>
                </p>
                <p className="source-meta">
                  <span>Pose latency</span>
                  <span>{formatLatency(livePhone.stats.poseLatencyMs)}</span>
                </p>
                <p className="source-meta">
                  <span>Pose sample rate</span>
                  <span>
                    {formatRate(livePhone.stats.poseActualHz, 'Hz')}
                    {livePhone.stats.poseRequestedHz === null
                      ? ''
                      : ` · requested ${Math.round(livePhone.stats.poseRequestedHz)}`}
                  </span>
                </p>
                {livePhone.posePresentationMode === 'ultra' && (
                  <>
                    <p className="source-meta">
                      <span>Pose prediction</span>
                      <span>{formatLatency(livePhone.stats.posePredictionMs)}</span>
                    </p>
                    <p className="source-meta">
                      <span>3D render rate</span>
                      <span>{formatRate(livePhone.stats.renderFps, 'fps')}</span>
                    </p>
                    <p className="source-meta">
                      <span>Pose arrival gap p95</span>
                      <span>{formatLatency(livePhone.stats.poseArrivalGapP95Ms)}</span>
                    </p>
                    <p className="source-meta">
                      <span>Prediction correction</span>
                      <span>
                        {livePhone.stats.posePredictionCorrectionDegrees === null
                          ? '—'
                          : formatDegrees(
                              livePhone.stats.posePredictionCorrectionDegrees,
                            )}
                      </span>
                    </p>
                  </>
                )}
                <p className="source-meta">
                  <span>Pose alignment</span>
                  <span>{formatPoseSyncMode(livePhone.stats.poseSyncMode)}</span>
                </p>
                <p className="source-meta">
                  <span>Video-aligned delay</span>
                  <span>{formatLatency(livePhone.stats.poseSyncDelayMs)}</span>
                </p>
                <p className="source-meta">
                  <span>Nearest pose sample</span>
                  <span>{formatLatency(livePhone.stats.poseSyncErrorMs)}</span>
                </p>
              </>
            )}
          </details>

          {sourceMode === 'live' && (
            <details className="workspace-disclosure">
              <summary>Diagnostics</summary>
              <details className="workspace-disclosure workspace-subdetails"><summary>Stream details</summary>
              <dl className="live-stats">
                <div><dt>Phone</dt><dd>{livePhone.stats.phones ? 'Connected' : 'Waiting'}</dd></div>
                <div><dt>Capture</dt><dd>{formatCaptureState(livePhone.stats.captureState)}</dd></div>
                <div><dt>Codec</dt><dd>{livePhone.stats.codec?.toUpperCase() ?? '—'}</dd></div>
                <div><dt>Frames</dt><dd>{livePhone.stats.frames}</dd></div>
                {livePhone.stats.codec === 'webrtc' ? (
                  <>
                    <div><dt>Negotiated video</dt><dd>{livePhone.stats.webRTCCodecMimeType?.replace('video/', '') ?? '—'}</dd></div>
                    <div>
                      <dt title="Jitter buffer + decode + half of network RTT; excludes iPhone capture/encode and the final 3D paint.">
                        Receive estimate
                      </dt>
                      <dd>{formatLatency(livePhone.stats.frameLatencyMs)}</dd>
                    </div>
                    <div><dt>Video FPS (10s)</dt><dd>{formatRate(livePhone.stats.webRTCFps, 'fps')}</dd></div>
                    <div><dt>Bitrate</dt><dd>{formatRate(livePhone.stats.webRTCBitrateMbps, 'Mbps')}</dd></div>
                    <div><dt>Network RTT</dt><dd>{formatLatency(livePhone.stats.webRTCRoundTripMs)}</dd></div>
                    <div><dt>Jitter buffer</dt><dd>{formatLatency(livePhone.stats.webRTCJitterBufferMs)}</dd></div>
                    <div><dt>Jitter minimum</dt><dd>{formatLatency(livePhone.stats.webRTCJitterMinimumMs)}</dd></div>
                    <div><dt>Jitter target</dt><dd>{formatLatency(livePhone.stats.webRTCJitterTargetMs)}</dd></div>
                    <div><dt>Decode</dt><dd>{formatLatency(livePhone.stats.webRTCDecodeMs)}</dd></div>
                    <div><dt>Packet loss</dt><dd>{formatPercent(livePhone.stats.webRTCPacketLossPercent)}</dd></div>
                    <div><dt>Dropped frames</dt><dd>{livePhone.stats.webRTCFramesDropped}</dd></div>
                  </>
                ) : (
                  <div><dt>Frame latency</dt><dd>{formatLatency(livePhone.stats.frameLatencyMs)}</dd></div>
                )}
              </dl>
              <button
                className="wide-button"
                type="button"
                onClick={
                  livePhone.status === 'idle' || livePhone.status === 'error'
                    ? livePhone.connect
                    : livePhone.disconnect
                }
              >
                {livePhone.status === 'idle' || livePhone.status === 'error'
                  ? 'Connect local bridge'
                  : 'Disconnect live input'}
              </button>
              </details>
              <span
                className={
                  livePhone.measurement.status === 'running'
                    ? 'chip ready'
                    : 'chip'
                }
              >
                {livePhone.measurement.status}
              </span>
              <p className="source-description">
                Records screen timing plus every pose packet and 3D render sample. The report contains timing and motion numbers only—never screen pixels.
              </p>
              {livePhone.measurement.status === 'running' ? (
                <button
                  className="wide-button"
                  type="button"
                  onClick={livePhone.finishMeasurement}
                >
                  Stop and analyze
                </button>
              ) : (
                <button
                  className="wide-button"
                  disabled={livePhone.status !== 'ready' || !livePhone.poseReady}
                  type="button"
                  onClick={() => livePhone.startMeasurement()}
                >
                  {livePhone.measurement.status === 'complete'
                    ? 'Start new recording'
                    : 'Start diagnostic recording'}
                </button>
              )}
              <dl className="live-stats">
                <div>
                  <dt>Elapsed</dt>
                  <dd>{formatDuration(livePhone.measurement.elapsedMs)}</dd>
                </div>
                <div>
                  <dt>Screen samples</dt>
                  <dd>
                    {livePhone.measurement.renderedFrames} / {livePhone.measurement.receivedFrames}
                  </dd>
                </div>
                <div>
                  <dt>Pose samples</dt>
                  <dd>{livePhone.measurement.poseSamples}</dd>
                </div>
                <div>
                  <dt>3D render samples</dt>
                  <dd>{livePhone.measurement.poseRenderSamples}</dd>
                </div>
              </dl>
              {livePhone.measurement.report && (
                <>
                  <div className="measurement-results" aria-label="Latency result">
                    <div>
                      <span>Screen p50 / p95</span>
                      <strong>
                        {formatLatency(
                          livePhone.measurement.report.screen.captureToRender.p50Ms,
                        )}{' '}
                        /{' '}
                        {formatLatency(
                          livePhone.measurement.report.screen.captureToRender.p95Ms,
                        )}
                      </strong>
                    </div>
                    <div>
                      <span>Capture timestamp coverage</span>
                      <strong>
                        {formatPercent(
                          livePhone.measurement.report.screen.captureTimestamp
                            .coveragePercent,
                        )}{' '}
                        ({formatPercent(
                          livePhone.measurement.report.screen.captureTimestamp
                            .futureToleratedPercent,
                        )}{' '}
                        future-tolerated)
                      </strong>
                    </div>
                    <div>
                      <span>Pose p50 / p95</span>
                      <strong>
                        {formatLatency(
                          livePhone.measurement.report.pose.phoneToBrowser.p50Ms,
                        )}{' '}
                        /{' '}
                        {formatLatency(
                          livePhone.measurement.report.pose.phoneToBrowser.p95Ms,
                        )}
                      </strong>
                    </div>
                    <div>
                      <span>Rendered rate</span>
                      <strong>
                        {formatRate(
                          livePhone.measurement.report.screen.renderedFps,
                          'fps',
                        )}
                      </strong>
                    </div>
                    <div>
                      <span>Screen / pose skew p95</span>
                      <strong>
                        {formatLatency(
                          livePhone.measurement.report.synchronization.screenPoseSkew
                            .p95Ms,
                        )}
                      </strong>
                    </div>
                    <div>
                      <span>Render gap p95 / p99 / max</span>
                      <strong>
                        {formatMetricTail(
                          livePhone.measurement.report.render.frameInterval,
                        )}
                      </strong>
                    </div>
                    <div>
                      <span>Pose arrival p95 / p99 / max</span>
                      <strong>
                        {formatMetricTail(
                          livePhone.measurement.report.pose.arrivalGap,
                        )}
                      </strong>
                    </div>
                    <div>
                      <span>Sample age p95 / p99 / max</span>
                      <strong>
                        {formatMetricTail(
                          livePhone.measurement.report.render.sampleAge,
                        )}
                      </strong>
                    </div>
                    <div>
                      <span>Correction p95 / p99 / max</span>
                      <strong>
                        {formatMetricTail(
                          livePhone.measurement.report.pose
                            .predictionCorrectionDegrees,
                          (value) =>
                            value === null ? '—' : formatDegrees(value),
                        )}
                      </strong>
                    </div>
                    <div>
                      <span>Peak angular speed</span>
                      <strong>
                        {livePhone.measurement.report.pose
                          .angularSpeedDegreesPerSecond.maxMs === null
                          ? '—'
                          : `${Math.round(
                              livePhone.measurement.report.pose
                                .angularSpeedDegreesPerSecond.maxMs,
                            )}°/s`}
                      </strong>
                    </div>
                    <div>
                      <span>Prediction cap hits</span>
                      <strong>
                        {livePhone.measurement.report.render.predictionCapHitPercent.toFixed(
                          1,
                        )}%
                      </strong>
                    </div>
                  </div>
                  <button
                    className="wide-button"
                    type="button"
                    onClick={livePhone.downloadMeasurementReport}
                  >
                    Download JSON report
                  </button>
                </>
              )}
            </details>
          )}

          <details className="workspace-disclosure metrics">
            <summary>Device details</summary>
            <dl>
              <div>
                <dt>Body</dt>
                <dd>{IPHONE_17_MM.width} × {IPHONE_17_MM.height} mm</dd>
              </div>
              <div>
                <dt>Depth</dt>
                <dd>{IPHONE_17_MM.depth} mm</dd>
              </div>
              <div>
                <dt>Finish</dt>
                <dd>Black</dd>
              </div>
            </dl>
          </details>
          <p className="workspace-footnote">Prototype · physical validation pending</p>
        </WorkspaceInspector>
      </div>
    </main>
  )
}
