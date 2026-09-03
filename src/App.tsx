import { useMemo, useState } from 'react'
import {
  IPHONE_17_MM,
  type ReviewView,
  type ScreenOrientation,
} from './model/iphone17'
import { StudioScene } from './scene/StudioScene'
import { findStudioPreset, studioPresets } from './studio/presets'
import type { QuaternionTuple } from './studio/liveProtocol'
import type { DetailedMetricSummary } from './studio/liveMeasurement'
import {
  buildPoseAccuracySnapshot,
  type PoseAccuracySnapshot,
} from './studio/poseDiagnostics'
import { POSE_SMOOTHING_RATE } from './studio/posePresentation'
import { useLivePhoneSource } from './studio/useLivePhoneSource'
import { useLocalVideoSource } from './studio/useLocalVideoSource'

type ScreenSourceMode = 'local' | 'live'

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

export function App() {
  const [presetId, setPresetId] = useState('pearl')
  const [animate, setAnimate] = useState(true)
  const [ambientMotion, setAmbientMotion] = useState(true)
  const [showGrid, setShowGrid] = useState(false)
  const [showAxes, setShowAxes] = useState(false)
  const [view, setView] = useState<ReviewView>('calibration')
  const [cameraResetRevision, setCameraResetRevision] = useState(0)
  const [orientation, setOrientation] = useState<ScreenOrientation>('portrait')
  const [sourceMode, setSourceMode] = useState<ScreenSourceMode>('live')
  const [renderedPose, setRenderedPose] = useState<QuaternionTuple | null>(null)
  const preset = useMemo(() => findStudioPreset(presetId), [presetId])
  const localVideo = useLocalVideoSource()
  const livePhone = useLivePhoneSource()
  const screenMedia = sourceMode === 'live' ? livePhone.media : localVideo.media
  const sourceReady = screenMedia !== null
  const sourceStatus =
    sourceMode === 'live' && livePhone.screenStale
      ? 'stale'
      : sourceMode === 'live'
        ? livePhone.status
        : localVideo.status
  const sourceError =
    sourceMode === 'live' ? livePhone.error : localVideo.error
  const activeOrientation =
    sourceMode === 'live' ? livePhone.orientation : orientation
  const poseAccuracy =
    livePhone.poseDiagnostics && renderedPose
      ? buildPoseAccuracySnapshot(
          livePhone.poseDiagnostics.latestSensorRelative,
          livePhone.poseDiagnostics.targetQuaternion,
          renderedPose,
        )
      : null

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-cluster">
          <img className="brand-logo" src="/icon-192.png" alt="" />
          <div>
            <p className="eyebrow">Live iPhone input · local prototype</p>
            <h1>Phone 3D UI Studio</h1>
          </div>
        </div>
        <div className="status-cluster" aria-label="Source status">
          <span className="status-dot" aria-hidden="true" />
          <span>{sourceMode === 'live' ? 'Live device' : 'Local preview'}</span>
        </div>
      </header>

      <section className="workspace">
        <div className="viewport" aria-label="Interactive 3D phone viewport">
          <StudioScene
            preset={preset}
            animate={sourceMode === 'local' && animate}
            ambientMotion={ambientMotion}
            showGrid={showGrid}
            showAxes={showAxes}
            view={view}
            orientation={activeOrientation}
            screenMedia={screenMedia}
            livePoseRef={
              sourceMode === 'live' && livePhone.poseReady
                ? livePhone.poseRef
                : undefined
            }
            livePoseKinematicsRef={
              sourceMode === 'live' && livePhone.poseReady
                ? livePhone.ultraPoseKinematicsRef
                : undefined
            }
            livePoseSmoothingRate={
              POSE_SMOOTHING_RATE[livePhone.posePresentationMode]
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
            useTabletopStandard={sourceMode === 'live'}
          />
          <div className="viewport-label">
            <span>Preview 01</span>
            <span>
              {view === 'calibration' || view === 'hero'
                ? 'Drag to orbit · Scroll to zoom'
                : `${view} review`}
            </span>
          </div>
        </div>

        <aside className="inspector" aria-label="Studio controls">
          <section className="panel-section">
            <p className="section-kicker">Scene</p>
            <h2>Studio preset</h2>
            <div className="preset-grid">
              {studioPresets.map((item) => (
                <button
                  className={item.id === preset.id ? 'preset active' : 'preset'}
                  key={item.id}
                  onClick={() => setPresetId(item.id)}
                  type="button"
                  aria-pressed={item.id === preset.id}
                >
                  <span
                    className="swatch"
                    style={{
                      background: `linear-gradient(145deg, ${item.backgroundTop}, ${item.backgroundAccent} 58%, ${item.backgroundBottom})`,
                      color: item.fillColor,
                    }}
                  />
                  <span>{item.name}</span>
                </button>
              ))}
            </div>
            <div className="scene-toggle-grid" role="group" aria-label="Scene helpers">
              <button
                className={ambientMotion ? 'scene-toggle active' : 'scene-toggle'}
                type="button"
                aria-pressed={ambientMotion}
                onClick={() => setAmbientMotion((value) => !value)}
              >
                <span>Ambient motion</span>
                <span className="toggle-track" aria-hidden="true"><span /></span>
              </button>
              <button
                className={showGrid ? 'scene-toggle active' : 'scene-toggle'}
                type="button"
                aria-pressed={showGrid}
                onClick={() => setShowGrid((value) => !value)}
              >
                <span>Grid</span>
                <span className="toggle-track" aria-hidden="true"><span /></span>
              </button>
              <button
                className={showAxes ? 'scene-toggle active' : 'scene-toggle'}
                type="button"
                aria-pressed={showAxes}
                onClick={() => setShowAxes((value) => !value)}
              >
                <span>Axes</span>
                <span className="toggle-track" aria-hidden="true"><span /></span>
              </button>
            </div>
          </section>

          <section className="panel-section">
            <p className="section-kicker">Review camera</p>
            <h2>Model views</h2>
            <div className="view-switcher four-column" role="group" aria-label="Model review view">
              {([
                ['calibration', 'Calibration'],
                ['hero', 'Hero'],
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
                    setCameraResetRevision((value) => value + 1)
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="source-description">
              Calibration returns to the charging-port-level reference view.
            </p>
          </section>

          <section className="panel-section source-card">
            <div>
              <p className="section-kicker">Screen source</p>
              <h2>Isolated mesh</h2>
            </div>
            <span className={sourceReady ? 'chip ready' : 'chip'}>{sourceStatus}</span>
            <div className="view-switcher two-column" role="group" aria-label="Screen source mode">
              {(['local', 'live'] as const).map((item) => (
                <button
                  className={item === sourceMode ? 'view-button active' : 'view-button'}
                  key={item}
                  type="button"
                  aria-pressed={item === sourceMode}
                  onClick={() => setSourceMode(item)}
                >
                  {item === 'local' ? 'Local MP4' : 'Live iPhone'}
                </button>
              ))}
            </div>
            <p className="source-description">
              {sourceMode === 'local'
                ? 'The selected recording stays in browser memory and is never uploaded.'
                : 'The iPhone sends live frames over your local network through the bridge on port 4319.'}
            </p>
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
            ) : (
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
            )}
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
            ) : (
              <dl className="live-stats">
                <div><dt>Phone</dt><dd>{livePhone.stats.phones ? 'Connected' : 'Waiting'}</dd></div>
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
            )}
            {sourceMode === 'live' && livePhone.stats.codec === 'webrtc' && (
              <p className="source-description">
                Receive estimate covers jitter buffering, decode, and half RTT—not iPhone capture/encode or the final 3D paint.
              </p>
            )}
          </section>

          <section className="panel-section source-card">
            <div>
              <p className="section-kicker">Pose source</p>
              <h2>{sourceMode === 'live' ? 'Live device motion' : 'Simulated motion'}</h2>
            </div>
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
                      aria-label="90 degree pose check"
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
          </section>

          {sourceMode === 'live' && (
            <section className="panel-section source-card">
              <div>
                <p className="section-kicker">Latency measurement</p>
                <h2>Performance recording</h2>
              </div>
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
                  onClick={livePhone.startMeasurement}
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
            </section>
          )}

          <section className="panel-section metrics">
            <p className="section-kicker">Calibrated geometry</p>
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
          </section>
        </aside>
      </section>
    </main>
  )
}
