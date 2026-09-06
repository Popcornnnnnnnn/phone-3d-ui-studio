import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CanvasTexture,
  LinearFilter,
  SRGBColorSpace,
  VideoFrameTexture,
  type Texture,
} from 'three'
import type { ScreenOrientation } from '../model/iphone17'
import {
  summarizeLiveRenderSchedulerRun,
  type LiveRenderScheduler,
  type LiveRenderSchedulerSnapshot,
} from '../scene/liveRenderScheduler'
import type { PoseSample } from './contracts'
import {
  buildLiveMeasurementReport,
  captureContentIsVerifiedFresh,
  conservativeCaptureAtMacMs,
  highResolutionEpochNowMs,
  snapshotBrowserDecoderHealthCounters,
  summarizeBrowserDecoderHealth,
  type BrowserDecoderHealthCounters,
  type BrowserDecoderResetReason,
  type FrameMeasurementSample,
  type LiveMeasurementReport,
  type MeasurementConfigurationFingerprint,
  type PoseMeasurementSample,
  type PoseRenderMeasurementSample,
} from './liveMeasurement'
import {
  hasLiveFrameEnvelopeMagic,
  parseLiveFrameEnvelope,
} from './liveFrameEnvelope'
import {
  multiplyQuaternions,
  normalizeQuaternion,
  parseLiveTextMessage,
  relativeQuaternion,
  type BrowserBenchmarkPrepareMessage,
  type BrowserDecoderAcceleration,
  type BrowserDecoderMode,
  type CaptureState,
  type CaptureSource,
  type EncoderTuning,
  type FrameMetadataMessage,
  type H264BitstreamFormat,
  type LivePoseMessage,
  type QuaternionTuple,
  type ThermalState,
  type Vector3Tuple,
} from './liveProtocol'
import {
  quaternionAngularDistance,
  STANDARD_TABLETOP_QUATERNION,
} from './poseDiagnostics'
import {
  captureTimeToEpochMs,
  interpolatePoseAt,
  recordPoseSample,
  type TimedPoseQuaternion,
} from './poseTimeline'
import type { ScreenMedia } from './screenMedia'
import {
  type PosePresentationMode,
  usesVideoAlignedPose,
  usesPosePrediction,
} from './posePresentation'
import {
  studioRenderConfigurationFromSearch,
  type StudioRenderConfiguration,
} from './renderConfiguration'
import {
  predictQuaternion,
  ULTRA_REQUESTED_POSE_HZ,
} from './posePrediction'
import {
  deriveWebRTCReceiverMetrics,
  readWebRTCReceiverSample,
  rollingDecodedFps,
  type WebRTCReceiverSample,
} from './webRTCStats'
import { vp8OnlyCodecPreferences } from './webRTCCodecPreferences'

export type LivePhoneStatus = 'idle' | 'connecting' | 'ready' | 'error'
export type PoseSyncMode = 'live' | 'frame-clock' | 'estimated'
export type { PosePresentationMode } from './posePresentation'

export interface LivePhoneStats {
  browsers: number
  phones: number
  frames: number
  frameLatencyMs: number | null
  poseLatencyMs: number | null
  poseSyncDelayMs: number | null
  poseSyncErrorMs: number | null
  poseSyncMode: PoseSyncMode
  poseActualHz: number | null
  poseRequestedHz: number | null
  posePredictionMs: number | null
  posePredictionCorrectionDegrees: number | null
  poseArrivalGapP95Ms: number | null
  renderFps: number | null
  codec: 'jpeg' | 'h264' | 'webrtc' | null
  captureState: CaptureState | null
  capturedFrames: number
  webRTCCodecMimeType: string | null
  webRTCBitrateMbps: number | null
  webRTCDecodeMs: number | null
  webRTCFps: number | null
  webRTCFramesDropped: number
  webRTCJitterBufferMs: number | null
  webRTCJitterMinimumMs: number | null
  webRTCJitterTargetMs: number | null
  webRTCPacketLossPercent: number | null
  webRTCRoundTripMs: number | null
}

export interface LiveFrameRenderSignal {
  frameId: number
  schedulerGeneration: number
  renderRequestedAtMs: number
  texture: Texture
}

export interface LivePoseDiagnostics {
  latestSensorRelative: QuaternionTuple
  targetQuaternion: QuaternionTuple
  sampledAtMs: number
}

export interface LivePoseKinematics {
  quaternion: QuaternionTuple
  rotationRate: Vector3Tuple
  sampledAtMacMs: number
  receivedAtMacMs: number
}

export interface PoseRenderDiagnostics {
  predictionMs: number | null
  renderFps: number
}

export interface LiveMeasurementState {
  status: 'idle' | 'running' | 'complete'
  elapsedMs: number
  receivedFrames: number
  renderedFrames: number
  poseSamples: number
  poseRenderSamples: number
  report: LiveMeasurementReport | null
}

interface ActiveMeasurement {
  startedAtMs: number
  runId: string | null
  configuration: MeasurementConfigurationFingerprint
  frames: Map<number, FrameMeasurementSample>
  poses: PoseMeasurementSample[]
  poseRenders: PoseRenderMeasurementSample[]
  droppedBeforeDecode: number
  decoderHealthStarted: BrowserDecoderHealthCounters | null
  renderSchedulerStarted: LiveRenderSchedulerSnapshot
}

interface EncoderMeasurementConfiguration {
  targetFps: number | null
  encoderProfile: 'legacy' | 'low-latency' | null
  encoderTuningRequested: EncoderTuning
  encoderTuningActive: EncoderTuning | null
  producerSessionId: string | null
  captureSource: CaptureSource | null
  captureShortEdgeRequested: number | null
  captureShortEdgeActive: number | null
  captureWidthActive: number | null
  captureHeightActive: number | null
  captureStreamGeneration: number | null
  thermalState: ThermalState | null
  frameAckWindow: 1 | 2 | 3 | null
}

const thermalStateOrder: readonly ThermalState[] = [
  'nominal',
  'fair',
  'serious',
  'critical',
]

export function worstObservedThermalState(
  current: ThermalState | null,
  observed: ThermalState | null,
) {
  if (observed === null) return current
  if (current === null) return observed
  return thermalStateOrder.indexOf(observed) > thermalStateOrder.indexOf(current)
    ? observed
    : current
}

function updateMeasurementThermalState(
  active: ActiveMeasurement | null,
  observed: ThermalState | null,
  phase: 'heartbeat' | 'completed' = 'heartbeat',
) {
  if (!active || observed === null) return
  const parameters = active.configuration.parameters
  if (phase === 'completed') parameters.thermalStateEnd = observed
  const current =
    typeof parameters.thermalStateWorstObserved === 'string'
      ? (parameters.thermalStateWorstObserved as ThermalState)
      : null
  const worst = worstObservedThermalState(current, observed)
  parameters.thermalStateWorstObserved = worst
  parameters.thermalContaminated =
    worst === 'serious' || worst === 'critical'
}

interface BrowserDecoderRuntimeConfiguration {
  browserConfigId: string | null
  generation: number
  requestedMode: BrowserDecoderMode
  appliedMode: BrowserDecoderMode
  configuredAcceleration: BrowserDecoderAcceleration
  prepareDurationMs: number | null
}

interface PendingBrowserPrepare {
  runId: string
  browserConfigId: string
  generation: number
  decoderMode: BrowserDecoderMode
  decoderAcceleration: BrowserDecoderAcceleration
  requestedAtMs: number
}

export function browserPrepareReadyAck(
  pending: PendingBrowserPrepare | null,
  runtime: BrowserDecoderRuntimeConfiguration,
  frameId: number,
  renderedGeneration: number | undefined,
  renderedAtMs: number,
) {
  if (
    !pending ||
    renderedGeneration !== pending.generation ||
    runtime.generation !== pending.generation ||
    runtime.browserConfigId !== pending.browserConfigId
  ) {
    return null
  }
  const prepareDurationMs = Math.max(0, renderedAtMs - pending.requestedAtMs)
  return {
    type: 'browser-benchmark-prepare-ack' as const,
    status: 'ready' as const,
    runId: pending.runId,
    browserConfigId: pending.browserConfigId,
    browserConfigGeneration: pending.generation,
    decoderModeRequested: pending.decoderMode,
    decoderModeApplied: runtime.appliedMode,
    decoderAccelerationConfigured: runtime.configuredAcceleration,
    renderedFrameId: frameId,
    preparedAtMs: renderedAtMs,
    prepareDurationMs,
  }
}

function measurementProducerMatches(
  active: ActiveMeasurement,
  producerSessionId: string | null,
  captureSource: CaptureSource | null,
) {
  if (!active.runId) return true
  return (
    producerSessionId !== null &&
    captureSource !== null &&
    active.configuration.parameters.producerSessionId === producerSessionId &&
    active.configuration.parameters.captureSource === captureSource
  )
}

interface PendingFrame {
  bytes: Uint8Array<ArrayBuffer>
  metadata: FrameMetadataMessage | null
  browserReceivedAtMs: number
}

interface PendingTextureUpload<T> {
  frameId: number
  source: T
}

export function currentTextureUploadFrameId<T>(
  pending: PendingTextureUpload<T> | null,
  currentSource: T | null,
  textureSource: unknown,
) {
  return pending && pending.source === currentSource && currentSource === textureSource
    ? pending.frameId
    : null
}

interface CurrentValueRef<T> {
  current: T
}

export function commitStateIfChanged<T>(
  currentRef: CurrentValueRef<T>,
  next: T,
  commit: (value: T) => void,
  equals: (current: T, next: T) => boolean = Object.is,
) {
  if (equals(currentRef.current, next)) return false
  currentRef.current = next
  commit(next)
  return true
}

function sameScreenMedia(current: ScreenMedia | null, next: ScreenMedia | null) {
  if (current === next) return true
  if (!current || !next || current.kind !== next.kind) return false
  if (
    current.name !== next.name ||
    current.width !== next.width ||
    current.height !== next.height
  ) {
    return false
  }
  return current.kind === 'texture' && next.kind === 'texture'
    ? current.texture === next.texture
    : current.kind === 'video' &&
        next.kind === 'video' &&
        current.element === next.element
}

function useDeduplicatedState<T>(
  initialValue: T,
  equals: (current: T, next: T) => boolean = Object.is,
) {
  const [value, setValue] = useState(initialValue)
  const currentRef = useRef(value)
  const commit = useCallback(
    (next: T) => commitStateIfChanged(currentRef, next, setValue, equals),
    [equals],
  )
  return [value, commit, currentRef] as const
}

export type H264DecoderMode = BrowserDecoderMode
export type H264DecoderResetReason = BrowserDecoderResetReason

export interface H264DecoderSelection {
  mode: H264DecoderMode
  hardwareAcceleration: HardwareAcceleration
}

export interface H264DecoderDiagnostics {
  resets: number
  errors: number
  resetReasons: Record<H264DecoderResetReason, number>
  lastResetReason: H264DecoderResetReason | null
}

export interface H264DecoderBacklogPolicy {
  name: 'default' | 'hardware-avcc' | 'transport-window-3'
  maxQueueSize: number
  maxPendingFrames: number
  maxFrameAgeMs: number
}

const DEFAULT_H264_DECODER_BACKLOG_POLICY: H264DecoderBacklogPolicy = {
  name: 'default',
  maxQueueSize: 2,
  maxPendingFrames: 2,
  maxFrameAgeMs: 75,
}
// Three in-flight source frames can arrive together after Wi-Fi scheduling.
// Keep the same age deadline, but do not reset a healthy dependency chain
// merely because its third frame arrives before the first decode callback.
const WINDOW_THREE_H264_DECODER_BACKLOG_POLICY: H264DecoderBacklogPolicy = {
  name: 'transport-window-3',
  maxQueueSize: 3,
  maxPendingFrames: 3,
  maxFrameAgeMs: 75,
}
// A hardware decoder may retain several submitted frames while its pipeline
// starts, even when the stream has no B-frames. Resetting after two frames
// prevents the first output from ever arriving. This window is deliberately
// bounded: at 30 fps it permits startup, but a 250 ms output stall still
// discards the dependency chain and requests a fresh IDR.
const HARDWARE_AVCC_DECODER_BACKLOG_POLICY: H264DecoderBacklogPolicy = {
  name: 'hardware-avcc',
  maxQueueSize: 8,
  maxPendingFrames: 8,
  maxFrameAgeMs: 250,
}
const H264_DECODER_REJECTED_ERROR =
  'The browser H.264 decoder rejected the live stream.'
const LIVE_FRAME_DECODE_ERROR =
  'The live bridge sent a frame this browser could not decode.'

const DEFAULT_H264_DECODER_SELECTION: H264DecoderSelection = {
  mode: 'software',
  hardwareAcceleration: 'prefer-software',
}
const DEFAULT_H264_BITSTREAM_FORMAT: H264BitstreamFormat = 'annex-b'

export function h264DecoderSelectionFromSearch(
  search: string,
): H264DecoderSelection {
  const requestedMode = new URLSearchParams(search).get('decoder')
  if (requestedMode === 'hardware') {
    return { mode: requestedMode, hardwareAcceleration: 'prefer-hardware' }
  }
  if (requestedMode === 'auto') {
    return { mode: requestedMode, hardwareAcceleration: 'no-preference' }
  }
  return DEFAULT_H264_DECODER_SELECTION
}

export function h264BitstreamFormatFromSearch(
  search: string,
): H264BitstreamFormat {
  const parameters = new URLSearchParams(search)
  const requestedFormat = parameters.get('h264')
  if (requestedFormat === 'annex-b' || requestedFormat === 'avcc') {
    return requestedFormat
  }
  return parameters.get('decoder') === 'hardware'
    ? 'avcc'
    : DEFAULT_H264_BITSTREAM_FORMAT
}

export function sendH264FormatAfterReceiverStatus(
  sendReceiverStatus: () => void,
  sendOutputFormat: () => void,
) {
  // Both sends use the same pose WebSocket, so this call order is also the
  // bridge receive order. The status can acquire the browser lease before the
  // bridge validates the client-scoped format command.
  sendReceiverStatus()
  sendOutputFormat()
}

export function browserReceiverStatusHeartbeatDue(
  nowMs: number,
  lastSentAtMs: number | null,
  minimumIntervalMs = 1_000,
) {
  if (!Number.isFinite(nowMs) || minimumIntervalMs <= 0) return false
  return (
    lastSentAtMs === null ||
    !Number.isFinite(lastSentAtMs) ||
    nowMs < lastSentAtMs ||
    nowMs - lastSentAtMs >= minimumIntervalMs
  )
}

export function decodeH264DecoderDescription(
  descriptionBase64: string | null,
) {
  if (!descriptionBase64 || descriptionBase64.length > 16 * 1024) return null
  try {
    const binary = globalThis.atob(descriptionBase64)
    const description = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      description[index] = binary.charCodeAt(index)
    }
    return description.length >= 7 && description[0] === 1
      ? description
      : null
  } catch {
    return null
  }
}

export function buildH264DecoderConfig(
  codec: string,
  decoderSelection: H264DecoderSelection,
  bitstreamFormat: H264BitstreamFormat,
  descriptionBase64: string | null,
): VideoDecoderConfig | null {
  const configuration: VideoDecoderConfig = {
    codec,
    optimizeForLatency: true,
    hardwareAcceleration: decoderSelection.hardwareAcceleration,
  }
  if (bitstreamFormat === 'annex-b') return configuration

  const description = decodeH264DecoderDescription(descriptionBase64)
  return description ? { ...configuration, description } : null
}

export function h264DecoderBacklogPolicy(
  decoderSelection: H264DecoderSelection,
  bitstreamFormat: H264BitstreamFormat,
  frameAckWindow: number | null = null,
): H264DecoderBacklogPolicy {
  return decoderSelection.hardwareAcceleration === 'prefer-hardware' &&
    bitstreamFormat === 'avcc'
    ? HARDWARE_AVCC_DECODER_BACKLOG_POLICY
    : frameAckWindow === 3
      ? WINDOW_THREE_H264_DECODER_BACKLOG_POLICY
      : DEFAULT_H264_DECODER_BACKLOG_POLICY
}

export function h264DecoderConfigurationKey(
  codec: string,
  bitstreamFormat: H264BitstreamFormat,
  descriptionBase64: string | null,
  decoderSelection: H264DecoderSelection,
  browserConfigGeneration: number,
) {
  return [
    codec,
    bitstreamFormat,
    descriptionBase64 ?? '',
    decoderSelection.hardwareAcceleration,
    browserConfigGeneration,
  ].join('|')
}

export function buildH264MeasurementConfiguration({
  decoderSelection,
  bitstreamFormat = DEFAULT_H264_BITSTREAM_FORMAT,
  devicePixelRatio,
  renderConfiguration,
  sourceTargetFps = 30,
  encoderProfile = 'low-latency',
  encoderTuning = 'default',
  encoderTuningRequested = encoderTuning,
  browserConfigId = null,
  browserConfigGeneration = 1,
  browserPrepareDurationMs = null,
  decoderModeRequested = decoderSelection.mode,
  decoderModeApplied = decoderSelection.mode,
  captureShortEdgeRequested = null,
  captureShortEdgeActive = null,
  captureWidthActive = null,
  captureHeightActive = null,
  captureStreamGeneration = null,
  thermalStateStart = null,
  thermalStateEnd = null,
  thermalStateWorstObserved = thermalStateStart,
  thermalContaminated =
    thermalStateWorstObserved === 'serious' ||
    thermalStateWorstObserved === 'critical',
  producerSessionId = null,
  captureSource = null,
  renderSchedulerModeApplied,
  renderSchedulerGeneration = 1,
  frameAckWindow = null,
}: {
  decoderSelection: H264DecoderSelection
  bitstreamFormat?: H264BitstreamFormat
  devicePixelRatio?: number
  renderConfiguration?: StudioRenderConfiguration
  sourceTargetFps?: number
  encoderProfile?: 'legacy' | 'low-latency'
  encoderTuning?: EncoderTuning
  encoderTuningRequested?: EncoderTuning
  browserConfigId?: string | null
  browserConfigGeneration?: number
  browserPrepareDurationMs?: number | null
  decoderModeRequested?: BrowserDecoderMode
  decoderModeApplied?: BrowserDecoderMode
  captureShortEdgeRequested?: number | null
  captureShortEdgeActive?: number | null
  captureWidthActive?: number | null
  captureHeightActive?: number | null
  captureStreamGeneration?: number | null
  thermalStateStart?: ThermalState | null
  thermalStateEnd?: ThermalState | null
  thermalStateWorstObserved?: ThermalState | null
  thermalContaminated?: boolean
  producerSessionId?: string | null
  captureSource?: CaptureSource | null
  renderSchedulerModeApplied?: StudioRenderConfiguration['renderScheduleMode']
  renderSchedulerGeneration?: number
  frameAckWindow?: 1 | 2 | 3 | null
}): MeasurementConfigurationFingerprint {
  const backlogPolicy = h264DecoderBacklogPolicy(
    decoderSelection,
    bitstreamFormat,
    frameAckWindow,
  )
  const activeRenderConfiguration =
    renderConfiguration ??
    studioRenderConfigurationFromSearch('', devicePixelRatio ?? 1)
  const canvasShadowMode =
    activeRenderConfiguration.canvasShadows === false
      ? 'disabled'
      : activeRenderConfiguration.canvasShadows
  const dprPolicy = Array.isArray(activeRenderConfiguration.canvasDpr)
    ? `clamp-${activeRenderConfiguration.canvasDpr[0]}-${activeRenderConfiguration.canvasDpr[1]}`
    : `fixed-${activeRenderConfiguration.canvasDpr}`
  const activeRenderSchedulerMode =
    renderSchedulerModeApplied ?? activeRenderConfiguration.renderScheduleMode
  const parameters = {
    bridgeEnvelope: 'P3D1',
    browserDevicePixelRatio:
      activeRenderConfiguration.browserDevicePixelRatio,
    decoderAcceleration: decoderSelection.hardwareAcceleration,
    decoderAccelerationConfigured: decoderSelection.hardwareAcceleration,
    decoderBacklogPolicy: backlogPolicy.name,
    frameAckWindow,
    decoderMaxFrameAgeMs: backlogPolicy.maxFrameAgeMs,
    decoderMaxPendingFrames: backlogPolicy.maxPendingFrames,
    decoderMaxQueueSize: backlogPolicy.maxQueueSize,
    decoderMode: decoderSelection.mode,
    decoderModeRequested,
    decoderModeApplied,
    browserConfigId,
    browserConfigGeneration,
    browserPrepareDurationMs,
    captureShortEdgeRequested,
    captureShortEdgeActive,
    captureWidthActive,
    captureHeightActive,
    captureStreamGeneration,
    thermalStateStart,
    thermalStateEnd,
    thermalStateWorstObserved,
    thermalContaminated,
    devicePixelRatio: activeRenderConfiguration.browserDevicePixelRatio,
    encoderProfile,
    encoderTuning,
    encoderTuningRequested,
    producerSessionId,
    captureSource,
    h264Codec: 'metadata-derived',
    h264BitstreamFormatRequested: bitstreamFormat,
    h264OptimizeForLatency: true,
    renderAntialias: activeRenderConfiguration.antialias,
    renderCanvasShadows: canvasShadowMode,
    renderDevicePixelRatio: activeRenderConfiguration.effectiveDpr,
    renderDprPolicy: dprPolicy,
    renderPowerPreference: activeRenderConfiguration.powerPreference,
    renderPreset: activeRenderConfiguration.preset,
    renderSchedulerCapHz: activeRenderConfiguration.renderScheduleCapHz,
    renderSchedulerGeneration,
    renderSchedulerModeApplied: activeRenderSchedulerMode,
    renderSchedulerModeRequested:
      activeRenderConfiguration.renderScheduleMode,
    renderSchedulerPhaseCreditFrames:
      activeRenderConfiguration.renderSchedulePhaseCreditFrames,
    renderSoftShadows: activeRenderConfiguration.softShadows,
    sourceTargetFps,
    transportAckPacing: 'phone-raw-tcp-nodelay-p3d1-ack-window1-v4',
    videoTexture: 'VideoFrameTexture',
  }
  return {
    fingerprint: `rawtcp-nodelay-w${frameAckWindow ?? 'unknown'}-h264-${encoderProfile}-tuning${encoderTuning}-requested${encoderTuningRequested}-${bitstreamFormat}-${decoderModeRequested}-${decoderModeApplied}-${decoderSelection.hardwareAcceleration}-bc${browserConfigId ?? 'manual'}-bg${browserConfigGeneration}-capture${captureShortEdgeRequested ?? 'unknown'}-active${captureShortEdgeActive ?? 'unknown'}-${captureWidthActive ?? 'unknown'}x${captureHeightActive ?? 'unknown'}-generation${captureStreamGeneration ?? 'unknown'}-fps${sourceTargetFps}-q${backlogPolicy.maxQueueSize}-p${backlogPolicy.maxPendingFrames}-a${backlogPolicy.maxFrameAgeMs}-render${activeRenderConfiguration.preset}-dpr${activeRenderConfiguration.effectiveDpr}-aa${activeRenderConfiguration.antialias ? 1 : 0}-shadow${canvasShadowMode}-soft${activeRenderConfiguration.softShadows ? 1 : 0}-schedule${activeRenderConfiguration.renderScheduleMode}-${activeRenderSchedulerMode}-sg${renderSchedulerGeneration}-cap${activeRenderConfiguration.renderScheduleCapHz ?? 'native'}-credit${activeRenderConfiguration.renderSchedulePhaseCreditFrames}-source${captureSource ?? 'unknown'}-session${producerSessionId ?? 'unknown'}`,
    parameters,
  }
}

export function h264DecoderBacklogResetReason(
  decodeQueueSize: number,
  pendingFrames: number,
  oldestPendingFrameAgeMs: number,
  policy: H264DecoderBacklogPolicy = DEFAULT_H264_DECODER_BACKLOG_POLICY,
): Exclude<H264DecoderResetReason, 'configuration' | 'error'> | null {
  if (decodeQueueSize >= policy.maxQueueSize) return 'queue'
  if (pendingFrames >= policy.maxPendingFrames) return 'pending'
  if (oldestPendingFrameAgeMs > policy.maxFrameAgeMs) return 'age'
  return null
}

export function initialH264DecoderDiagnostics(): H264DecoderDiagnostics {
  return {
    resets: 0,
    errors: 0,
    resetReasons: {
      queue: 0,
      pending: 0,
      age: 0,
      configuration: 0,
      error: 0,
    },
    lastResetReason: null,
  }
}

export function recordH264DecoderReset(
  current: H264DecoderDiagnostics,
  reason: H264DecoderResetReason,
): H264DecoderDiagnostics {
  return {
    resets: current.resets + 1,
    errors: current.errors + (reason === 'error' ? 1 : 0),
    resetReasons: {
      ...current.resetReasons,
      [reason]: current.resetReasons[reason] + 1,
    },
    lastResetReason: reason,
  }
}

export function liveFrameErrorAfterSuccessfulDecode(
  currentError: string | null,
) {
  if (
    currentError === H264_DECODER_REJECTED_ERROR ||
    currentError === LIVE_FRAME_DECODE_ERROR
  ) {
    return null
  }
  return currentError
}

export function nextValidFrameLatencyMs(
  currentLatencyMs: number | null,
  decodedAtMs: number,
  captureAtMacMs: number | null,
) {
  if (captureAtMacMs === null) return currentLatencyMs
  const latencyMs = decodedAtMs - captureAtMacMs
  return Number.isFinite(latencyMs) && latencyMs >= 0
    ? latencyMs
    : currentLatencyMs
}

const initialStats: LivePhoneStats = {
  browsers: 0,
  phones: 0,
  frames: 0,
  frameLatencyMs: null,
  poseLatencyMs: null,
  poseSyncDelayMs: null,
  poseSyncErrorMs: null,
  poseSyncMode: 'live',
  poseActualHz: null,
  poseRequestedHz: null,
  posePredictionMs: null,
  posePredictionCorrectionDegrees: null,
  poseArrivalGapP95Ms: null,
  renderFps: null,
  codec: null,
  captureState: null,
  capturedFrames: 0,
  webRTCCodecMimeType: null,
  webRTCBitrateMbps: null,
  webRTCDecodeMs: null,
  webRTCFps: null,
  webRTCFramesDropped: 0,
  webRTCJitterBufferMs: null,
  webRTCJitterMinimumMs: null,
  webRTCJitterTargetMs: null,
  webRTCPacketLossPercent: null,
  webRTCRoundTripMs: null,
}

export function bridgeReconnectDelayMs(attempt: number) {
  return Math.min(5_000, 250 * 2 ** Math.max(0, attempt))
}

export function screenStreamIsStale(
  nowMs: number,
  lastFrameAtMs: number | null,
  lastCaptureHeartbeatAtMs: number | null,
  firstCaptureHeartbeatAtMs: number | null = lastCaptureHeartbeatAtMs,
) {
  // Once pixels have arrived, only pixel freshness can prove that the screen
  // is still moving through the complete pipeline. An encoder heartbeat can
  // stay healthy while transport, decode, or texture presentation is frozen.
  if (lastFrameAtMs !== null) return nowMs - lastFrameAtMs > 1_000
  if (firstCaptureHeartbeatAtMs !== null) {
    return nowMs - firstCaptureHeartbeatAtMs > 2_500
  }
  return false
}

const initialMeasurement: LiveMeasurementState = {
  status: 'idle',
  elapsedMs: 0,
  receivedFrames: 0,
  renderedFrames: 0,
  poseSamples: 0,
  poseRenderSamples: 0,
  report: null,
}

function tabletopQuaternion(
  reference: QuaternionTuple,
  current: QuaternionTuple,
) {
  return normalizeQuaternion(
    multiplyQuaternions(
      STANDARD_TABLETOP_QUATERNION,
      relativeQuaternion(reference, current),
    ),
  )
}

function phoneTimeOnMac(phoneTimestampMs: number, clockOffsetMs: number | null) {
  return clockOffsetMs === null ? null : phoneTimestampMs + clockOffsetMs
}

function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * percentileValue) - 1),
  )
  return sorted[index]
}

let cachedBrowserClientId: string | null = null
const browserClientIdSessionKey = 'phone-3d-ui-studio.browser-client-id'

export interface BrowserClientIdStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

export function browserClientIdForSession(
  storage: BrowserClientIdStorage,
  createId: () => string,
) {
  try {
    const stored = storage.getItem(browserClientIdSessionKey)
    if (stored && stored.length <= 128) return stored
    const created = createId()
    storage.setItem(browserClientIdSessionKey, created)
    return created
  } catch {
    return createId()
  }
}

function getBrowserClientId() {
  cachedBrowserClientId ??= browserClientIdForSession(
    window.sessionStorage,
    () => window.crypto.randomUUID(),
  )
  return cachedBrowserClientId
}

function browserBridgeUrl(role: string) {
  const query = new URLSearchParams({ role, clientId: getBrowserClientId() })
  return `ws://${window.location.hostname}:4319/?${query}`
}

export function getDefaultBridgeUrl() {
  return browserBridgeUrl('browser')
}

export function getPoseBridgeUrl() {
  return browserBridgeUrl('browser-pose')
}

export function getWebRTCBridgeUrl() {
  return browserBridgeUrl('browser-webrtc')
}

export function useLivePhoneSource(
  renderConfiguration: StudioRenderConfiguration,
  liveRenderScheduler: LiveRenderScheduler,
) {
  const socketRef = useRef<WebSocket | null>(null)
  const poseSocketRef = useRef<WebSocket | null>(null)
  const webRTCSignalRef = useRef<WebSocket | null>(null)
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null)
  const webRTCVideoRef = useRef<HTMLVideoElement | null>(null)
  const webRTCFrameRequestRef = useRef<number | null>(null)
  const webRTCStatsTimerRef = useRef<number | null>(null)
  const textureRef = useRef<CanvasTexture | null>(null)
  const videoFrameTextureRef = useRef<VideoFrameTexture | null>(null)
  const decodedVideoFrameRef = useRef<VideoFrame | null>(null)
  const videoDecoderRef = useRef<VideoDecoder | null>(null)
  const rawPoseRef = useRef<QuaternionTuple | null>(null)
  const poseHistoryRef = useRef<TimedPoseQuaternion[]>([])
  const zeroPoseRef = useRef<QuaternionTuple | null>(null)
  const poseRef = useRef<PoseSample | null>(null)
  const ultraPoseKinematicsRef = useRef<LivePoseKinematics | null>(null)
  const previousUltraPoseKinematicsRef =
    useRef<LivePoseKinematics | null>(null)
  const posePresentationModeRef =
    useRef<PosePresentationMode>('synchronized')
  const liveFrameRenderRef = useRef<LiveFrameRenderSignal | null>(null)
  const lastFrameReceivedRef = useRef<number | null>(null)
  const lastFrameRenderedRef = useRef<number | null>(null)
  const lastReceiverStatusSentAtRef = useRef<number | null>(null)
  const lastPoseReceivedRef = useRef<number | null>(null)
  const lastCaptureHeartbeatRef = useRef<number | null>(null)
  const firstCaptureHeartbeatRef = useRef<number | null>(null)
  const shouldReconnectRef = useRef(false)
  const reconnectAttemptRef = useRef(0)
  const reconnectTimerRef = useRef<number | null>(null)
  const connectRef = useRef<() => void>(() => {})
  const receiverStatusSenderRef = useRef<() => void>(() => {})
  const h264DecoderSelectionRef = useRef<H264DecoderSelection>(
    DEFAULT_H264_DECODER_SELECTION,
  )
  const h264BitstreamFormatRef = useRef<H264BitstreamFormat>(
    DEFAULT_H264_BITSTREAM_FORMAT,
  )
  const browserDecoderRuntimeRef = useRef<BrowserDecoderRuntimeConfiguration>({
    browserConfigId: null,
    generation: 1,
    requestedMode: DEFAULT_H264_DECODER_SELECTION.mode,
    appliedMode: DEFAULT_H264_DECODER_SELECTION.mode,
    configuredAcceleration:
      DEFAULT_H264_DECODER_SELECTION.hardwareAcceleration,
    prepareDurationMs: null,
  })
  const pendingBrowserPrepareRef = useRef<PendingBrowserPrepare | null>(null)
  const decodedFrameGenerationRef = useRef(new Map<number, number>())
  const activeMeasurementRef = useRef<ActiveMeasurement | null>(null)
  const browserDecoderHealthCountersRef =
    useRef<BrowserDecoderHealthCounters | null>(null)
  const encoderMeasurementConfigurationRef =
    useRef<EncoderMeasurementConfiguration>({
      targetFps: null,
      encoderProfile: null,
      encoderTuningRequested: 'default',
      encoderTuningActive: null,
      producerSessionId: null,
      captureSource: null,
      captureShortEdgeRequested: null,
      captureShortEdgeActive: null,
      captureWidthActive: null,
      captureHeightActive: null,
      captureStreamGeneration: null,
      thermalState: null,
      frameAckWindow: null,
    })
  const [media, commitMedia] = useDeduplicatedState<ScreenMedia | null>(
    null,
    sameScreenMedia,
  )
  const [orientation, commitOrientation] =
    useDeduplicatedState<ScreenOrientation>('portrait')
  const [poseReady, setPoseReady] = useState(false)
  const [hasManualLevel, setHasManualLevel] = useState(false)
  const [screenStale, commitScreenStale] = useDeduplicatedState(false)
  const [poseStale, setPoseStale] = useState(false)
  const [posePresentationMode, setPosePresentationModeState] =
    useState<PosePresentationMode>('synchronized')
  const [poseDiagnostics, setPoseDiagnostics] =
    useState<LivePoseDiagnostics | null>(null)
  const [status, commitStatus] = useDeduplicatedState<LivePhoneStatus>('idle')
  const [error, commitError, currentErrorRef] =
    useDeduplicatedState<string | null>(null)
  const [stats, setStats] = useState<LivePhoneStats>(initialStats)
  const [measurement, setMeasurement] =
    useState<LiveMeasurementState>(initialMeasurement)

  const releaseResources = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    const socket = socketRef.current
    socketRef.current = null
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000)
    const poseSocket = poseSocketRef.current
    poseSocketRef.current = null
    if (poseSocket && poseSocket.readyState < WebSocket.CLOSING) {
      poseSocket.close(1000)
    }
    const signalSocket = webRTCSignalRef.current
    webRTCSignalRef.current = null
    if (signalSocket && signalSocket.readyState < WebSocket.CLOSING) {
      signalSocket.close(1000)
    }
    peerConnectionRef.current?.close()
    peerConnectionRef.current = null
    const webRTCVideo = webRTCVideoRef.current
    if (webRTCVideo && webRTCFrameRequestRef.current !== null) {
      webRTCVideo.cancelVideoFrameCallback(webRTCFrameRequestRef.current)
    }
    webRTCFrameRequestRef.current = null
    if (webRTCStatsTimerRef.current !== null) {
      window.clearInterval(webRTCStatsTimerRef.current)
      webRTCStatsTimerRef.current = null
    }
    if (webRTCVideo) {
      webRTCVideo.pause()
      webRTCVideo.srcObject = null
    }
    webRTCVideoRef.current = null

    textureRef.current?.dispose()
    textureRef.current = null
    videoFrameTextureRef.current?.dispose()
    videoFrameTextureRef.current = null
    decodedVideoFrameRef.current?.close()
    decodedVideoFrameRef.current = null
    if (videoDecoderRef.current?.state !== 'closed') {
      videoDecoderRef.current?.close()
    }
    videoDecoderRef.current = null
    rawPoseRef.current = null
    poseHistoryRef.current = []
    zeroPoseRef.current = null
    poseRef.current = null
    ultraPoseKinematicsRef.current = null
    previousUltraPoseKinematicsRef.current = null
    liveFrameRenderRef.current = null
    lastFrameReceivedRef.current = null
    lastFrameRenderedRef.current = null
    pendingBrowserPrepareRef.current = null
    decodedFrameGenerationRef.current.clear()
    browserDecoderHealthCountersRef.current = null
    lastReceiverStatusSentAtRef.current = null
    lastPoseReceivedRef.current = null
    lastCaptureHeartbeatRef.current = null
    firstCaptureHeartbeatRef.current = null
    receiverStatusSenderRef.current = () => {}
  }, [])

  const finalizeMeasurement = useCallback((publishBenchmarkReport: boolean) => {
    const active = activeMeasurementRef.current
    if (!active) return
    activeMeasurementRef.current = null
    const endedAtMs = highResolutionEpochNowMs()
    const frames = [...active.frames.values()]
    const report = buildLiveMeasurementReport(
      active.startedAtMs,
      endedAtMs,
      frames,
      active.poses,
      active.poseRenders,
      active.droppedBeforeDecode,
      {
        runId: active.runId ?? undefined,
        configuration: active.configuration,
        decoderHealth: summarizeBrowserDecoderHealth(
          active.decoderHealthStarted,
          browserDecoderHealthCountersRef.current,
        ),
        renderScheduler: summarizeLiveRenderSchedulerRun(
          active.renderSchedulerStarted,
          liveRenderScheduler.snapshot(),
        ),
      },
    )
    const reportSocket = poseSocketRef.current
    if (
      publishBenchmarkReport &&
      active.runId &&
      reportSocket?.readyState === WebSocket.OPEN
    ) {
      reportSocket.send(
        JSON.stringify({
          type: 'browser-benchmark-report',
          runId: active.runId,
          report,
        }),
      )
    }
    setMeasurement({
      status: 'complete',
      elapsedMs: endedAtMs - active.startedAtMs,
      receivedFrames: frames.length,
      renderedFrames: report.screen.renderedFrames,
      poseSamples: active.poses.length,
      poseRenderSamples: active.poseRenders.length,
      report,
    })
  }, [liveRenderScheduler])

  const cancelMeasurement = useCallback((reason: string, notifyBridge = true) => {
    const active = activeMeasurementRef.current
    if (!active) return
    activeMeasurementRef.current = null
    const reportSocket = poseSocketRef.current
    if (
      notifyBridge &&
      active.runId &&
      reportSocket?.readyState === WebSocket.OPEN
    ) {
      reportSocket.send(
        JSON.stringify({
          type: 'browser-benchmark-cancel',
          runId: active.runId,
          reason,
        }),
      )
    }
    setMeasurement(initialMeasurement)
  }, [])

  const finishMeasurement = useCallback(() => {
    if (activeMeasurementRef.current?.runId) {
      cancelMeasurement('manual-stop')
      return
    }
    finalizeMeasurement(false)
  }, [cancelMeasurement, finalizeMeasurement])

  const completeBenchmarkMeasurement = useCallback(
    (runId: string) => {
      if (activeMeasurementRef.current?.runId !== runId) return
      finalizeMeasurement(true)
    },
    [finalizeMeasurement],
  )

  const startMeasurement = useCallback((
    runId?: string,
    sourceTargetFps?: number,
    encoderProfile?: 'legacy' | 'low-latency',
    encoderTuningRequested?: EncoderTuning,
    encoderTuningActive?: EncoderTuning,
    producerSessionId?: string | null,
    captureSource?: CaptureSource | null,
    captureShortEdgeRequested?: number | null,
    captureShortEdgeActive?: number | null,
    captureWidthActive?: number | null,
    captureHeightActive?: number | null,
    captureStreamGeneration?: number | null,
    thermalStateStart?: ThermalState | null,
  ) => {
    if (runId && activeMeasurementRef.current?.runId === runId) return
    const startedAtMs = highResolutionEpochNowMs()
    const latestEncoderConfiguration = encoderMeasurementConfigurationRef.current
    const browserConfiguration = browserDecoderRuntimeRef.current
    const renderScheduler = liveRenderScheduler.snapshot()
    activeMeasurementRef.current = {
      startedAtMs,
      runId: runId ?? null,
      configuration: buildH264MeasurementConfiguration({
        decoderSelection: h264DecoderSelectionRef.current,
        bitstreamFormat: h264BitstreamFormatRef.current,
        renderConfiguration,
        renderSchedulerModeApplied: renderScheduler.mode,
        renderSchedulerGeneration: renderScheduler.generation,
        browserConfigId: browserConfiguration.browserConfigId,
        browserConfigGeneration: browserConfiguration.generation,
        browserPrepareDurationMs: browserConfiguration.prepareDurationMs,
        decoderModeRequested: browserConfiguration.requestedMode,
        decoderModeApplied: browserConfiguration.appliedMode,
        frameAckWindow: latestEncoderConfiguration.frameAckWindow,
        sourceTargetFps:
          sourceTargetFps ?? latestEncoderConfiguration.targetFps ?? 30,
        encoderProfile:
          encoderProfile ??
          latestEncoderConfiguration.encoderProfile ??
          'low-latency',
        encoderTuning:
          encoderTuningActive ??
          latestEncoderConfiguration.encoderTuningActive ??
          encoderTuningRequested ??
          latestEncoderConfiguration.encoderTuningRequested,
        encoderTuningRequested:
          encoderTuningRequested ??
          latestEncoderConfiguration.encoderTuningRequested,
        producerSessionId:
          producerSessionId ?? latestEncoderConfiguration.producerSessionId,
        captureSource: captureSource ?? latestEncoderConfiguration.captureSource,
        captureShortEdgeRequested:
          captureShortEdgeRequested ??
          latestEncoderConfiguration.captureShortEdgeRequested,
        captureShortEdgeActive:
          captureShortEdgeActive ??
          latestEncoderConfiguration.captureShortEdgeActive,
        captureWidthActive:
          captureWidthActive ?? latestEncoderConfiguration.captureWidthActive,
        captureHeightActive:
          captureHeightActive ?? latestEncoderConfiguration.captureHeightActive,
        captureStreamGeneration:
          captureStreamGeneration ??
          latestEncoderConfiguration.captureStreamGeneration,
        thermalStateStart:
          thermalStateStart ?? latestEncoderConfiguration.thermalState,
        thermalStateWorstObserved:
          thermalStateStart ?? latestEncoderConfiguration.thermalState,
      }),
      frames: new Map(),
      poses: [],
      poseRenders: [],
      droppedBeforeDecode: 0,
      // Automated runs start only after the browser prepare ACK. Snapshotting
      // here excludes deliberate decoder teardown/warm-up from the run delta.
      decoderHealthStarted: browserDecoderHealthCountersRef.current
        ? snapshotBrowserDecoderHealthCounters(
            browserDecoderHealthCountersRef.current,
          )
        : null,
      renderSchedulerStarted: renderScheduler,
    }
    setMeasurement({
      status: 'running',
      elapsedMs: 0,
      receivedFrames: 0,
      renderedFrames: 0,
      poseSamples: 0,
      poseRenderSamples: 0,
      report: null,
    })
  }, [liveRenderScheduler, renderConfiguration])

  const downloadMeasurementReport = useCallback(() => {
    if (!measurement.report) return
    const blob = new Blob([JSON.stringify(measurement.report, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `phone-3d-latency-${measurement.report.startedAt.replaceAll(':', '-')}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }, [measurement.report])

  const markFrameRendered = useCallback(
    (
      frameId: number,
      schedulerGeneration: number,
      renderRequestedAtMs: number,
      r3fFrameObservedAtMs: number,
      renderedAtMs = highResolutionEpochNowMs(),
    ) => {
      if (schedulerGeneration !== liveRenderScheduler.generation) return
      lastFrameRenderedRef.current = renderedAtMs
      const renderedGeneration = decodedFrameGenerationRef.current.get(frameId)
      decodedFrameGenerationRef.current.delete(frameId)
      const pendingPrepare = pendingBrowserPrepareRef.current
      const prepareAck = browserPrepareReadyAck(
        pendingPrepare,
        browserDecoderRuntimeRef.current,
        frameId,
        renderedGeneration,
        renderedAtMs,
      )
      if (prepareAck) {
        const reportSocket = poseSocketRef.current
        if (reportSocket?.readyState === WebSocket.OPEN) {
          browserDecoderRuntimeRef.current.prepareDurationMs =
            prepareAck.prepareDurationMs
          reportSocket.send(JSON.stringify(prepareAck))
          pendingBrowserPrepareRef.current = null
          receiverStatusSenderRef.current()
        }
      }
      const frame = activeMeasurementRef.current?.frames.get(frameId)
      if (!frame) return
      if (frame.renderSchedulerGeneration == null) {
        frame.renderSchedulerGeneration = schedulerGeneration
      }
      if (frame.renderRequestedAtMs == null) {
        frame.renderRequestedAtMs = renderRequestedAtMs
      }
      if (frame.r3fFrameObservedAtMs == null) {
        frame.r3fFrameObservedAtMs = r3fFrameObservedAtMs
      }
      if (frame.renderedAtMs === null) frame.renderedAtMs = renderedAtMs
    },
    [liveRenderScheduler],
  )

  const markTextureUploadCompleted = useCallback(
    (frameId: number, uploadedAtMs = highResolutionEpochNowMs()) => {
      const frame = activeMeasurementRef.current?.frames.get(frameId)
      if (frame && frame.textureUploadCompletedAtMs == null) {
        frame.textureUploadCompletedAtMs = uploadedAtMs
      }
    },
    [],
  )

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false
    reconnectAttemptRef.current = 0
    cancelMeasurement('disconnect')
    releaseResources()
    commitMedia(null)
    setPoseReady(false)
    setHasManualLevel(false)
    commitScreenStale(false)
    setPoseStale(false)
    setPoseDiagnostics(null)
    commitStatus('idle')
    commitError(null)
    setStats(initialStats)
  }, [
    cancelMeasurement,
    commitError,
    commitMedia,
    commitScreenStale,
    commitStatus,
    releaseResources,
  ])

  const calibratePose = useCallback(() => {
    const rawPose = rawPoseRef.current
    if (!rawPose) return

    zeroPoseRef.current = rawPose
    poseRef.current = {
      timestampMs: highResolutionEpochNowMs(),
      quaternion: STANDARD_TABLETOP_QUATERNION,
    }
    ultraPoseKinematicsRef.current = null
    previousUltraPoseKinematicsRef.current = null
    setPoseDiagnostics({
      latestSensorRelative: [0, 0, 0, 1],
      targetQuaternion: STANDARD_TABLETOP_QUATERNION,
      sampledAtMs: highResolutionEpochNowMs(),
    })
    setHasManualLevel(true)
  }, [])

  const reportPoseRenderDiagnostics = useCallback(
    ({ predictionMs, renderFps }: PoseRenderDiagnostics) => {
      setStats((current) => ({
        ...current,
        posePredictionMs: predictionMs,
        renderFps,
      }))
    },
    [],
  )

  const recordPoseRenderSample = useCallback(
    (sample: PoseRenderMeasurementSample) => {
      const active = activeMeasurementRef.current
      if (!active || active.poseRenders.length >= 30_000) return
      active.poseRenders.push(sample)
    },
    [],
  )

  const sendPosePresentationMode = useCallback(
    (mode: PosePresentationMode) => {
      const socket = poseSocketRef.current
      if (!socket || socket.readyState !== WebSocket.OPEN) return
      socket.send(
        JSON.stringify({
          type: 'pose-mode',
          mode,
          requestedHz:
            mode === 'ultra' ? ULTRA_REQUESTED_POSE_HZ : 60,
        }),
      )
    },
    [],
  )

  const sendH264OutputFormat = useCallback(() => {
    const socket = poseSocketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    socket.send(
      JSON.stringify({
        type: 'h264-output-format',
        format: h264BitstreamFormatRef.current,
      }),
    )
  }, [])

  const setPosePresentationMode = useCallback(
    (mode: PosePresentationMode) => {
      posePresentationModeRef.current = mode
      setPosePresentationModeState(mode)
      sendPosePresentationMode(mode)

      if (!usesPosePrediction(mode)) {
        ultraPoseKinematicsRef.current = null
        previousUltraPoseKinematicsRef.current = null
        setStats((current) => ({
          ...current,
          posePredictionMs: null,
          posePredictionCorrectionDegrees: null,
        }))
      }

      const rawPose = rawPoseRef.current
      const reference = zeroPoseRef.current
      if (!usesVideoAlignedPose(mode) && rawPose && reference) {
        poseRef.current = {
          timestampMs: highResolutionEpochNowMs(),
          quaternion: tabletopQuaternion(reference, rawPose),
        }
      }
    },
    [sendPosePresentationMode],
  )

  const connect = useCallback(() => {
    shouldReconnectRef.current = true
    cancelMeasurement('reconnect')
    releaseResources()
    commitMedia(null)
    setPoseReady(false)
    setHasManualLevel(false)
    commitScreenStale(false)
    setPoseStale(false)
    setPoseDiagnostics(null)
    commitStatus('connecting')
    commitError(null)
    setStats(initialStats)

    let h264DecoderSelection = h264DecoderSelectionFromSearch(
      window.location.search,
    )
    h264DecoderSelectionRef.current = h264DecoderSelection
    browserDecoderRuntimeRef.current = {
      browserConfigId: null,
      generation: browserDecoderRuntimeRef.current.generation,
      requestedMode: h264DecoderSelection.mode,
      appliedMode: h264DecoderSelection.mode,
      configuredAcceleration: h264DecoderSelection.hardwareAcceleration,
      prepareDurationMs: null,
    }
    const requestedH264BitstreamFormat = h264BitstreamFormatFromSearch(
      window.location.search,
    )
    h264BitstreamFormatRef.current = requestedH264BitstreamFormat
    let decoderBacklogPolicy = h264DecoderBacklogPolicy(
      h264DecoderSelection,
      requestedH264BitstreamFormat,
      encoderMeasurementConfigurationRef.current.frameAckWindow,
    )

    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d', { alpha: false })

    if (!context) {
      commitStatus('error')
      commitError('This browser could not create the live screen canvas.')
      return
    }

    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    texture.generateMipmaps = false
    textureRef.current = texture
    let pendingVideoFrameUpload: PendingTextureUpload<VideoFrame> | null = null
    const videoFrameTexture = new VideoFrameTexture()
    videoFrameTexture.colorSpace = SRGBColorSpace
    videoFrameTexture.minFilter = LinearFilter
    videoFrameTexture.magFilter = LinearFilter
    videoFrameTexture.generateMipmaps = false
    videoFrameTexture.onUpdate = () => {
      const uploadedFrame = decodedVideoFrameRef.current
      if (uploadedFrame && videoFrameTexture.image === uploadedFrame) {
        const uploadedFrameId = currentTextureUploadFrameId(
          pendingVideoFrameUpload,
          uploadedFrame,
          videoFrameTexture.image,
        )
        if (uploadedFrameId !== null) {
          markTextureUploadCompleted(
            uploadedFrameId,
            highResolutionEpochNowMs(),
          )
        }
        pendingVideoFrameUpload = null
        uploadedFrame.close()
        decodedVideoFrameRef.current = null
      }
    }
    videoFrameTextureRef.current = videoFrameTexture

    const socket = new WebSocket(getDefaultBridgeUrl())
    socket.binaryType = 'arraybuffer'
    socketRef.current = socket
    const poseSocket = new WebSocket(getPoseBridgeUrl())
    poseSocketRef.current = poseSocket
    const webRTCSignal = new WebSocket(getWebRTCBridgeUrl())
    webRTCSignalRef.current = webRTCSignal
    const peerConnection = new RTCPeerConnection({
      iceServers: [],
      // Proposed WebRTC Extensions hint. Browsers that do not implement it
      // safely ignore the unknown dictionary member.
      targetLatency: 'lowest',
    } as RTCConfiguration)
    peerConnectionRef.current = peerConnection
    const videoTransceiver = peerConnection.addTransceiver('video', {
      direction: 'recvonly',
    })
    const videoCapabilities = RTCRtpReceiver.getCapabilities('video')
    const vp8Codecs = vp8OnlyCodecPreferences(videoCapabilities)
    if (vp8Codecs) {
      // WebRTC 152 negotiates forced H.264 on iOS 27 beta but VideoToolbox
      // emits zero frames. Pin the browser offer to the previously proven VP8
      // path so a connected session cannot remain a silent black screen.
      videoTransceiver.setCodecPreferences(vp8Codecs)
    }

    const frameMetadataQueue: FrameMetadataMessage[] = []
    let pendingFrame: PendingFrame | null = null
    let decodingFrame = false
    let frames = 0
    let lastFrameUiUpdate = 0
    let latestValidFrameLatencyMs: number | null = null
    let lastPoseUiUpdate = 0
    let webRTCFrames = 0
    let previousWebRTCStats: WebRTCReceiverSample | null = null
    let webRTCFpsSamples: WebRTCReceiverSample[] = []
    let webRTCPhonePresent = false
    let offeredForCurrentWebRTCPhone = false
    let makingWebRTCOffer = false
    let activeWebRTCSessionId: string | null = null
    const h264Frames = new Map<number, PendingFrame>()
    let h264DecoderDiagnostics = initialH264DecoderDiagnostics()
    let activeH264DecoderCodec: string | null = null
    let activeH264BitstreamFormat: H264BitstreamFormat | null = null
    let activeH264DecoderConfigurationKey: string | null = null
    let latestH264DecoderDescriptionBase64: string | null = null
    let h264FormatMismatchDrops = 0
    const publishBrowserDecoderHealthCounters = () => {
      if (socketRef.current !== socket) return
      browserDecoderHealthCountersRef.current =
        snapshotBrowserDecoderHealthCounters({
          resets: h264DecoderDiagnostics.resets,
          errors: h264DecoderDiagnostics.errors,
          resetReasons: h264DecoderDiagnostics.resetReasons,
          formatMismatchDrops: h264FormatMismatchDrops,
        })
    }
    publishBrowserDecoderHealthCounters()
    let lastH264FormatCorrectionAtMs = 0
    // A browser reconnect can join the persistent phone encoder between
    // keyframes. Never feed an undecodable delta frame into a fresh decoder;
    // wait for the keyframe requested when the frame socket opens.
    let awaitingH264Keyframe = true
    let lastKeyframeRequestAtMs = 0
    let webRTCEstimatedPipelineMs: number | null = null
    let poseSyncMode: PoseSyncMode = 'live'
    let poseSyncDelayMs: number | null = null
    let poseSyncErrorMs: number | null = null
    const poseSampleIntervalsMs: number[] = []
    const poseArrivalGapsMs: number[] = []
    let previousPoseArrivalAtMs: number | null = null
    let poseActualHz: number | null = null
    let poseRequestedHz: number | null = null
    let poseArrivalGapP95Ms: number | null = null
    let posePredictionCorrectionDegrees: number | null = null

    const scheduleReconnect = () => {
      if (
        !shouldReconnectRef.current ||
        reconnectTimerRef.current !== null
      ) {
        return
      }
      const delay = bridgeReconnectDelayMs(reconnectAttemptRef.current)
      reconnectAttemptRef.current += 1
      commitStatus('connecting')
      commitError(null)
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null
        if (shouldReconnectRef.current) connectRef.current()
      }, delay)
    }

    const applyPoseAt = (
      targetTimestampMs: number,
      mode: PoseSyncMode,
      delayMs: number,
    ) => {
      const pose = interpolatePoseAt(
        poseHistoryRef.current,
        targetTimestampMs,
      )
      const reference = zeroPoseRef.current
      if (!pose || !reference) return null

      poseSyncMode = mode
      poseSyncDelayMs = Math.max(0, delayMs)
      poseSyncErrorMs = pose.nearestSampleDeltaMs
      poseRef.current = {
        timestampMs: pose.timestampMs,
        quaternion: tabletopQuaternion(reference, pose.quaternion),
      }
      return pose
    }

    const applyPoseForPresentedFrame = (
      captureAtMacMs: number | null,
      presentedAtMacMs: number,
    ) => {
      if (captureAtMacMs !== null) {
        return applyPoseAt(
          captureAtMacMs,
          'frame-clock',
          presentedAtMacMs - captureAtMacMs,
        )
      }
      if (webRTCEstimatedPipelineMs !== null) {
        return applyPoseAt(
          presentedAtMacMs - webRTCEstimatedPipelineMs,
          'estimated',
          webRTCEstimatedPipelineMs,
        )
      }
      return null
    }

    const applyPoseWithCurrentVideoDelay = (nowMs: number) => {
      if (poseSyncDelayMs === null) return null
      return applyPoseAt(
        nowMs - poseSyncDelayMs,
        poseSyncMode,
        poseSyncDelayMs,
      )
    }

    const requestKeyframe = () => {
      const now = highResolutionEpochNowMs()
      if (now - lastKeyframeRequestAtMs < 500) return
      lastKeyframeRequestAtMs = now
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'request-keyframe' }))
      }
    }

    const h264DecoderDiagnosticSnapshot = () => ({
      browserConfigId: browserDecoderRuntimeRef.current.browserConfigId,
      browserConfigGeneration: browserDecoderRuntimeRef.current.generation,
      decoderModeRequested:
        browserDecoderRuntimeRef.current.requestedMode,
      decoderModeApplied: browserDecoderRuntimeRef.current.appliedMode,
      decoderAccelerationConfigured:
        browserDecoderRuntimeRef.current.configuredAcceleration,
      browserPrepareDurationMs:
        browserDecoderRuntimeRef.current.prepareDurationMs,
      decoderMode: h264DecoderSelection.mode,
      decoderAcceleration: h264DecoderSelection.hardwareAcceleration,
      decoderCodec: activeH264DecoderCodec,
      decoderBitstreamFormatRequested: requestedH264BitstreamFormat,
      decoderBitstreamFormatActive: activeH264BitstreamFormat,
      decoderFormatMismatchDrops: h264FormatMismatchDrops,
      decoderBacklogPolicy: decoderBacklogPolicy.name,
      decoderMaxQueueSize: decoderBacklogPolicy.maxQueueSize,
      decoderMaxPendingFrames: decoderBacklogPolicy.maxPendingFrames,
      decoderMaxFrameAgeMs: decoderBacklogPolicy.maxFrameAgeMs,
      decoderResets: h264DecoderDiagnostics.resets,
      decoderErrors: h264DecoderDiagnostics.errors,
      decoderResetReasons: { ...h264DecoderDiagnostics.resetReasons },
      decoderLastResetReason: h264DecoderDiagnostics.lastResetReason,
      decoderDecodeQueueSize:
        videoDecoderRef.current?.state === 'configured'
          ? videoDecoderRef.current.decodeQueueSize
          : 0,
      decoderPendingFrames: h264Frames.size,
      decoderAwaitingKeyframe: awaitingH264Keyframe,
    })

    const sendH264ReceiverStatus = (encoderTimestampMs?: number) => {
      if (
        poseSocketRef.current !== poseSocket ||
        poseSocket.readyState !== WebSocket.OPEN
      ) {
        return
      }
      const receiverStatusAtMs = highResolutionEpochNowMs()
      poseSocket.send(
        JSON.stringify({
          type: 'browser-receiver-status',
          receiverKind: 'h264-webcodecs',
          timestampMs: receiverStatusAtMs,
          encoderTimestampMs,
          visibilityState: document.visibilityState,
          hasFocus: document.hasFocus(),
          lastFrameReceivedAtMs: lastFrameReceivedRef.current,
          lastFrameAgeMs:
            lastFrameReceivedRef.current === null
              ? null
              : receiverStatusAtMs - lastFrameReceivedRef.current,
          lastFrameRenderedAtMs: lastFrameRenderedRef.current,
          lastRenderAgeMs:
            lastFrameRenderedRef.current === null
              ? null
              : receiverStatusAtMs - lastFrameRenderedRef.current,
          screenStale: screenStreamIsStale(
            receiverStatusAtMs,
            lastFrameReceivedRef.current,
            lastCaptureHeartbeatRef.current,
            firstCaptureHeartbeatRef.current,
          ),
          ...h264DecoderDiagnosticSnapshot(),
        }),
      )
      lastReceiverStatusSentAtRef.current = receiverStatusAtMs
    }
    receiverStatusSenderRef.current = () => sendH264ReceiverStatus()

    const failPendingBrowserPrepare = (reason: string) => {
      const pendingPrepare = pendingBrowserPrepareRef.current
      if (!pendingPrepare) return
      const reportSocket = poseSocketRef.current
      if (reportSocket?.readyState === WebSocket.OPEN) {
        reportSocket.send(
          JSON.stringify({
            type: 'browser-benchmark-prepare-ack',
            status: 'failed',
            runId: pendingPrepare.runId,
            browserConfigId: pendingPrepare.browserConfigId,
            browserConfigGeneration: pendingPrepare.generation,
            decoderModeRequested: pendingPrepare.decoderMode,
            decoderModeApplied: browserDecoderRuntimeRef.current.appliedMode,
            decoderAccelerationConfigured:
              browserDecoderRuntimeRef.current.configuredAcceleration,
            renderedFrameId: null,
            preparedAtMs: highResolutionEpochNowMs(),
            reason,
          }),
        )
      }
      pendingBrowserPrepareRef.current = null
    }

    const applyBrowserBenchmarkPrepare = (
      message: BrowserBenchmarkPrepareMessage,
    ) => {
      const pendingPrepare = pendingBrowserPrepareRef.current
      if (
        pendingPrepare?.runId === message.runId &&
        pendingPrepare.browserConfigId === message.browserConfigId &&
        pendingPrepare.generation === message.browserConfigGeneration
      ) {
        return
      }
      if (
        !pendingPrepare &&
        browserDecoderRuntimeRef.current.browserConfigId ===
          message.browserConfigId &&
        browserDecoderRuntimeRef.current.generation ===
          message.browserConfigGeneration
      ) {
        return
      }
      if (pendingPrepare) failPendingBrowserPrepare('prepare-superseded')
      if (
        activeMeasurementRef.current?.runId
      ) {
        pendingBrowserPrepareRef.current = {
          runId: message.runId,
          browserConfigId: message.browserConfigId,
          generation: message.browserConfigGeneration,
          decoderMode: message.decoderMode,
          decoderAcceleration: message.decoderAcceleration,
          requestedAtMs: message.requestedAtMs,
        }
        failPendingBrowserPrepare('measurement-already-running')
        return
      }
      const expectedAcceleration = h264DecoderSelectionFromSearch(
        `?decoder=${message.decoderMode}`,
      ).hardwareAcceleration
      if (message.decoderAcceleration !== expectedAcceleration) {
        pendingBrowserPrepareRef.current = {
          runId: message.runId,
          browserConfigId: message.browserConfigId,
          generation: message.browserConfigGeneration,
          decoderMode: message.decoderMode,
          decoderAcceleration: message.decoderAcceleration,
          requestedAtMs: message.requestedAtMs,
        }
        failPendingBrowserPrepare('decoder-acceleration-contract-mismatch')
        return
      }

      if (
        message.browserConfigGeneration !==
        browserDecoderRuntimeRef.current.generation + 1
      ) {
        pendingBrowserPrepareRef.current = {
          runId: message.runId,
          browserConfigId: message.browserConfigId,
          generation: message.browserConfigGeneration,
          decoderMode: message.decoderMode,
          decoderAcceleration: message.decoderAcceleration,
          requestedAtMs: message.requestedAtMs,
        }
        failPendingBrowserPrepare('decoder-generation-mismatch')
        return
      }

      const generation = message.browserConfigGeneration
      pendingBrowserPrepareRef.current = {
        runId: message.runId,
        browserConfigId: message.browserConfigId,
        generation,
        decoderMode: message.decoderMode,
        decoderAcceleration: message.decoderAcceleration,
        requestedAtMs: message.requestedAtMs,
      }
      const nextSelection: H264DecoderSelection = {
        mode: message.decoderMode,
        hardwareAcceleration: message.decoderAcceleration,
      }
      h264DecoderSelection = nextSelection
      h264DecoderSelectionRef.current = nextSelection
      decoderBacklogPolicy = h264DecoderBacklogPolicy(
        nextSelection,
        requestedH264BitstreamFormat,
        encoderMeasurementConfigurationRef.current.frameAckWindow,
      )
      browserDecoderRuntimeRef.current = {
        browserConfigId: message.browserConfigId,
        generation,
        requestedMode: message.decoderMode,
        appliedMode: message.decoderMode,
        configuredAcceleration: message.decoderAcceleration,
        prepareDurationMs: null,
      }

      const decoder = videoDecoderRef.current
      if (decoder?.state !== 'closed') decoder?.close()
      videoDecoderRef.current = null
      h264Frames.clear()
      pendingFrame = null
      pendingVideoFrameUpload = null
      decodedFrameGenerationRef.current.clear()
      activeH264DecoderCodec = null
      activeH264BitstreamFormat = null
      activeH264DecoderConfigurationKey = null
      latestH264DecoderDescriptionBase64 = null
      awaitingH264Keyframe = true
      lastKeyframeRequestAtMs = 0
      requestKeyframe()
      sendH264ReceiverStatus()
    }

    const recoverFromH264DecoderError = (
      failedDecoder: VideoDecoder | null,
    ) => {
      if (
        socketRef.current !== socket ||
        (videoDecoderRef.current && videoDecoderRef.current !== failedDecoder)
      ) {
        return
      }

      h264DecoderDiagnostics = recordH264DecoderReset(
        h264DecoderDiagnostics,
        'error',
      )
      publishBrowserDecoderHealthCounters()
      const active = activeMeasurementRef.current
      if (active) active.droppedBeforeDecode += h264Frames.size
      h264Frames.clear()
      awaitingH264Keyframe = true
      activeH264DecoderCodec = null
      activeH264BitstreamFormat = null
      activeH264DecoderConfigurationKey = null
      latestH264DecoderDescriptionBase64 = null
      if (failedDecoder?.state !== 'closed') {
        try {
          failedDecoder?.close()
        } catch {
          // The decoder can transition to closed immediately before recovery.
        }
      }
      videoDecoderRef.current = null
      failPendingBrowserPrepare('decoder-error')
      requestKeyframe()
      commitStatus('error')
      commitError(H264_DECODER_REJECTED_ERROR)
    }

    const commitDecodedFrame = (
      frame: PendingFrame,
      width: number,
      height: number,
      decodedAtMs: number,
      screenTexture: Texture = texture,
    ) => {
      // VideoFrameTexture.setFrame() already marks its source for upload. The
      // canvas JPEG fallback still needs the explicit update signal here.
      if (screenTexture !== videoFrameTexture) screenTexture.needsUpdate = true
      frames += 1
      const rawCaptureAtMacMs =
        frame.metadata && frame.metadata.captureTimestampValid === true
        ? phoneTimeOnMac(
            frame.metadata.captureAtMs,
            frame.metadata.clockOffsetMs,
          )
        : null
      const callbackAtMacMs = frame.metadata
        ? phoneTimeOnMac(
            frame.metadata.callbackAtMs,
            frame.metadata.clockOffsetMs,
          )
        : null
      const captureAtMacMs = frame.metadata
        ? conservativeCaptureAtMacMs({
            captureAtMacMs: rawCaptureAtMacMs,
            callbackAtMacMs,
            captureTimestampSource: frame.metadata.captureTimestampSource,
            captureTimestampValid: frame.metadata.captureTimestampValid,
            captureContentStatus: frame.metadata.captureContentStatus,
            freshContent: frame.metadata.freshContent,
          })
        : null
      const synchronizedPose = applyPoseForPresentedFrame(
        captureAtMacMs,
        decodedAtMs,
      )
      latestValidFrameLatencyMs = nextValidFrameLatencyMs(
        latestValidFrameLatencyMs,
        decodedAtMs,
        captureAtMacMs,
      )

      if (frame.metadata) {
        const schedulerGeneration = liveRenderScheduler.generation
        const renderRequestedAtMs = decodedAtMs
        const sample = activeMeasurementRef.current?.frames.get(
          frame.metadata.frameId,
        )
        if (sample) {
          sample.decodedAtMs = decodedAtMs
          sample.renderRequestedAtMs = renderRequestedAtMs
          sample.renderSchedulerGeneration = schedulerGeneration
          sample.poseScreenSkewMs = synchronizedPose?.nearestSampleDeltaMs ?? null
        }
        liveFrameRenderRef.current = {
          frameId: frame.metadata.frameId,
          schedulerGeneration,
          renderRequestedAtMs,
          texture: screenTexture,
        }
        liveRenderScheduler.request({
          cause: 'video',
          generation: schedulerGeneration,
          frameId: frame.metadata.frameId,
        })
      }

      commitMedia({
        kind: 'texture',
        name: 'Live iPhone screen',
        texture: screenTexture,
        width,
        height,
      })
      commitStatus('ready')
      // Decoder failures are recoverable: a newly decoded frame proves that
      // reconfiguration/keyframe recovery succeeded. Preserve unrelated
      // connectivity or negotiation errors until their own subsystem recovers.
      commitError(liveFrameErrorAfterSuccessfulDecode(currentErrorRef.current))

      const now = performance.now()
      if (now - lastFrameUiUpdate > 200) {
        lastFrameUiUpdate = now
        setStats((current) => ({
          ...current,
          frames,
          codec: frame.metadata?.codec ?? current.codec,
          frameLatencyMs: latestValidFrameLatencyMs,
          poseSyncDelayMs,
          poseSyncErrorMs,
          poseSyncMode,
        }))
      }
    }

    const ensureH264Decoder = (
      codec: string,
      bitstreamFormat: H264BitstreamFormat,
      descriptionBase64: string | null,
    ) => {
      const configuration = buildH264DecoderConfig(
        codec,
        h264DecoderSelection,
        bitstreamFormat,
        descriptionBase64,
      )
      if (!configuration) return null
      const configurationKey = h264DecoderConfigurationKey(
        codec,
        bitstreamFormat,
        descriptionBase64,
        h264DecoderSelection,
        browserDecoderRuntimeRef.current.generation,
      )
      const currentDecoder = videoDecoderRef.current
      if (
        currentDecoder &&
        currentDecoder.state !== 'closed' &&
        activeH264DecoderConfigurationKey === configurationKey
      ) {
        return currentDecoder
      }
      if (typeof VideoDecoder === 'undefined') return null

      if (currentDecoder && currentDecoder.state !== 'closed') {
        h264DecoderDiagnostics = recordH264DecoderReset(
          h264DecoderDiagnostics,
          'configuration',
        )
        publishBrowserDecoderHealthCounters()
        currentDecoder.close()
      }
      videoDecoderRef.current = null
      h264Frames.clear()

      const decoderGeneration = browserDecoderRuntimeRef.current.generation
      const decoder = new VideoDecoder({
        output: (videoFrame) => {
          const frameId = Number(videoFrame.timestamp)
          const frame = h264Frames.get(frameId)
          h264Frames.delete(frameId)
          if (!frame || socketRef.current !== socket) {
            videoFrame.close()
            return
          }

          const width = videoFrame.displayWidth
          const height = videoFrame.displayHeight
          decodedVideoFrameRef.current?.close()
          decodedVideoFrameRef.current = videoFrame
          decodedFrameGenerationRef.current.clear()
          decodedFrameGenerationRef.current.set(frameId, decoderGeneration)
          pendingVideoFrameUpload = {
            frameId,
            source: videoFrame,
          }
          videoFrameTexture.setFrame(videoFrame)
          commitDecodedFrame(
            frame,
            width,
            height,
            highResolutionEpochNowMs(),
            videoFrameTexture,
          )
        },
        error: () => recoverFromH264DecoderError(decoder),
      })
      try {
        decoder.configure(configuration)
      } catch (error) {
        decoder.close()
        failPendingBrowserPrepare('decoder-configure-failed')
        throw error
      }
      activeH264DecoderCodec = codec
      activeH264BitstreamFormat = bitstreamFormat
      activeH264DecoderConfigurationKey = configurationKey
      videoDecoderRef.current = decoder
      return decoder
    }

    const decodeNextFrame = async () => {
      if (decodingFrame || !pendingFrame) return
      decodingFrame = true
      const frame = pendingFrame
      pendingFrame = null
      const decoderErrorsBeforeFrame = h264DecoderDiagnostics.errors

      try {
        if (frame.metadata?.codec === 'h264') {
          const isKeyframe = frame.metadata.isKeyframe === true
          const decoderCodec = frame.metadata.decoderCodec ?? 'avc1.420029'
          const bitstreamFormat =
            frame.metadata.h264BitstreamFormat ?? DEFAULT_H264_BITSTREAM_FORMAT
          if (bitstreamFormat !== requestedH264BitstreamFormat) {
            const active = activeMeasurementRef.current
            if (active) active.droppedBeforeDecode += 1
            h264FormatMismatchDrops += 1
            publishBrowserDecoderHealthCounters()
            awaitingH264Keyframe = true
            const now = highResolutionEpochNowMs()
            if (now - lastH264FormatCorrectionAtMs >= 250) {
              lastH264FormatCorrectionAtMs = now
              sendH264OutputFormat()
            }
            return
          }
          if (isKeyframe) {
            latestH264DecoderDescriptionBase64 =
              bitstreamFormat === 'avcc'
                ? frame.metadata.decoderDescriptionBase64
                : null
          }
          const decoderDescriptionBase64 =
            bitstreamFormat === 'avcc'
              ? latestH264DecoderDescriptionBase64
              : null
          const desiredConfigurationKey = h264DecoderConfigurationKey(
            decoderCodec,
            bitstreamFormat,
            decoderDescriptionBase64,
            h264DecoderSelection,
            browserDecoderRuntimeRef.current.generation,
          )
          if (
            (awaitingH264Keyframe ||
              (activeH264DecoderConfigurationKey !== null &&
                activeH264DecoderConfigurationKey !== desiredConfigurationKey)) &&
            !isKeyframe
          ) {
            const active = activeMeasurementRef.current
            if (active) active.droppedBeforeDecode += 1
            requestKeyframe()
            return
          }

          if (bitstreamFormat === 'avcc' && !decoderDescriptionBase64) {
            const active = activeMeasurementRef.current
            if (active) active.droppedBeforeDecode += 1
            awaitingH264Keyframe = true
            requestKeyframe()
            return
          }

          const decoder = ensureH264Decoder(
            decoderCodec,
            bitstreamFormat,
            decoderDescriptionBase64,
          )
          if (!decoder) {
            throw new Error('WebCodecs VideoDecoder is unavailable')
          }

          const oldestPendingFrame = h264Frames.values().next().value as
            | PendingFrame
            | undefined
          const oldestPendingFrameAgeMs = oldestPendingFrame
            ? highResolutionEpochNowMs() - oldestPendingFrame.browserReceivedAtMs
            : 0
          const resetReason = h264DecoderBacklogResetReason(
            decoder.decodeQueueSize,
            h264Frames.size,
            oldestPendingFrameAgeMs,
            decoderBacklogPolicy,
          )
          if (resetReason) {
            const active = activeMeasurementRef.current
            if (active) {
              active.droppedBeforeDecode += h264Frames.size + 1
            }
            h264DecoderDiagnostics = recordH264DecoderReset(
              h264DecoderDiagnostics,
              resetReason,
            )
            publishBrowserDecoderHealthCounters()
            decoder.reset()
            const resetConfiguration = buildH264DecoderConfig(
              decoderCodec,
              h264DecoderSelection,
              bitstreamFormat,
              decoderDescriptionBase64,
            )
            if (!resetConfiguration) {
              awaitingH264Keyframe = true
              requestKeyframe()
              return
            }
            decoder.configure(resetConfiguration)
            h264Frames.clear()
            if (!isKeyframe) {
              awaitingH264Keyframe = true
              requestKeyframe()
              return
            }
            awaitingH264Keyframe = false
          }

          if (isKeyframe) {
            awaitingH264Keyframe = false
          }
          h264Frames.set(frame.metadata.frameId, frame)
          decoder.decode(
            new EncodedVideoChunk({
              type: isKeyframe ? 'key' : 'delta',
              timestamp: frame.metadata.frameId,
              data: frame.bytes,
            }),
          )
          return
        }

        const bitmap = await createImageBitmap(
          new Blob([frame.bytes], { type: 'image/jpeg' }),
        )

        if (socketRef.current !== socket) {
          bitmap.close()
          return
        }

        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width
          canvas.height = bitmap.height
        }

        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        bitmap.close()
        const decodedAtMs = highResolutionEpochNowMs()
        commitDecodedFrame(frame, canvas.width, canvas.height, decodedAtMs)
      } catch {
        if (
          frame.metadata?.codec === 'h264' &&
          h264DecoderDiagnostics.errors === decoderErrorsBeforeFrame
        ) {
          recoverFromH264DecoderError(videoDecoderRef.current)
        } else if (frame.metadata?.codec !== 'h264') {
          commitStatus('error')
          commitError(LIVE_FRAME_DECODE_ERROR)
        }
      } finally {
        decodingFrame = false
        if (pendingFrame) void decodeNextFrame()
      }
    }

    const handlePoseMessage = (message: LivePoseMessage) => {
      const browserReceivedAtMs = highResolutionEpochNowMs()
      const measurementAtEntry = activeMeasurementRef.current
      if (
        measurementAtEntry?.runId &&
        !measurementProducerMatches(
          measurementAtEntry,
          message.producerSessionId,
          message.captureSource,
        )
      ) {
        cancelMeasurement('producer-identity-mismatch')
      }
      const sampledAtMacMs = phoneTimeOnMac(
        message.timestampMs,
        message.clockOffsetMs,
      )
      const rawPose = normalizeQuaternion(message.quaternion)
      let arrivalGapMs: number | null = null
      if (previousPoseArrivalAtMs !== null) {
        arrivalGapMs = browserReceivedAtMs - previousPoseArrivalAtMs
        if (arrivalGapMs >= 0 && arrivalGapMs < 1_000) {
          poseArrivalGapsMs.push(arrivalGapMs)
          if (poseArrivalGapsMs.length > 120) poseArrivalGapsMs.shift()
          poseArrivalGapP95Ms = percentile(poseArrivalGapsMs, 0.95)
        }
      }
      previousPoseArrivalAtMs = browserReceivedAtMs
      if (
        message.sampleIntervalMs !== null &&
        message.sampleIntervalMs > 0 &&
        message.sampleIntervalMs < 1_000
      ) {
        poseSampleIntervalsMs.push(message.sampleIntervalMs)
        if (poseSampleIntervalsMs.length > 120) poseSampleIntervalsMs.shift()
        const averageIntervalMs =
          poseSampleIntervalsMs.reduce((sum, value) => sum + value, 0) /
          poseSampleIntervalsMs.length
        poseActualHz = 1_000 / averageIntervalMs
      }
      poseRequestedHz = message.requestedHz
      rawPoseRef.current = rawPose
      recordPoseSample(poseHistoryRef.current, {
        timestampMs: sampledAtMacMs ?? browserReceivedAtMs,
        quaternion: rawPose,
      })
      lastPoseReceivedRef.current = browserReceivedAtMs
      setPoseStale(false)
      if (!zeroPoseRef.current) zeroPoseRef.current = rawPose
      const useLatestPose = !usesVideoAlignedPose(
        posePresentationModeRef.current,
      )
      const currentPose = tabletopQuaternion(zeroPoseRef.current, rawPose)
      if (
        useLatestPose ||
        !applyPoseWithCurrentVideoDelay(browserReceivedAtMs)
      ) {
        poseSyncMode = 'live'
        poseSyncDelayMs = 0
        poseSyncErrorMs = 0
        poseRef.current = {
          timestampMs: sampledAtMacMs ?? message.timestampMs,
          quaternion: currentPose,
        }
      }

      if (
        usesPosePrediction(posePresentationModeRef.current) &&
        message.rotationRate
      ) {
        const kinematics: LivePoseKinematics = {
          quaternion: currentPose,
          rotationRate: message.rotationRate,
          sampledAtMacMs: sampledAtMacMs ?? browserReceivedAtMs,
          receivedAtMacMs: browserReceivedAtMs,
        }
        const previous = previousUltraPoseKinematicsRef.current
        if (previous) {
          const elapsedMs = Math.min(
            30,
            Math.max(0, kinematics.sampledAtMacMs - previous.sampledAtMacMs),
          )
          const previousPrediction = predictQuaternion(
            previous.quaternion,
            previous.rotationRate,
            elapsedMs,
          )
          posePredictionCorrectionDegrees = quaternionAngularDistance(
            previousPrediction,
            currentPose,
          )
        }
        ultraPoseKinematicsRef.current = kinematics
        previousUltraPoseKinematicsRef.current = kinematics
      } else {
        ultraPoseKinematicsRef.current = null
        previousUltraPoseKinematicsRef.current = null
        posePredictionCorrectionDegrees = null
      }
      const active = activeMeasurementRef.current
      if (active && active.poses.length < 30_000) {
        active.poses.push({
          sampledAtMacMs,
          bridgeReceivedAtMs: message.bridgeReceivedAtMs,
          bridgeRelayedAtMs: message.bridgeRelayedAtMs,
          browserReceivedAtMs,
          clockRttMs: message.clockRttMs,
          arrivalGapMs,
          sensorIntervalMs: message.sampleIntervalMs,
          angularSpeedDegreesPerSecond: message.rotationRate
            ? (Math.hypot(...message.rotationRate) * 180) / Math.PI
            : null,
          predictionCorrectionDegrees: posePredictionCorrectionDegrees,
        })
      }
      setPoseReady(true)
      liveRenderScheduler.request({
        cause: 'pose',
        generation: liveRenderScheduler.generation,
        poseSequence: message.timestampMs,
      })

      const now = performance.now()
      if (now - lastPoseUiUpdate > 200) {
        lastPoseUiUpdate = now
        const reference = zeroPoseRef.current
        const targetPose = poseRef.current
        if (reference && targetPose) {
          setPoseDiagnostics({
            latestSensorRelative: relativeQuaternion(reference, rawPose),
            targetQuaternion: targetPose.quaternion,
            sampledAtMs: sampledAtMacMs ?? browserReceivedAtMs,
          })
        }
        setStats((current) => ({
          ...current,
          poseLatencyMs:
            sampledAtMacMs === null
              ? null
              : Math.max(0, browserReceivedAtMs - sampledAtMacMs),
          poseSyncDelayMs,
          poseSyncErrorMs,
          poseSyncMode,
          poseActualHz,
          poseRequestedHz,
          poseArrivalGapP95Ms,
          posePredictionCorrectionDegrees,
        }))
      }
    }

    const updateWebRTCMedia = (video: HTMLVideoElement) => {
      const width = video.videoWidth
      const height = video.videoHeight
      if (width <= 0 || height <= 0) return
      lastFrameReceivedRef.current = highResolutionEpochNowMs()
      commitScreenStale(false)
      commitOrientation(height >= width ? 'portrait' : 'landscape')
      commitMedia({
        kind: 'video',
        name: 'Live iPhone screen · WebRTC',
        element: video,
        width,
        height,
      })
      commitStatus('ready')
      commitError(null)
    }

    const countWebRTCFrame: VideoFrameRequestCallback = (
      now,
      metadata,
    ) => {
      const video = webRTCVideoRef.current
      if (!video || peerConnectionRef.current !== peerConnection) return
      const presentedAtMacMs = highResolutionEpochNowMs()
      const captureAtMacMs = captureTimeToEpochMs(
        metadata.captureTime,
        presentedAtMacMs,
        presentedAtMacMs - now,
      )
      if (usesVideoAlignedPose(posePresentationModeRef.current)) {
        applyPoseForPresentedFrame(captureAtMacMs, presentedAtMacMs)
      }
      webRTCFrames += 1
      updateWebRTCMedia(video)
      liveRenderScheduler.request({
        cause: 'video',
        generation: liveRenderScheduler.generation,
        frameId: webRTCFrames,
      })
      setStats((current) => ({
        ...current,
        codec: 'webrtc',
        frames: webRTCFrames,
        poseSyncDelayMs,
        poseSyncErrorMs,
        poseSyncMode,
      }))
      webRTCFrameRequestRef.current = video.requestVideoFrameCallback(
        countWebRTCFrame,
      )
    }

    peerConnection.addEventListener('icecandidate', (event) => {
      if (!event.candidate || webRTCSignal.readyState !== WebSocket.OPEN) return
      webRTCSignal.send(
        JSON.stringify({
          type: 'webrtc-candidate',
          sessionId: activeWebRTCSessionId,
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
        }),
      )
    })

    peerConnection.addEventListener('track', (event) => {
      if (peerConnectionRef.current !== peerConnection) return
      const lowLatencyReceiver = event.receiver as RTCRtpReceiver & {
        jitterBufferTarget?: number
        playoutDelayHint?: number
      }
      if ('playoutDelayHint' in lowLatencyReceiver) {
        lowLatencyReceiver.playoutDelayHint = 0
      }
      if ('jitterBufferTarget' in lowLatencyReceiver) {
        lowLatencyReceiver.jitterBufferTarget = 0
      }
      const video = document.createElement('video')
      video.autoplay = true
      video.muted = true
      video.playsInline = true
      video.srcObject = event.streams[0] ?? new MediaStream([event.track])
      webRTCVideoRef.current = video
      video.addEventListener('loadedmetadata', () => updateWebRTCMedia(video))
      void video.play().then(() => {
        updateWebRTCMedia(video)
        webRTCFrameRequestRef.current = video.requestVideoFrameCallback(
          countWebRTCFrame,
        )
      })
    })

    peerConnection.addEventListener('connectionstatechange', () => {
      if (peerConnectionRef.current !== peerConnection) return
      if (peerConnection.connectionState === 'failed') {
        commitError('WebRTC video negotiation failed; H.264 and JPEG remain available on the iPhone.')
      }
    })

    const requestWebRTCOffer = async () => {
      if (
        makingWebRTCOffer ||
        offeredForCurrentWebRTCPhone ||
        !webRTCPhonePresent ||
        webRTCSignal.readyState !== WebSocket.OPEN
      ) {
        return
      }
      makingWebRTCOffer = true
      offeredForCurrentWebRTCPhone = true
      const sessionId = crypto.randomUUID()
      activeWebRTCSessionId = sessionId
      try {
        const offer = await peerConnection.createOffer({
          iceRestart: peerConnection.remoteDescription !== null,
          offerToReceiveVideo: true,
        })
        await peerConnection.setLocalDescription(offer)
        if (webRTCSignal.readyState === WebSocket.OPEN) {
          webRTCSignal.send(
            JSON.stringify({
              type: 'webrtc-offer',
              sessionId,
              sdp: offer.sdp,
            }),
          )
        }
      } catch {
        if (activeWebRTCSessionId === sessionId) {
          activeWebRTCSessionId = null
        }
        offeredForCurrentWebRTCPhone = false
        commitError('The browser could not create a WebRTC video offer.')
      } finally {
        makingWebRTCOffer = false
      }
    }

    const handleBridgeStatus = (
      message: Extract<ReturnType<typeof parseLiveTextMessage>, { type: 'bridge-status' }>,
    ) => {
      if (!message) return
      const nextWebRTCPhonePresent = message.webrtcPhones > 0
      if (!nextWebRTCPhonePresent || !webRTCPhonePresent) {
        offeredForCurrentWebRTCPhone = false
        if (!nextWebRTCPhonePresent) activeWebRTCSessionId = null
      }
      webRTCPhonePresent = nextWebRTCPhonePresent
      setStats((current) => ({
        ...current,
        browsers: message.browsers,
        phones: message.phones,
        captureState:
          message.phones > 0 ? current.captureState : null,
      }))
      if (message.phones > 0) {
        sendPosePresentationMode(posePresentationModeRef.current)
        sendH264OutputFormat()
      }
      void requestWebRTCOffer()
    }

    const pollWebRTCStats = async () => {
      try {
        if (peerConnectionRef.current !== peerConnection) return
        const reports = await peerConnection.getStats()
        if (peerConnectionRef.current !== peerConnection) return
        const sample = readWebRTCReceiverSample(reports)
        if (!sample) return
        if (
          previousWebRTCStats &&
          sample.framesDecoded < previousWebRTCStats.framesDecoded
        ) {
          webRTCFpsSamples = []
        }
        webRTCFpsSamples.push(sample)
        const fpsCutoffMs = sample.timestampMs - 10_000
        while (
          webRTCFpsSamples.length > 2 &&
          webRTCFpsSamples[1].timestampMs < fpsCutoffMs
        ) {
          webRTCFpsSamples.shift()
        }
        const metrics = deriveWebRTCReceiverMetrics(
          sample,
          previousWebRTCStats,
        )
        webRTCEstimatedPipelineMs = metrics.estimatedPipelineMs
        previousWebRTCStats = sample
        const rollingFps = rollingDecodedFps(webRTCFpsSamples) ?? metrics.fps
        setStats((current) => ({
          ...current,
          frameLatencyMs: metrics.estimatedPipelineMs,
          webRTCCodecMimeType: sample.codecMimeType,
          webRTCBitrateMbps: metrics.bitrateMbps,
          webRTCDecodeMs: metrics.decodeMs,
          webRTCFps: rollingFps,
          webRTCFramesDropped: metrics.framesDropped,
          webRTCJitterBufferMs: metrics.jitterBufferMs,
          webRTCJitterMinimumMs: metrics.jitterBufferMinimumMs,
          webRTCJitterTargetMs: metrics.jitterBufferTargetMs,
          webRTCPacketLossPercent: metrics.packetLossPercent,
          webRTCRoundTripMs: metrics.roundTripMs,
          poseSyncDelayMs,
          poseSyncErrorMs,
          poseSyncMode,
        }))
        if (poseSocket.readyState === WebSocket.OPEN) {
          poseSocket.send(
            JSON.stringify({
              type: 'browser-receiver-status',
              receiverKind: 'webrtc',
              timestampMs: highResolutionEpochNowMs(),
              visibilityState: document.visibilityState,
              hasFocus: document.hasFocus(),
              codecMimeType: sample.codecMimeType,
              framesDecoded: sample.framesDecoded,
              framesDropped: metrics.framesDropped,
              fps: rollingFps,
              bitrateMbps: metrics.bitrateMbps,
              jitterBufferMs: metrics.jitterBufferMs,
              jitterBufferMinimumMs: metrics.jitterBufferMinimumMs,
              jitterBufferTargetMs: metrics.jitterBufferTargetMs,
              decodeMs: metrics.decodeMs,
              estimatedPipelineMs: metrics.estimatedPipelineMs,
              packetLossPercent: metrics.packetLossPercent,
              roundTripMs: metrics.roundTripMs,
              poseSyncDelayMs,
              poseSyncErrorMs,
              poseSyncMode,
            }),
          )
        }
      } catch {
        // A disconnect can race with getStats(); cleanup owns the UI state.
      }
    }
    webRTCStatsTimerRef.current = window.setInterval(() => {
      void pollWebRTCStats()
    }, 1_000)

    const pendingRemoteCandidates: RTCIceCandidateInit[] = []
    let hasRemoteDescription = false

    webRTCSignal.addEventListener('open', () => {
      if (webRTCSignalRef.current !== webRTCSignal) return
      void requestWebRTCOffer()
    })

    webRTCSignal.addEventListener('message', (event) => {
      if (
        webRTCSignalRef.current !== webRTCSignal ||
        typeof event.data !== 'string'
      ) {
        return
      }
      let message: Record<string, unknown>
      try {
        message = JSON.parse(event.data) as Record<string, unknown>
      } catch {
        return
      }

      if (message.type === 'webrtc-answer' && typeof message.sdp === 'string') {
        if (
          message.sessionId !== activeWebRTCSessionId ||
          peerConnection.signalingState !== 'have-local-offer'
        ) {
          return
        }
        void peerConnection
          .setRemoteDescription({ type: 'answer', sdp: message.sdp })
          .then(async () => {
            hasRemoteDescription = true
            for (const candidate of pendingRemoteCandidates.splice(0)) {
              await peerConnection.addIceCandidate(candidate)
            }
          })
        return
      }

      if (
        message.type === 'webrtc-candidate' &&
        typeof message.candidate === 'string' &&
        message.sessionId === activeWebRTCSessionId
      ) {
        const candidate: RTCIceCandidateInit = {
          candidate: message.candidate,
          sdpMid: typeof message.sdpMid === 'string' ? message.sdpMid : null,
          sdpMLineIndex:
            typeof message.sdpMLineIndex === 'number'
              ? message.sdpMLineIndex
              : null,
        }
        if (hasRemoteDescription) {
          void peerConnection.addIceCandidate(candidate)
        } else {
          pendingRemoteCandidates.push(candidate)
        }
      }
    })

    socket.addEventListener('open', () => {
      if (socketRef.current === socket) {
        reconnectAttemptRef.current = 0
        commitStatus('connecting')
        commitError(null)
        requestKeyframe()
      }
    })

    socket.addEventListener('message', (event) => {
      if (socketRef.current !== socket) return

      if (event.data instanceof ArrayBuffer) {
        const browserReceivedAtMs = highResolutionEpochNowMs()
        lastFrameReceivedRef.current = browserReceivedAtMs
        commitScreenStale(false)
        const envelope = parseLiveFrameEnvelope(event.data)
        if (!envelope && hasLiveFrameEnvelopeMagic(event.data)) {
          // Never feed a malformed atomic envelope (header + JSON + payload)
          // into WebCodecs as if it were a legacy split-message payload.
          const active = activeMeasurementRef.current
          if (active) active.droppedBeforeDecode += 1
          awaitingH264Keyframe = true
          requestKeyframe()
          return
        }
        const metadata = envelope?.metadata ?? frameMetadataQueue.shift() ?? null
        const bytes = envelope?.payload ?? new Uint8Array(event.data)
        if (!metadata) return
        commitOrientation(metadata.orientation)
        let active = activeMeasurementRef.current

        if (
          active?.runId &&
          (!measurementProducerMatches(
              active,
              metadata.producerSessionId,
              metadata.captureSource,
            ) ||
            !captureContentIsVerifiedFresh(metadata))
        ) {
          cancelMeasurement(
            captureContentIsVerifiedFresh(metadata)
              ? 'producer-identity-mismatch'
              : `capture-content-unverified:${metadata.captureContentStatus ?? 'missing'}`,
          )
          active = null
        }

        if (active) {
          if (metadata.decoderCodec) {
            active.configuration.parameters.h264Codec = metadata.decoderCodec
          }
          if (metadata.h264BitstreamFormat) {
            active.configuration.parameters.h264BitstreamFormat =
              metadata.h264BitstreamFormat
          }
          const offset = metadata.clockOffsetMs
          const rawCaptureAtMacMs =
            metadata.captureTimestampValid === true
              ? phoneTimeOnMac(metadata.captureAtMs, offset)
              : null
          const callbackAtMacMs = phoneTimeOnMac(
            metadata.callbackAtMs,
            offset,
          )
          active.frames.set(metadata.frameId, {
            frameId: metadata.frameId,
            codec: metadata.codec,
            producerSessionId: metadata.producerSessionId,
            captureSource: metadata.captureSource,
            captureAtMacMs: rawCaptureAtMacMs,
            captureTimestampSource: metadata.captureTimestampSource,
            captureTimestampValid: metadata.captureTimestampValid,
            captureSampleAgeMs: metadata.captureSampleAgeMs,
            captureContentStatus: metadata.captureContentStatus,
            freshContent: metadata.freshContent,
            callbackAtMacMs,
            conversionStartedAtMacMs: phoneTimeOnMac(
              metadata.conversionStartedAtMs ?? 0,
              metadata.conversionStartedAtMs === null ? null : offset,
            ),
            conversionEndedAtMacMs: phoneTimeOnMac(
              metadata.conversionEndedAtMs ?? 0,
              metadata.conversionEndedAtMs === null ? null : offset,
            ),
            encodeStartedAtMacMs: phoneTimeOnMac(
              metadata.encodeStartedAtMs,
              offset,
            ),
            encodedAtMacMs: phoneTimeOnMac(metadata.encodedAtMs, offset),
            bridgeReceivedAtMs: metadata.bridgeReceivedAtMs,
            bridgeRelayedAtMs: metadata.bridgeRelayedAtMs,
            browserReceivedAtMs,
            decodedAtMs: null,
            renderRequestedAtMs: null,
            renderSchedulerGeneration: null,
            r3fFrameObservedAtMs: null,
            textureUploadCompletedAtMs: null,
            renderedAtMs: null,
            payloadBytes: metadata.payloadBytes ?? metadata.jpegBytes,
            clockRttMs: metadata.clockRttMs,
            poseScreenSkewMs: null,
          })
        }

        if (pendingFrame && active) active.droppedBeforeDecode += 1
        pendingFrame = { bytes, metadata, browserReceivedAtMs }
        void decodeNextFrame()
        return
      }

      if (typeof event.data !== 'string') return
      const message = parseLiveTextMessage(event.data)
      if (!message) return

      if (message.type === 'bridge-status') {
        handleBridgeStatus(message)
        return
      }

      if (message.type === 'frame-meta') {
        frameMetadataQueue.push(message)
        commitOrientation(message.orientation)
        return
      }

      if (message.type === 'pose') handlePoseMessage(message)
    })

    poseSocket.addEventListener('message', (event) => {
      if (poseSocketRef.current !== poseSocket || typeof event.data !== 'string') {
        return
      }
      const message = parseLiveTextMessage(event.data)
      if (!message) return
      if (message.type === 'bridge-status') {
        handleBridgeStatus(message)
      } else if (message.type === 'pose') {
        handlePoseMessage(message)
      } else if (message.type === 'browser-benchmark-prepare') {
        applyBrowserBenchmarkPrepare(message)
      } else if (message.type === 'encoder-status') {
        const receiverStatusAtMs = highResolutionEpochNowMs()
        lastCaptureHeartbeatRef.current = receiverStatusAtMs
        firstCaptureHeartbeatRef.current ??= receiverStatusAtMs
        encoderMeasurementConfigurationRef.current = {
          targetFps:
            message.targetFps ??
            encoderMeasurementConfigurationRef.current.targetFps,
          encoderProfile:
            message.encoderProfile ??
            encoderMeasurementConfigurationRef.current.encoderProfile,
          encoderTuningRequested: message.encoderTuningRequested,
          encoderTuningActive: message.encoderTuningActive,
          producerSessionId: message.producerSessionId,
          captureSource: message.captureSource,
          captureShortEdgeRequested: message.captureShortEdgeRequested,
          captureShortEdgeActive: message.captureShortEdgeActive,
          captureWidthActive: message.captureWidthActive,
          captureHeightActive: message.captureHeightActive,
          captureStreamGeneration: message.captureStreamGeneration,
          thermalState: message.thermalState,
          frameAckWindow: message.frameAckWindow,
        }
        decoderBacklogPolicy = h264DecoderBacklogPolicy(
          h264DecoderSelection, requestedH264BitstreamFormat,
          message.frameAckWindow,
        )
        const active = activeMeasurementRef.current
        if (active?.runId &&
            active.configuration.parameters.frameAckWindow !== message.frameAckWindow) {
          cancelMeasurement('frame-window-changed-during-run')
        }
        if (
          active?.runId &&
          (!measurementProducerMatches(
              active,
              message.producerSessionId,
              message.captureSource,
            ) ||
            !captureContentIsVerifiedFresh(message))
        ) {
          cancelMeasurement(
            !captureContentIsVerifiedFresh(message)
              ? `capture-content-unverified:${message.captureContentStatus ?? 'missing'}`
              : 'producer-identity-mismatch',
          )
        }
        updateMeasurementThermalState(active, message.thermalState)
        setStats((current) => ({
          ...current,
          codec: message.codec ?? current.codec,
          captureState: message.captureState,
          capturedFrames: message.captured,
        }))
        if (
          message.codec === 'h264' &&
          poseSocket.readyState === WebSocket.OPEN
        ) {
          sendH264ReceiverStatus(message.timestampMs)
        }
      } else if (message.type === 'benchmark-status') {
        if (message.phase === 'started') {
          startMeasurement(
            message.runId,
            message.targetFps ?? undefined,
            message.encoderProfileActive ??
              message.encoderProfile ??
              undefined,
            message.encoderTuning,
            message.encoderTuningActive ?? undefined,
            message.producerSessionId,
            message.captureSource,
            message.captureShortEdgeRequested,
            message.captureShortEdgeActive,
            message.captureWidthActive,
            message.captureHeightActive,
            message.captureStreamGeneration,
            message.thermalState,
          )
        } else if (message.phase === 'completed') {
          const active = activeMeasurementRef.current
          if (
            active?.runId === message.runId &&
            !measurementProducerMatches(
              active,
              message.producerSessionId,
              message.captureSource,
            )
          ) {
            cancelMeasurement('producer-identity-mismatch')
          } else if (active?.runId === message.runId) {
            updateMeasurementThermalState(
              active,
              message.thermalState,
              'completed',
            )
            completeBenchmarkMeasurement(message.runId)
          }
        } else if (activeMeasurementRef.current?.runId === message.runId) {
          cancelMeasurement('phone-cancelled', false)
        }
      }
    })

    poseSocket.addEventListener('open', () => {
      if (poseSocketRef.current === poseSocket) {
        sendH264FormatAfterReceiverStatus(
          () => sendH264ReceiverStatus(),
          sendH264OutputFormat,
        )
        sendPosePresentationMode(posePresentationModeRef.current)
      }
    })

    poseSocket.addEventListener('error', () => {
      if (poseSocketRef.current === poseSocket) setPoseStale(true)
    })

    poseSocket.addEventListener('close', () => {
      if (poseSocketRef.current !== poseSocket) return
      poseSocketRef.current = null
      setPoseStale(true)
      scheduleReconnect()
    })

    webRTCSignal.addEventListener('close', () => {
      if (webRTCSignalRef.current !== webRTCSignal) return
      webRTCSignalRef.current = null
      scheduleReconnect()
    })

    socket.addEventListener('error', () => {
      if (socketRef.current !== socket) return
      commitStatus('error')
      commitError('Cannot reach the local phone bridge on port 4319.')
    })

    socket.addEventListener('close', () => {
      if (socketRef.current !== socket) return
      socketRef.current = null
      browserDecoderHealthCountersRef.current = null
      cancelMeasurement('frame-socket-closed')
      scheduleReconnect()
    })
  }, [
    cancelMeasurement,
    commitError,
    commitMedia,
    commitOrientation,
    commitScreenStale,
    commitStatus,
    completeBenchmarkMeasurement,
    currentErrorRef,
    markTextureUploadCompleted,
    liveRenderScheduler,
    releaseResources,
    sendH264OutputFormat,
    sendPosePresentationMode,
    startMeasurement,
  ])

  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  useEffect(() => {
    const sendReceiverStatus = () => {
      sendH264FormatAfterReceiverStatus(
        () => receiverStatusSenderRef.current(),
        sendH264OutputFormat,
      )
    }
    window.addEventListener('focus', sendReceiverStatus)
    window.addEventListener('blur', sendReceiverStatus)
    document.addEventListener('visibilitychange', sendReceiverStatus)
    return () => {
      window.removeEventListener('focus', sendReceiverStatus)
      window.removeEventListener('blur', sendReceiverStatus)
      document.removeEventListener('visibilitychange', sendReceiverStatus)
    }
  }, [sendH264OutputFormat])

  useEffect(() => {
    const autoConnectTimer = window.setTimeout(() => connectRef.current(), 0)
    return () => {
      window.clearTimeout(autoConnectTimer)
      disconnect()
    }
  }, [disconnect])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = highResolutionEpochNowMs()
      const lastFrame = lastFrameReceivedRef.current
      const lastPose = lastPoseReceivedRef.current
      const active = activeMeasurementRef.current

      const lastCaptureHeartbeat = lastCaptureHeartbeatRef.current
      commitScreenStale(
        screenStreamIsStale(
          now,
          lastFrame,
          lastCaptureHeartbeat,
          firstCaptureHeartbeatRef.current,
        ),
      )
      if (
        browserReceiverStatusHeartbeatDue(
          now,
          lastReceiverStatusSentAtRef.current,
        )
      ) {
        receiverStatusSenderRef.current()
      }
      setPoseStale(lastPose !== null && now - lastPose > 500)

      if (active) {
        setMeasurement((current) => ({
          ...current,
          elapsedMs: now - active.startedAtMs,
          receivedFrames: active.frames.size,
          renderedFrames: [...active.frames.values()].filter(
            (frame) => frame.renderedAtMs !== null,
          ).length,
          poseSamples: active.poses.length,
          poseRenderSamples: active.poseRenders.length,
        }))
      }
    }, 250)

    return () => window.clearInterval(timer)
  }, [commitScreenStale])

  return {
    calibratePose,
    connect,
    disconnect,
    downloadMeasurementReport,
    error,
    finishMeasurement,
    hasManualLevel,
    liveFrameRenderRef,
    markFrameRendered,
    measurement,
    media,
    orientation,
    poseReady,
    poseDiagnostics,
    posePresentationMode,
    poseRef,
    recordPoseRenderSample,
    reportPoseRenderDiagnostics,
    poseStale,
    screenStale,
    setPosePresentationMode,
    startMeasurement,
    stats,
    status,
    ultraPoseKinematicsRef,
  }
}
