import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { WebSocket, WebSocketServer } from 'ws'
import { qualitySnapshotResultError } from './quality-snapshot-contract.mjs'
import { parseFrameTransportConfiguration, rawFrameLivenessExpired } from './frame-transport-contract.mjs'
import { rawACKTiming, TransportTraceStore } from './transport-trace.mjs'
import {
  captureShortEdges,
  encoderTuningConfigurationError,
  encoderTunings,
  isEncoderTuning,
  normalizeEncoderTuning,
} from './encoder-tuning.mjs'
import {
  normalizeProducerIdentity,
  sameProducerIdentity,
  selectUniqueProducerPair,
} from './producer-identity.mjs'

const port = Number.parseInt(process.env.PHONE_BRIDGE_PORT ?? '4319', 10)
const framePort = Number.parseInt(
  process.env.PHONE_BRIDGE_FRAME_PORT ?? String(port + 1),
  10,
)
// Bind dual-stack so forge.local can use the iPhone USB link's scoped IPv6
// endpoint while IPv4 Wi-Fi and loopback clients keep working unchanged.
const host = process.env.PHONE_BRIDGE_HOST ?? '::'
const clients = new Map()
const clientDetails = new Map()
const rawFramePhones = new Map()
const transportTrace = new TransportTraceStore()
const browserClientRoles = new Set([
  'browser',
  'browser-pose',
  'browser-webrtc',
])
const blockedBrowserClientIds = new Set()
let activeBrowserFrameSocket = null
let activeBrowserClientId = null
let browserLeaseGeneration = 0
let browserLeaseActivatedAtMs = 0
let lastAutomaticBrowserLeaseHandoffAtMs = 0
const browserLeaseFailures = new Map()
let activeBenchmark = null
let activeBenchmarkTimer = null
let pendingQualitySnapshot = null
const pendingFrameMetadata = new Map()
const frameEnvelopeMagic = Buffer.from('P3D1', 'ascii')
const frameEnvelopeHeaderBytes = 8
// At the current 5 Mbps H.264 target, 64 KiB is about 105 ms of user-space
// backlog. Once a browser reaches this limit, stop forwarding dependent frames
// and resume only from a fresh keyframe instead of draining seconds of stale UI.
const maxBrowserVideoBufferedBytes = 64 * 1024
const browserTelemetryFreshnessMs = 2_500
const browserClockFutureToleranceMs = 250
const browserLeaseHealthGraceMs = 3_500
const browserLeaseHealthCheckIntervalMs = 500
const browserLeaseHandoffCooldownMs = 4_000
const browserLeaseFailureBackoffMs = 10_000
const maximumBrowserLeaseFailureBackoffMs = 60_000
const browserPrepareTimeoutMs = 8_000
const browserDecoderModes = Object.freeze(['software', 'auto', 'hardware'])
const diagnostics = {
  receiverSamples: [],
  encoderSamples: [],
  benchmarkEvents: [],
  browserLeaseEvents: [],
  latestBrowserBenchmark: null,
}
const benchmarkCommandTimers = new Map()
const freshCaptureContentStatuses = new Set(['complete', 'started'])
const isDirectExecution =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href

function preciseWallClockMs() {
  // Every downstream bridge/browser timestamp is Date.now()-based. Staying in
  // that same wall-clock domain is more important than fractional resolution:
  // performance.timeOrigin does not follow a later NTP or manual clock step.
  return Date.now()
}

function retainDiagnostic(collection, sample) {
  collection.push({ ...sample, bridgeReceivedAtMs: Date.now() })
  if (collection.length > 300) collection.splice(0, collection.length - 300)
}

function isRecentBrowserTimestamp(
  timestampMs,
  nowMs,
  maximumAgeMs = browserTelemetryFreshnessMs,
) {
  if (!Number.isFinite(timestampMs) || !Number.isFinite(nowMs)) return false
  const ageMs = nowMs - timestampMs
  return ageMs >= -browserClockFutureToleranceMs && ageMs < maximumAgeMs
}

export function browserDecoderAcceleration(mode) {
  if (mode === 'hardware') return 'prefer-hardware'
  if (mode === 'auto') return 'no-preference'
  if (mode === 'software') return 'prefer-software'
  return null
}

export function h264OutputFormatShouldForward(lastForwarded, requested) {
  return (
    (requested === 'annex-b' || requested === 'avcc') &&
    lastForwarded !== requested
  )
}

export function socketAddressScope(address) {
  if (typeof address !== 'string' || address.length === 0) return 'unknown'

  const withoutIPv4Mapping = address.startsWith('::ffff:')
    ? address.slice('::ffff:'.length)
    : address
  const normalized = withoutIPv4Mapping.split('%')[0].toLowerCase()

  if (normalized === '::1') return 'loopback'
  const firstHextet = /^[0-9a-f]{1,4}:/.test(normalized)
    ? Number.parseInt(normalized.split(':', 1)[0], 16)
    : null
  if (
    firstHextet !== null &&
    firstHextet >= 0xfe80 &&
    firstHextet <= 0xfebf
  ) {
    return 'ipv6-link-local'
  }
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return 'ipv6-unique-local'
  }

  const octets = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)
    ? normalized.split('.').map((value) => Number.parseInt(value, 10))
    : []
  if (
    octets.length === 4 &&
    octets.every(
      (value) => Number.isInteger(value) && value >= 0 && value <= 255,
    )
  ) {
    if (octets[0] === 127) return 'loopback'
    if (octets[0] === 169 && octets[1] === 254) return 'ipv4-link-local'
    if (
      octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
    ) {
      return 'ipv4-private-lan'
    }
  }

  return 'public-or-other'
}

export function phoneTransportSnapshot(role, socket, details) {
  const isRawFrameSocket = role === 'raw-frame'
  const remoteAddress = isRawFrameSocket
    ? (socket?.remoteAddress ?? details?.remoteAddress ?? null)
    : (details?.remoteAddress ?? null)
  return {
    role,
    addressFamily: isRawFrameSocket
      ? (socket?.remoteFamily ?? details?.addressFamily ?? null)
      : (details?.addressFamily ?? null),
    remoteAddress,
    remotePort: isRawFrameSocket
      ? (socket?.remotePort ?? details?.remotePort ?? null)
      : (details?.remotePort ?? null),
    localAddress: isRawFrameSocket
      ? (socket?.localAddress ?? details?.localAddress ?? null)
      : (details?.localAddress ?? null),
    localPort: isRawFrameSocket
      ? (socket?.localPort ?? details?.localPort ?? null)
      : (details?.localPort ?? null),
    addressScope: socketAddressScope(remoteAddress),
  }
}

function currentPhoneTransports() {
  const websocketTransports = [...clients]
    .filter(([, role]) => role === 'phone' || role === 'phone-pose')
    .map(([socket, role]) => {
      const transportRole = role === 'phone' ? 'websocket-frame' : role
      return phoneTransportSnapshot(
        transportRole,
        socket,
        clientDetails.get(socket),
      )
    })
  const rawTransports = [...rawFramePhones].map(([socket, details]) =>
    phoneTransportSnapshot('raw-frame', socket, details),
  )
  return [...websocketTransports, ...rawTransports]
}

export function browserPrepareAckValidationError(run, socketDetails, message) {
  if (!run || run.phase !== 'browser-preparing') {
    return 'browser-prepare-not-pending'
  }
  if (socketDetails?.clientId !== run.browserClientId) {
    return 'browser-prepare-client-mismatch'
  }
  if (message.runId !== run.runId) return 'browser-prepare-run-id-mismatch'
  if (message.browserConfigId !== run.browserConfigId) {
    return 'browser-prepare-config-id-mismatch'
  }
  if (message.status !== 'ready') {
    return `browser-prepare-${message.status === 'failed' ? 'failed' : 'invalid-status'}`
  }
  if (
    message.decoderModeRequested !== run.requestedDecoderMode ||
    message.decoderModeApplied !== run.requestedDecoderMode
  ) {
    return 'browser-prepare-decoder-mode-mismatch'
  }
  if (
    message.decoderAccelerationConfigured !==
    run.requestedDecoderAcceleration
  ) {
    return 'browser-prepare-decoder-acceleration-mismatch'
  }
  if (
    !Number.isSafeInteger(message.browserConfigGeneration) ||
    message.browserConfigGeneration <= 0
  ) {
    return 'browser-prepare-generation-invalid'
  }
  if (
    message.browserConfigGeneration !== run.requestedBrowserConfigGeneration
  ) {
    return 'browser-prepare-generation-mismatch'
  }
  if (!Number.isSafeInteger(message.renderedFrameId)) {
    return 'browser-prepare-rendered-frame-missing'
  }
  if (!Number.isFinite(message.preparedAtMs)) {
    return 'browser-prepare-timestamp-invalid'
  }
  if (
    !Number.isFinite(message.prepareDurationMs) ||
    message.prepareDurationMs < 0
  ) {
    return 'browser-prepare-duration-invalid'
  }
  return null
}

export function browserPrepareAckShouldAbortRun(run, message, error) {
  return Boolean(
    error &&
      run?.phase === 'browser-preparing' &&
      message?.runId === run.runId,
  )
}

function isBrowserTimestampFromLease(
  timestampMs,
  nowMs,
  activatedAtMs,
  maximumAgeMs = browserTelemetryFreshnessMs,
) {
  return (
    Number.isFinite(activatedAtMs) &&
    timestampMs >= activatedAtMs &&
    isRecentBrowserTimestamp(timestampMs, nowMs, maximumAgeMs)
  )
}

export function beginBrowserFrameLease(
  details,
  generation,
  activatedAtMs,
) {
  if (!details) return
  details.browserLeaseGeneration = generation
  details.browserLeaseActivatedAtMs = activatedAtMs
  details.lastFrameRelayedAtMs = null
  details.lastFrameRelayedId = null
}

export function beginBrowserReceiverLease(
  details,
  generation,
  activatedAtMs,
) {
  if (!details) return
  details.browserLeaseGeneration = generation
  details.browserLeaseActivatedAtMs = activatedAtMs
  details.lastFrameReceivedAtMs = null
  details.lastFrameRenderedAtMs = null
}

export function startBrowserLeaseHealthTimer(
  check,
  intervalMs = browserLeaseHealthCheckIntervalMs,
  schedule = setInterval,
  now = Date.now,
) {
  const timer = schedule(() => check(now()), intervalMs)
  if (typeof timer?.unref === 'function') timer.unref()
  return timer
}

export function browserSocketOwnsFrameLease(socket, activeSocket) {
  return activeSocket !== null && socket === activeSocket
}

export function browserBenchmarkReadinessError(
  frameDetails,
  receiverDetails,
  activeClientId,
  nowMs,
  maximumAgeMs = browserTelemetryFreshnessMs,
) {
  const frameClientId = frameDetails?.clientId ?? null
  if (!frameClientId) return 'browser-frame-client-id-missing'
  if (frameClientId !== activeClientId) return 'browser-frame-client-not-active'
  const leaseGeneration = frameDetails?.browserLeaseGeneration
  const leaseActivatedAtMs = frameDetails?.browserLeaseActivatedAtMs
  if (!Number.isSafeInteger(leaseGeneration) || leaseGeneration <= 0) {
    return 'browser-frame-lease-generation-missing'
  }
  if (!Number.isFinite(leaseActivatedAtMs)) {
    return 'browser-frame-lease-activation-missing'
  }
  if (
    !isBrowserTimestampFromLease(
      frameDetails.lastFrameRelayedAtMs,
      nowMs,
      leaseActivatedAtMs,
      maximumAgeMs,
    )
  ) {
    return 'browser-frame-relay-not-recent'
  }
  if (receiverDetails?.clientId !== frameClientId) {
    return 'browser-receiver-client-mismatch'
  }
  if (receiverDetails.browserLeaseGeneration !== leaseGeneration) {
    return 'browser-receiver-lease-generation-mismatch'
  }
  if (receiverDetails.browserLeaseActivatedAtMs !== leaseActivatedAtMs) {
    return 'browser-receiver-lease-activation-mismatch'
  }
  if (
    !isBrowserTimestampFromLease(
      receiverDetails.lastReceiverStatusAtMs,
      nowMs,
      leaseActivatedAtMs,
      maximumAgeMs,
    )
  ) {
    return 'browser-receiver-status-not-recent'
  }
  if (receiverDetails.receiverVisibilityState !== 'visible') {
    return 'browser-receiver-not-visible'
  }
  if (receiverDetails.receiverScreenStale !== false) {
    return 'browser-receiver-screen-stale'
  }
  if (
    !isBrowserTimestampFromLease(
      receiverDetails.lastFrameReceivedAtMs,
      nowMs,
      leaseActivatedAtMs,
      maximumAgeMs,
    )
  ) {
    return 'browser-frame-receive-not-recent'
  }
  if (
    !isBrowserTimestampFromLease(
      receiverDetails.lastFrameRenderedAtMs,
      nowMs,
      leaseActivatedAtMs,
      maximumAgeMs,
    )
  ) {
    return 'browser-frame-render-not-recent'
  }
  return null
}

export function benchmarkBrowserReceiverStatusError(run, details) {
  if (details?.clientId !== run.browserClientId) {
    return 'pinned-browser-client-id-changed'
  }
  if (details.receiverVisibilityState !== 'visible') {
    return 'pinned-browser-became-hidden'
  }

  // Browser prepare flushes the old decoder before the new capture command is
  // sent, and capture reconfiguration can then leave the receiver without a
  // frame during the requested/warmup phase. That gap is expected. Once the
  // phone declares the measured interval started, freshness is strict again.
  if (
    (run.phase === 'running' || run.phase === 'awaiting-report') &&
    details.receiverScreenStale !== false
  ) {
    return 'pinned-browser-stream-became-stale'
  }
  if (
    run.phase !== 'browser-preparing' &&
    (details.browserConfigId !== run.browserConfigId ||
      details.browserConfigGeneration !== run.browserConfigGeneration ||
      details.decoderModeRequested !== run.requestedDecoderMode ||
      details.decoderModeApplied !== run.appliedDecoderMode ||
      details.decoderAccelerationConfigured !==
        run.decoderAccelerationConfigured)
  ) {
    return 'pinned-browser-config-changed'
  }
  return null
}

export function browserReceiverServerState(
  receiverDetails,
  frameDetails,
  activeClientId,
  nowMs,
) {
  const receiverClientId = receiverDetails?.clientId ?? null
  const frameClientId = frameDetails?.clientId ?? null
  const isActiveFrameClient =
    receiverClientId !== null &&
    receiverClientId === activeClientId &&
    receiverClientId === frameClientId
  return {
    clientId: receiverClientId,
    activeFrameClientId: activeClientId,
    isActiveFrameClient,
    browserLeaseGeneration: isActiveFrameClient
      ? (frameDetails?.browserLeaseGeneration ?? null)
      : null,
    browserLeaseActivatedAtMs: isActiveFrameClient
      ? (frameDetails?.browserLeaseActivatedAtMs ?? null)
      : null,
    receiverLeaseGeneration:
      receiverDetails?.browserLeaseGeneration ?? null,
    lastFrameRelayedAtMs: isActiveFrameClient
      ? (frameDetails?.lastFrameRelayedAtMs ?? null)
      : null,
    lastFrameRelayedId: isActiveFrameClient
      ? (frameDetails?.lastFrameRelayedId ?? null)
      : null,
    lastReceiverStatusAtMs: receiverDetails?.lastReceiverStatusAtMs ?? null,
    reportedLastFrameReceivedAtMs:
      receiverDetails?.lastFrameReceivedAtMs ?? null,
    reportedLastFrameRenderedAtMs:
      receiverDetails?.lastFrameRenderedAtMs ?? null,
    benchmarkReadinessError: isActiveFrameClient
      ? browserBenchmarkReadinessError(
          frameDetails,
          receiverDetails,
          activeClientId,
          nowMs,
        )
      : 'browser-receiver-not-active-frame-client',
  }
}

export function activeBrowserLeaseFailureReason(
  frameDetails,
  receiverDetails,
  activeClientId,
  nowMs,
  activatedAtMs,
  graceMs = browserLeaseHealthGraceMs,
) {
  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(activatedAtMs) ||
    nowMs - activatedAtMs < graceMs
  ) {
    return null
  }
  if (
    !frameDetails?.clientId ||
    frameDetails.clientId !== activeClientId ||
    frameDetails.browserLeaseActivatedAtMs !== activatedAtMs ||
    !isBrowserTimestampFromLease(
      frameDetails.lastFrameRelayedAtMs,
      nowMs,
      activatedAtMs,
    )
  ) {
    return null
  }
  if (
    receiverDetails?.clientId !== activeClientId ||
    receiverDetails.browserLeaseGeneration !==
      frameDetails.browserLeaseGeneration ||
    receiverDetails.browserLeaseActivatedAtMs !== activatedAtMs
  ) {
    return 'active-browser-receiver-missing'
  }
  if (
    !isBrowserTimestampFromLease(
      receiverDetails.lastReceiverStatusAtMs,
      nowMs,
      activatedAtMs,
    )
  ) {
    return 'active-browser-receiver-status-not-recent'
  }
  if (
    !isBrowserTimestampFromLease(
      receiverDetails.lastFrameRenderedAtMs,
      nowMs,
      activatedAtMs,
    )
  ) {
    return 'active-browser-render-not-recent'
  }
  return null
}

export function selectBrowserLeaseHandoffCandidate(
  candidates,
  activeClientId,
  nowMs,
) {
  return (
    candidates
      .filter(
        (candidate) =>
          candidate.clientId &&
          candidate.clientId !== activeClientId &&
          candidate.frameConnected === true &&
          candidate.visibilityState === 'visible' &&
          isRecentBrowserTimestamp(candidate.lastReceiverStatusAtMs, nowMs) &&
          (candidate.blockedUntilMs ?? 0) <= nowMs,
      )
      .sort(
        (left, right) =>
          Number(right.hasFocus === true) - Number(left.hasFocus === true) ||
          right.lastReceiverStatusAtMs - left.lastReceiverStatusAtMs ||
          (right.frameConnectedAtMs ?? 0) -
            (left.frameConnectedAtMs ?? 0),
      )[0] ?? null
  )
}

function producerIdentityFrom(value) {
  return normalizeProducerIdentity(
    value?.producerSessionId,
    value?.captureSource,
  )
}

function queryProducerIdentityDetails(url) {
  const producerSessionId = url.searchParams.get('producerSessionId')
  const captureSource = url.searchParams.get('captureSource')
  const identity = normalizeProducerIdentity(producerSessionId, captureSource)
  const supplied = producerSessionId !== null || captureSource !== null
  return {
    producerSessionId: identity?.producerSessionId ?? null,
    captureSource: identity?.captureSource ?? null,
    producerIdentityValid: identity ? true : supplied ? false : null,
  }
}

function observeProducerIdentity(details, value) {
  if (!details) return false
  const observed = producerIdentityFrom(value)
  if (!observed) {
    if (
      value?.producerSessionId !== undefined ||
      value?.captureSource !== undefined
    ) {
      details.producerIdentityValid = false
    }
    return false
  }

  const established = producerIdentityFrom(details)
  if (
    details.producerIdentityValid === false ||
    (established && !sameProducerIdentity(established, observed))
  ) {
    details.producerIdentityValid = false
    return false
  }

  details.producerSessionId = observed.producerSessionId
  details.captureSource = observed.captureSource
  details.producerIdentityValid = true
  return true
}

function updateCaptureFreshness(details, value) {
  if (!details) return
  details.lastCaptureContentStatus =
    typeof value?.captureContentStatus === 'string'
      ? value.captureContentStatus
      : null
  details.lastFreshContent =
    typeof value?.freshContent === 'boolean' ? value.freshContent : null
}

function updateCaptureConfiguration(details, value) {
  if (!details) return
  const dimensionsConflict =
    (positiveSafeInteger(value?.width) &&
      positiveSafeInteger(value?.captureWidthActive) &&
      value.width !== value.captureWidthActive) ||
    (positiveSafeInteger(value?.height) &&
      positiveSafeInteger(value?.captureHeightActive) &&
      value.height !== value.captureHeightActive)
  const width = value?.captureWidthActive ?? value?.width
  const height = value?.captureHeightActive ?? value?.height
  details.captureShortEdgeRequested = positiveSafeInteger(
    value?.captureShortEdgeRequested,
  )
    ? value.captureShortEdgeRequested
    : null
  details.captureShortEdgeActive = dimensionsConflict
    ? null
    : positiveSafeInteger(value?.captureShortEdgeActive)
      ? value.captureShortEdgeActive
      : positiveSafeInteger(width) && positiveSafeInteger(height)
        ? Math.min(width, height)
        : null
  details.captureWidthActive =
    !dimensionsConflict && positiveSafeInteger(width) ? width : null
  details.captureHeightActive =
    !dimensionsConflict && positiveSafeInteger(height) ? height : null
  details.captureStreamGeneration = positiveSafeInteger(
    value?.captureStreamGeneration,
  )
    ? value.captureStreamGeneration
    : null
}

export function captureConfigurationMatches(details, required) {
  if (!required) return true
  return (
    details?.captureStreamGeneration === required.captureStreamGeneration &&
    details?.captureShortEdgeActive === required.captureShortEdgeActive &&
    details?.captureWidthActive === required.captureWidthActive &&
    details?.captureHeightActive === required.captureHeightActive &&
    (details?.captureShortEdgeRequested === null ||
      details?.captureShortEdgeRequested ===
        required.captureShortEdgeRequested)
  )
}

export function captureFreshnessError(value) {
  const status =
    typeof value?.captureContentStatus === 'string'
      ? value.captureContentStatus
      : null
  if (!freshCaptureContentStatuses.has(status)) {
    return `capture-content-${status ?? 'missing'}`
  }
  if (value?.freshContent !== true) return 'capture-content-not-fresh'
  return null
}

function benchmarkProducerMessageError(run, socket, value, channel) {
  if (socket !== run.phonePoseSocket) return `${channel}-not-from-pinned-phone`
  const observed = producerIdentityFrom(value)
  if (!observed) return `${channel}-producer-identity-missing`
  if (!sameProducerIdentity(run, observed)) {
    return `${channel}-producer-identity-mismatch`
  }
  return null
}

export function benchmarkEncoderStatusValidationError(run, message) {
  if (run.phase !== 'running' && run.phase !== 'awaiting-report') return null

  const thermalStateError = optionalThermalStateValidationError(message)
  if (thermalStateError) return thermalStateError

  if (message.encoderProfileActive == null) {
    return 'encoder-active-profile-missing'
  }
  if (
    message.encoderProfileActive !== 'legacy' &&
    message.encoderProfileActive !== 'low-latency'
  ) {
    return 'encoder-active-profile-invalid'
  }
  if (
    run.activeEncoderProfile == null ||
    message.encoderProfileActive !== run.activeEncoderProfile
  ) {
    return 'encoder-active-profile-changed'
  }

  if (message.encoderTuningActive == null) {
    return 'encoder-active-tuning-missing'
  }
  if (!isEncoderTuning(message.encoderTuningActive)) {
    return 'encoder-active-tuning-invalid'
  }
  if (
    run.activeEncoderTuning == null ||
    message.encoderTuningActive !== run.activeEncoderTuning
  ) {
    return 'encoder-active-tuning-changed'
  }
  const captureConfigurationError = measuredCaptureConfigurationError(
    run,
    message,
    { requireNamedDimensions: true },
  )
  if (captureConfigurationError) return captureConfigurationError
  return null
}

export function benchmarkEncoderReadinessError(run, message) {
  if (run.phase !== 'running' && run.phase !== 'awaiting-report') return null
  return message.captureState !== 'streaming'
    ? `capture-state-${message.captureState ?? 'missing'}`
    : message.encoderStatus !== 0
      ? `encoder-status-${message.encoderStatus ?? 'missing'}`
      : message.codec !== 'H.264'
        ? `capture-codec-${message.codec ?? 'missing'}`
        : captureFreshnessError(message)
}

function positiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0
}

const thermalStates = Object.freeze([
  'nominal',
  'fair',
  'serious',
  'critical',
])

function isThermalState(value) {
  return thermalStates.includes(value)
}

export function worstThermalState(current, observed) {
  if (!isThermalState(observed)) return current ?? null
  if (!isThermalState(current)) return observed
  return thermalStates.indexOf(observed) > thermalStates.indexOf(current)
    ? observed
    : current
}

export function observeBenchmarkThermalState(run, observed, phase = null) {
  if (!run || !isThermalState(observed)) return false
  if (phase === 'started') run.thermalStateStart = observed
  if (phase === 'completed') run.thermalStateEnd = observed
  run.thermalStateWorstObserved = worstThermalState(
    run.thermalStateWorstObserved,
    observed,
  )
  run.thermalContaminated =
    run.thermalStateWorstObserved === 'serious' ||
    run.thermalStateWorstObserved === 'critical'
  return true
}

function optionalThermalStateValidationError(message) {
  return message.thermalState === undefined ||
    message.thermalState === null ||
    isThermalState(message.thermalState)
    ? null
    : 'thermal-state-invalid'
}

export function captureDimensionsValidationError(
  shortEdge,
  width,
  height,
) {
  if (!captureShortEdges.includes(shortEdge)) {
    return 'capture-active-short-edge-invalid'
  }
  if (!positiveSafeInteger(width) || !positiveSafeInteger(height)) {
    return 'capture-active-dimensions-invalid'
  }
  if (Math.min(width, height) !== shortEdge) {
    return 'capture-active-dimensions-short-edge-mismatch'
  }
  return null
}

export function benchmarkCaptureStatusValidationError(run, message) {
  if (message.captureShortEdgeRequested !== run.requestedCaptureShortEdge) {
    return 'requested-capture-short-edge-mismatch'
  }
  if (message.captureShortEdgeActive !== run.requestedCaptureShortEdge) {
    return 'active-capture-short-edge-mismatch'
  }
  const dimensionsError = captureDimensionsValidationError(
    message.captureShortEdgeActive,
    message.captureWidthActive,
    message.captureHeightActive,
  )
  if (dimensionsError) return dimensionsError
  if (!positiveSafeInteger(message.captureStreamGeneration)) {
    return 'capture-stream-generation-invalid'
  }
  if (
    run.captureStreamGeneration !== null &&
    message.captureStreamGeneration !== run.captureStreamGeneration
  ) {
    return 'capture-stream-generation-changed'
  }
  if (
    run.captureShortEdgeActive !== null &&
    message.captureShortEdgeActive !== run.captureShortEdgeActive
  ) {
    return 'active-capture-short-edge-changed'
  }
  if (
    run.captureWidthActive !== null &&
    message.captureWidthActive !== run.captureWidthActive
  ) {
    return 'active-capture-width-changed'
  }
  if (
    run.captureHeightActive !== null &&
    message.captureHeightActive !== run.captureHeightActive
  ) {
    return 'active-capture-height-changed'
  }
  return null
}

export function measuredCaptureConfigurationError(
  run,
  message,
  { requireNamedDimensions = false } = {},
) {
  if (!positiveSafeInteger(run.captureStreamGeneration)) {
    return 'capture-stream-generation-not-pinned'
  }
  if (!positiveSafeInteger(message.captureStreamGeneration)) {
    return 'capture-stream-generation-missing'
  }
  if (message.captureStreamGeneration !== run.captureStreamGeneration) {
    return 'capture-stream-generation-drift'
  }
  if (
    message.captureShortEdgeRequested !== undefined &&
    message.captureShortEdgeRequested !== run.requestedCaptureShortEdge
  ) {
    return 'requested-capture-short-edge-drift'
  }
  if (
    requireNamedDimensions &&
    message.captureShortEdgeRequested === undefined
  ) {
    return 'requested-capture-short-edge-missing'
  }

  const activeShortEdge =
    message.captureShortEdgeActive ?? Math.min(message.width, message.height)
  const activeWidth = message.captureWidthActive ?? message.width
  const activeHeight = message.captureHeightActive ?? message.height
  if (
    requireNamedDimensions &&
    (message.captureShortEdgeActive === undefined ||
      message.captureWidthActive === undefined ||
      message.captureHeightActive === undefined)
  ) {
    return 'active-capture-dimensions-missing'
  }
  const dimensionsError = captureDimensionsValidationError(
    activeShortEdge,
    activeWidth,
    activeHeight,
  )
  if (dimensionsError) return dimensionsError
  if (
    activeShortEdge !== run.captureShortEdgeActive ||
    activeWidth !== run.captureWidthActive ||
    activeHeight !== run.captureHeightActive
  ) {
    return 'active-capture-dimensions-drift'
  }
  if (
    (message.width !== undefined || message.height !== undefined) &&
    (message.width !== run.captureWidthActive ||
      message.height !== run.captureHeightActive)
  ) {
    return 'frame-capture-dimensions-drift'
  }
  return null
}

function localAddresses() {
  return Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address)
}

function isLoopbackAddress(address) {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  )
}

export function shouldPruneBrowserClient(activeClientId, candidateClientId) {
  return (
    typeof activeClientId === 'string' &&
    activeClientId.length > 0 &&
    typeof candidateClientId === 'string' &&
    candidateClientId.length > 0 &&
    candidateClientId !== activeClientId
  )
}

export function shouldReplaceBrowserClientSocket(
  existingRole,
  existingClientId,
  nextRole,
  nextClientId,
) {
  return (
    browserClientRoles.has(existingRole) &&
    existingRole === nextRole &&
    typeof existingClientId === 'string' &&
    existingClientId.length > 0 &&
    existingClientId === nextClientId
  )
}

function replaceSupersededBrowserClientSockets(socket, role, clientId) {
  if (!browserClientRoles.has(role) || clientId === null) return
  for (const [candidate, candidateRole] of clients) {
    if (candidate === socket) continue
    const candidateClientId = clientDetails.get(candidate)?.clientId ?? null
    if (
      shouldReplaceBrowserClientSocket(
        candidateRole,
        candidateClientId,
        role,
        clientId,
      )
    ) {
      candidate.close(4002, 'browser session connection replaced')
    }
  }
}

function pruneInactiveBrowserClients() {
  const prunedClientIds = new Set()

  for (const [client, role] of clients) {
    if (!browserClientRoles.has(role)) continue
    const candidateClientId = clientDetails.get(client)?.clientId ?? null
    if (!shouldPruneBrowserClient(activeBrowserClientId, candidateClientId)) {
      continue
    }
    blockedBrowserClientIds.add(candidateClientId)
    prunedClientIds.add(candidateClientId)
    client.close(4001, 'inactive browser pruned')
  }

  return {
    activeClientId: activeBrowserClientId,
    prunedClientIds: [...prunedClientIds],
  }
}

function counts() {
  let browsers = 0
  let phones = rawFramePhones.size
  let browserPose = 0
  let phonePose = 0
  let webrtcBrowsers = 0
  let webrtcPhones = 0

  for (const role of clients.values()) {
    if (role === 'browser') browsers += 1
    if (role === 'phone') phones += 1
    if (role === 'browser-pose') browserPose += 1
    if (role === 'phone-pose') phonePose += 1
    if (role === 'browser-webrtc') webrtcBrowsers += 1
    if (role === 'phone-webrtc') webrtcPhones += 1
  }

  return {
    browsers,
    phones,
    browserPose,
    phonePose,
    webrtcBrowsers,
    webrtcPhones,
  }
}

function broadcastStatus() {
  const message = JSON.stringify({ type: 'bridge-status', ...counts() })

  for (const [client, role] of clients) {
    if (
      (role === 'browser' || role === 'browser-pose') &&
      client.readyState === WebSocket.OPEN
    ) {
      client.send(message)
    }
  }
}

function encodeFrameEnvelope(metadata, payload) {
  const metadataBytes = Buffer.from(JSON.stringify(metadata), 'utf8')
  if (metadataBytes.byteLength > 0xffff_ffff) {
    throw new RangeError('frame metadata is too large')
  }

  const payloadBytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
  const envelope = Buffer.allocUnsafe(
    frameEnvelopeHeaderBytes + metadataBytes.byteLength + payloadBytes.byteLength,
  )
  frameEnvelopeMagic.copy(envelope, 0)
  envelope.writeUInt32BE(metadataBytes.byteLength, frameEnvelopeMagic.byteLength)
  metadataBytes.copy(envelope, frameEnvelopeHeaderBytes)
  payloadBytes.copy(envelope, frameEnvelopeHeaderBytes + metadataBytes.byteLength)
  return envelope
}

function decodeFrameEnvelope(data) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data)
  if (
    bytes.byteLength <= frameEnvelopeHeaderBytes ||
    !bytes.subarray(0, frameEnvelopeMagic.byteLength).equals(frameEnvelopeMagic)
  ) {
    return null
  }
  const metadataLength = bytes.readUInt32BE(frameEnvelopeMagic.byteLength)
  const payloadOffset = frameEnvelopeHeaderBytes + metadataLength
  if (
    metadataLength === 0 ||
    metadataLength > 64 * 1024 ||
    payloadOffset >= bytes.byteLength
  ) {
    return null
  }
  try {
    const metadata = JSON.parse(
      bytes.subarray(frameEnvelopeHeaderBytes, payloadOffset).toString('utf8'),
    )
    if (!metadata || metadata.type !== 'frame-meta') return null
    return { metadata, payload: bytes.subarray(payloadOffset) }
  } catch {
    return null
  }
}

function requestRecoveryKeyframe() {
  broadcastToFramePhones(
    JSON.stringify({ type: 'request-keyframe', reason: 'browser-backpressure' }),
  )
}

function setActiveBrowserSocket(socket, reason) {
  if (activeBrowserFrameSocket === socket) return

  const previousClientId = activeBrowserClientId
  const nextDetails = socket ? clientDetails.get(socket) : null
  const nextLeaseGeneration = browserLeaseGeneration + 1
  const nextLeaseActivatedAtMs = Date.now()
  invalidateActiveBenchmark(reason, {
    previousBrowserClientId: previousClientId,
    nextBrowserClientId: nextDetails?.clientId ?? null,
    nextLeaseGeneration,
  })
  activeBrowserFrameSocket = socket
  activeBrowserClientId = nextDetails?.clientId ?? null
  browserLeaseGeneration = nextLeaseGeneration
  browserLeaseActivatedAtMs = nextLeaseActivatedAtMs

  if (!socket || !nextDetails) return
  beginBrowserFrameLease(
    nextDetails,
    nextLeaseGeneration,
    nextLeaseActivatedAtMs,
  )
  for (const [poseSocket, role] of clients) {
    const poseDetails = clientDetails.get(poseSocket)
    if (
      role === 'browser-pose' &&
      poseDetails?.clientId === activeBrowserClientId
    ) {
      beginBrowserReceiverLease(
        poseDetails,
        nextLeaseGeneration,
        nextLeaseActivatedAtMs,
      )
    }
  }
  // The newly active tab missed every dependent frame sent to the previous
  // tab. Hold deltas until the requested recovery IDR arrives.
  nextDetails.awaitingH264Keyframe = true
  nextDetails.lastRecoveryKeyframeRequestAtMs = 0
  requestRecoveryKeyframe()
}

function activateBrowserSocket(socket) {
  if (
    !socket ||
    clients.get(socket) !== 'browser' ||
    socket.readyState !== WebSocket.OPEN ||
    activeBrowserFrameSocket === socket
  ) {
    return false
  }
  setActiveBrowserSocket(socket, 'browser-lease-changed')
  return true
}

function selectBrowserFrameSocket(clientId) {
  if (!clientId) return null
  const candidates = [...clients]
    .filter(([client, role]) => {
      const details = clientDetails.get(client)
      return (
        role === 'browser' &&
        client.readyState === WebSocket.OPEN &&
        details?.clientId === clientId
      )
    })
    .sort((left, right) => {
      const leftConnectedAt = clientDetails.get(left[0])?.connectedAtMs ?? 0
      const rightConnectedAt = clientDetails.get(right[0])?.connectedAtMs ?? 0
      return rightConnectedAt - leftConnectedAt
    })
  return candidates[0]?.[0] ?? null
}

function activateBrowserClient(clientId) {
  return activateBrowserSocket(selectBrowserFrameSocket(clientId))
}

function selectMostRecentBrowserPoseSocket(clientId) {
  return (
    [...clients]
      .filter(([client, role]) => {
        const details = clientDetails.get(client)
        return (
          role === 'browser-pose' &&
          client.readyState === WebSocket.OPEN &&
          details?.clientId === clientId
        )
      })
      .sort(
        (left, right) =>
          (clientDetails.get(right[0])?.lastReceiverStatusAtMs ?? 0) -
            (clientDetails.get(left[0])?.lastReceiverStatusAtMs ?? 0),
      )[0]?.[0] ?? null
  )
}

function alignBrowserReceiverWithActiveLease(details) {
  if (
    !details ||
    details.clientId !== activeBrowserClientId ||
    !activeBrowserFrameSocket
  ) {
    return
  }
  const frameDetails = clientDetails.get(activeBrowserFrameSocket)
  if (
    frameDetails?.browserLeaseGeneration !== browserLeaseGeneration ||
    frameDetails.browserLeaseActivatedAtMs !== browserLeaseActivatedAtMs
  ) {
    return
  }
  if (
    details.browserLeaseGeneration !== browserLeaseGeneration ||
    details.browserLeaseActivatedAtMs !== browserLeaseActivatedAtMs
  ) {
    beginBrowserReceiverLease(
      details,
      browserLeaseGeneration,
      browserLeaseActivatedAtMs,
    )
  }
}

function markBrowserLeaseFailure(clientId, nowMs) {
  if (!clientId) return
  const previousCount = browserLeaseFailures.get(clientId)?.count ?? 0
  const count = previousCount + 1
  const backoffMs = Math.min(
    maximumBrowserLeaseFailureBackoffMs,
    browserLeaseFailureBackoffMs * 2 ** (count - 1),
  )
  browserLeaseFailures.set(clientId, {
    count,
    blockedUntilMs: nowMs + backoffMs,
  })
}

function browserLeaseHandoffCandidates() {
  const newestByClientId = new Map()
  for (const [poseSocket, role] of clients) {
    if (role !== 'browser-pose' || poseSocket.readyState !== WebSocket.OPEN) {
      continue
    }
    const poseDetails = clientDetails.get(poseSocket)
    const clientId = poseDetails?.clientId
    if (!clientId) continue
    const previous = newestByClientId.get(clientId)
    if (
      previous &&
      (previous.lastReceiverStatusAtMs ?? 0) >=
        (poseDetails.lastReceiverStatusAtMs ?? 0)
    ) {
      continue
    }
    const frameSocket = selectBrowserFrameSocket(clientId)
    const frameDetails = frameSocket ? clientDetails.get(frameSocket) : null
    newestByClientId.set(clientId, {
      clientId,
      frameSocket,
      frameConnected: frameSocket !== null,
      frameConnectedAtMs: frameDetails?.connectedAtMs ?? null,
      visibilityState: poseDetails.receiverVisibilityState,
      hasFocus: poseDetails.receiverHasFocus,
      lastReceiverStatusAtMs: poseDetails.lastReceiverStatusAtMs,
      blockedUntilMs:
        browserLeaseFailures.get(clientId)?.blockedUntilMs ?? null,
    })
  }
  return [...newestByClientId.values()]
}

export function browserLeaseHealthHandoffPaused(
  benchmark,
  activeFrameSocket,
  activeClientId,
) {
  return (
    benchmark?.phase === 'browser-preparing' &&
    benchmark.browserFrameSocket === activeFrameSocket &&
    benchmark.browserClientId === activeClientId
  )
}

function maybeHandoffUnhealthyActiveBrowser(nowMs) {
  if (
    !activeBrowserFrameSocket ||
    !activeBrowserClientId ||
    browserLeaseHealthHandoffPaused(
      activeBenchmark,
      activeBrowserFrameSocket,
      activeBrowserClientId,
    ) ||
    nowMs - lastAutomaticBrowserLeaseHandoffAtMs <
      browserLeaseHandoffCooldownMs
  ) {
    return false
  }
  const frameDetails = clientDetails.get(activeBrowserFrameSocket)
  const receiverSocket = selectMostRecentBrowserPoseSocket(
    activeBrowserClientId,
  )
  const receiverDetails = receiverSocket
    ? clientDetails.get(receiverSocket)
    : null
  const failureReason = activeBrowserLeaseFailureReason(
    frameDetails,
    receiverDetails,
    activeBrowserClientId,
    nowMs,
    browserLeaseActivatedAtMs,
  )
  if (!failureReason) {
    if (
      receiverDetails?.clientId === activeBrowserClientId &&
      isRecentBrowserTimestamp(receiverDetails.lastFrameRenderedAtMs, nowMs)
    ) {
      browserLeaseFailures.delete(activeBrowserClientId)
    }
    return false
  }

  const candidate = selectBrowserLeaseHandoffCandidate(
    browserLeaseHandoffCandidates(),
    activeBrowserClientId,
    nowMs,
  )
  if (!candidate?.frameSocket) return false

  const previousClientId = activeBrowserClientId
  markBrowserLeaseFailure(previousClientId, nowMs)
  lastAutomaticBrowserLeaseHandoffAtMs = nowMs
  const activated = activateBrowserSocket(candidate.frameSocket)
  if (!activated) return false
  retainDiagnostic(diagnostics.browserLeaseEvents, {
    type: 'browser-lease-health-handoff',
    reason: failureReason,
    previousClientId,
    nextClientId: candidate.clientId,
    leaseGeneration: browserLeaseGeneration,
    previousBlockedUntilMs:
      browserLeaseFailures.get(previousClientId)?.blockedUntilMs ?? null,
  })
  return true
}

function ensureActiveBrowserClient(nowMs = Date.now()) {
  const activeStillConnected =
    activeBrowserFrameSocket !== null &&
    clients.get(activeBrowserFrameSocket) === 'browser' &&
    activeBrowserFrameSocket.readyState === WebSocket.OPEN
  if (activeStillConnected) return

  const replacement = selectBrowserLeaseHandoffCandidate(
    browserLeaseHandoffCandidates(),
    null,
    nowMs,
  )
  setActiveBrowserSocket(
    replacement?.frameSocket ?? null,
    'active-browser-frame-disconnected',
  )
}

function checkBrowserLeaseHealth(nowMs) {
  ensureActiveBrowserClient(nowMs)
  return maybeHandoffUnhealthyActiveBrowser(nowMs)
}

function waitForH264Keyframe(details) {
  details.awaitingH264Keyframe = true
  const now = Date.now()
  if (now - details.lastRecoveryKeyframeRequestAtMs < 250) return false
  details.lastRecoveryKeyframeRequestAtMs = now
  return true
}

export function shouldDropBrowserFrameForBackpressure(
  bufferedBytes,
  frameBytes,
  maximumBufferedBytes = maxBrowserVideoBufferedBytes,
) {
  // A single frame, especially a recovery keyframe, can exceed the normal queue
  // budget. Admit it only when no older bytes remain; every subsequent frame
  // must keep the projected queue within the budget.
  return (
    bufferedBytes > 0 &&
    bufferedBytes + frameBytes > maximumBufferedBytes
  )
}

function broadcastFrameToBrowsers(metadata, envelope) {
  let shouldRequestKeyframe = false
  const isH264 = metadata.codec === 'h264'
  const isKeyframe = isH264 && metadata.isKeyframe === true

  for (const [client, role] of clients) {
    if (role !== 'browser' || client.readyState !== WebSocket.OPEN) continue
    const details = clientDetails.get(client)
    if (!details) continue
    if (!browserSocketOwnsFrameLease(client, activeBrowserFrameSocket)) continue

    if (isH264 && details.awaitingH264Keyframe && !isKeyframe) {
      shouldRequestKeyframe =
        waitForH264Keyframe(details) || shouldRequestKeyframe
      continue
    }

    if (
      shouldDropBrowserFrameForBackpressure(
        client.bufferedAmount,
        envelope.byteLength,
      )
    ) {
      if (isH264) {
        // If the keyframe itself could not be forwarded, the outstanding
        // request has been consumed. Ask for another recovery point.
        if (isKeyframe) details.lastRecoveryKeyframeRequestAtMs = 0
        shouldRequestKeyframe =
          waitForH264Keyframe(details) || shouldRequestKeyframe
      }
      // JPEG frames are independent, so dropping just this frame is safe.
      continue
    }

    try {
      client.send(envelope, { binary: true }, (error) => {
        if (error && client.readyState !== WebSocket.CLOSED) client.terminate()
      })
      details.lastFrameRelayedAtMs = Date.now()
      details.lastFrameRelayedId = Number.isSafeInteger(metadata.frameId)
        ? metadata.frameId
        : null
      if (isKeyframe) {
        details.awaitingH264Keyframe = false
        details.lastRecoveryKeyframeRequestAtMs = 0
      }
    } catch {
      client.terminate()
    }
  }

  if (shouldRequestKeyframe) requestRecoveryKeyframe()
}

function relayPhoneFrame(
  data,
  fallbackMetadata,
  acknowledge,
  sourceSocket,
  sourceRole,
  sourceDetails,
  readTiming = null,
) {
  const relayStartedAt = performance.now()
  const bridgeReceivedAtMs = Date.now()
  const atomicFrame = decodeFrameEnvelope(data)
  const metadata = atomicFrame?.metadata ?? fallbackMetadata
  const payload = atomicFrame?.payload ?? data

  // Metadata and pixels are one atomic browser message. A missing metadata
  // record makes the payload undecodable, so never forward it on its own.
  if (!metadata) return false
  observeProducerIdentity(sourceDetails, metadata)
  updateCaptureFreshness(sourceDetails, metadata)
  updateCaptureConfiguration(sourceDetails, metadata)
  if (sourceDetails) {
    sourceDetails.lastFrameAtMs = bridgeReceivedAtMs
    sourceDetails.lastFrameCodec =
      typeof metadata.codec === 'string' ? metadata.codec : null
    sourceDetails.lastFrameId = Number.isSafeInteger(metadata.frameId)
      ? metadata.frameId
      : null
    sourceDetails.lastFrameMetadataAtMs = bridgeReceivedAtMs
  }

  const relayedMetadata = {
    ...metadata,
    // In the atomic phone envelope, metadata and payload reach the bridge
    // together. Preserve the browser measurement schema by recording the
    // same receive instant that the legacy split-message path used.
    metadataReceivedAtMs:
      metadata.metadataReceivedAtMs ?? bridgeReceivedAtMs,
    bridgeReceivedAtMs,
    bridgeRelayedAtMs: Date.now(),
    payloadBytes: payload.byteLength,
  }
  if (Number.isSafeInteger(metadata.frameId)) {
    const ackTimings = {
      bridgeReceivedAtMs,
      bridgeAckIssuedAtMs: Date.now(),
      ...(readTiming ? rawACKTiming(readTiming, relayStartedAt, performance.now()) : {}),
    }
    const acknowledgment = JSON.stringify({
      type: 'frame-ack',
      frameId: metadata.frameId,
      ...ackTimings,
    })
    acknowledge(acknowledgment)
    if (readTiming) transportTrace.bridgeACK(metadata, ackTimings, Date.now())
    // Keep transport feedback on the independent pose socket as a fallback
    // if either frame transport's reverse path is delayed.
    broadcastToPosePhones(acknowledgment, producerIdentityFrom(metadata))
  }

  const run = activeBenchmark
  if (run?.valid) {
    const observedIdentity = producerIdentityFrom(metadata)
    if (run.phase === 'browser-preparing' || run.phase === 'requested') {
      // Encoder warmup can intentionally replace the frame transport. Until
      // the phone reports `started`, accept any fresh frame socket carrying
      // the already pinned producer identity, and ignore unrelated producers.
      if (
        !observedIdentity ||
        sourceDetails?.producerIdentityValid !== true ||
        !sameProducerIdentity(run, observedIdentity)
      ) {
        return false
      }
      const freshnessError = captureFreshnessError(metadata)
      if (freshnessError) {
        invalidateActiveBenchmark(freshnessError)
        return false
      }
    } else {
      if (
        sourceSocket !== run.phoneFrameSocket ||
        sourceRole !== run.phoneFrameRole
      ) {
        // Continue acknowledging other connected producers so their transport
        // does not stall, but never mix their pixels into a measured run.
        return false
      }
      if (!observedIdentity) {
        invalidateActiveBenchmark('frame-producer-identity-missing')
        return false
      }
      if (
        sourceDetails?.producerIdentityValid !== true ||
        !sameProducerIdentity(run, observedIdentity)
      ) {
        invalidateActiveBenchmark('frame-producer-identity-mismatch')
        return false
      }
      const freshnessError = captureFreshnessError(metadata)
      if (freshnessError) {
        invalidateActiveBenchmark(freshnessError)
        return false
      }
      const captureConfigurationError = measuredCaptureConfigurationError(
        run,
        metadata,
      )
      if (captureConfigurationError) {
        invalidateActiveBenchmark(captureConfigurationError)
        return false
      }
    }
  }

  const envelope = encodeFrameEnvelope(relayedMetadata, payload)
  broadcastFrameToBrowsers(relayedMetadata, envelope)
  return true
}

function broadcastToFramePhones(data) {
  for (const [client, role] of clients) {
    if (role === 'phone' && client.readyState === WebSocket.OPEN) {
      client.send(data)
    }
  }
  for (const client of rawFramePhones.keys()) {
    sendRawFrameControl(client, data)
  }
}

function sendRawFrameControl(socket, data) {
  if (socket.destroyed || !socket.writable) return
  const payload = Buffer.from(data, 'utf8')
  const record = Buffer.allocUnsafe(4 + payload.byteLength)
  record.writeUInt32BE(payload.byteLength, 0)
  payload.copy(record, 4)
  socket.write(record)
}

function selectBrowserPoseSocket({
  clientId = activeBrowserClientId,
  requireReady = false,
  nowMs = Date.now(),
} = {}) {
  const candidates = [...clients]
    .filter(([client, role]) => {
      if (role !== 'browser-pose' || client.readyState !== WebSocket.OPEN) {
        return false
      }
      const details = clientDetails.get(client)
      if (clientId !== null && details?.clientId !== clientId) return false
      if (!requireReady) return true
      return (
        isRecentBrowserTimestamp(details?.lastReceiverStatusAtMs, nowMs) &&
        details.receiverVisibilityState === 'visible' &&
        details.receiverScreenStale === false &&
        isRecentBrowserTimestamp(details.lastFrameReceivedAtMs, nowMs) &&
        isRecentBrowserTimestamp(details.lastFrameRenderedAtMs, nowMs)
      )
    })
    .sort((left, right) => {
      const leftDetails = clientDetails.get(left[0])
      const rightDetails = clientDetails.get(right[0])
      const leftFocused =
        leftDetails?.receiverVisibilityState === 'visible' &&
        leftDetails.receiverHasFocus === true
          ? 1
          : 0
      const rightFocused =
        rightDetails?.receiverVisibilityState === 'visible' &&
        rightDetails.receiverHasFocus === true
          ? 1
          : 0
      return (
        rightFocused - leftFocused ||
        (rightDetails?.lastReceiverStatusAtMs ?? 0) -
          (leftDetails?.lastReceiverStatusAtMs ?? 0) ||
        (rightDetails?.connectedAtMs ?? 0) -
          (leftDetails?.connectedAtMs ?? 0)
      )
    })
  return candidates[0]?.[0] ?? null
}

function broadcastToPoseBrowsers(data) {
  const client = selectBrowserPoseSocket()
  if (
    client &&
    client.readyState === WebSocket.OPEN &&
    client.bufferedAmount < 256 * 1024
  ) {
    client.send(data)
  }
}

function broadcastToPosePhones(data, producerIdentity = null) {
  for (const [client, role] of clients) {
    const details = clientDetails.get(client)
    if (
      role === 'phone-pose' &&
      client.readyState === WebSocket.OPEN &&
      (!producerIdentity || sameProducerIdentity(details, producerIdentity))
    ) {
      client.send(data)
    }
  }
}

function broadcastH264OutputFormatToPosePhones(format) {
  for (const [client, role] of clients) {
    if (role !== 'phone-pose' || client.readyState !== WebSocket.OPEN) continue
    const details = clientDetails.get(client)
    if (!h264OutputFormatShouldForward(details?.lastH264OutputFormat, format)) {
      continue
    }
    if (details) details.lastH264OutputFormat = format
    client.send(JSON.stringify({ type: 'h264-output-format', format }))
  }
}

function selectFreshPhoneSourcePair(
  nowMs,
  requiredPhonePoseSocket = null,
  requiredPhoneFrameSocket = null,
  requiredCaptureConfiguration = null,
  requiredCaptureSource = null,
) {
  const phonePoseCandidates = [...clients]
    .filter(([client, role]) => {
      if (role !== 'phone-pose' || client.readyState !== WebSocket.OPEN) {
        return false
      }
      if (
        requiredPhonePoseSocket !== null &&
        client !== requiredPhonePoseSocket
      ) {
        return false
      }
      const details = clientDetails.get(client)
      if (
        requiredCaptureSource !== null &&
        details?.captureSource !== requiredCaptureSource
      ) {
        return false
      }
      return (
        details?.lastCaptureHeartbeatAtMs != null &&
        nowMs - details.lastCaptureHeartbeatAtMs < 2_500 &&
        details.lastCaptureState === 'streaming' &&
        details.lastEncoderStatus === 0 &&
        details.lastCodec === 'H.264' &&
        details.lastFreshContent === true &&
        freshCaptureContentStatuses.has(details.lastCaptureContentStatus) &&
        captureConfigurationMatches(
          details,
          requiredCaptureConfiguration,
        )
      )
    })
    .map(([socket]) => {
      const details = clientDetails.get(socket)
      return {
        socket,
        role: 'phone-pose',
        ...producerIdentityFrom(details),
        producerIdentityValid: details?.producerIdentityValid,
        freshnessAtMs: details?.lastCaptureHeartbeatAtMs ?? 0,
      }
    })

  const frameSources = [
    ...[...clients]
      .filter(([client, role]) => {
        if (role !== 'phone' || client.readyState !== WebSocket.OPEN) {
          return false
        }
        if (
          requiredPhoneFrameSocket !== null &&
          client !== requiredPhoneFrameSocket
        ) {
          return false
        }
        const details = clientDetails.get(client)
        if (
          requiredCaptureSource !== null &&
          details?.captureSource !== requiredCaptureSource
        ) {
          return false
        }
        return (
          details?.lastFrameAtMs != null &&
          nowMs - details.lastFrameAtMs < 2_500 &&
          details.lastFrameCodec === 'h264' &&
          details.lastFreshContent === true &&
          freshCaptureContentStatuses.has(details.lastCaptureContentStatus) &&
          captureConfigurationMatches(
            details,
            requiredCaptureConfiguration,
          )
        )
      })
      .map(([socket]) => ({
        socket,
        role: 'websocket-frame',
        ...producerIdentityFrom(clientDetails.get(socket)),
        producerIdentityValid:
          clientDetails.get(socket)?.producerIdentityValid,
        freshnessAtMs: clientDetails.get(socket)?.lastFrameAtMs ?? 0,
      })),
    ...[...rawFramePhones]
      .filter(
        ([socket, details]) =>
          !socket.destroyed &&
          (requiredPhoneFrameSocket === null ||
            socket === requiredPhoneFrameSocket) &&
          (requiredCaptureSource === null ||
            details.captureSource === requiredCaptureSource) &&
          details.lastFrameAtMs != null &&
          nowMs - details.lastFrameAtMs < 2_500 &&
          details.lastFrameCodec === 'h264' &&
          details.lastFreshContent === true &&
          freshCaptureContentStatuses.has(details.lastCaptureContentStatus) &&
          captureConfigurationMatches(
            details,
            requiredCaptureConfiguration,
          ),
      )
      .map(([socket, details]) => ({
        socket,
        role: 'raw-frame',
        ...producerIdentityFrom(details),
        producerIdentityValid: details.producerIdentityValid,
        freshnessAtMs: details.lastFrameAtMs ?? 0,
      })),
  ]

  const selection = selectUniqueProducerPair(
    phonePoseCandidates,
    frameSources,
  )
  if (!selection.pair) return selection

  return {
    pair: {
      phonePoseSocket: selection.pair.pose.socket,
      phoneFrameSocket: selection.pair.frame.socket,
      phoneFrameRole: selection.pair.frame.role,
      producerSessionId: selection.pair.pose.producerSessionId,
      captureSource: selection.pair.pose.captureSource,
    },
    reason: null,
    distinctProducerSessions: selection.distinctProducerSessions,
  }
}

export function resolutionBenchmarkCaptureSourceError(selection) {
  if (!selection?.pair) return null
  return selection.pair.captureSource === 'screencapturekit-host'
    ? null
    : 'screencapturekit-host-required'
}

function clearBenchmarkCommandRetries(runId) {
  const timers = benchmarkCommandTimers.get(runId)
  if (!timers) return
  for (const timer of timers) clearTimeout(timer)
  benchmarkCommandTimers.delete(runId)
}

function activeBenchmarkSummary() {
  if (!activeBenchmark) return null
  return {
    runId: activeBenchmark.runId,
    phase: activeBenchmark.phase,
    valid: activeBenchmark.valid,
    invalidReason: activeBenchmark.invalidReason,
    requestedAtMs: activeBenchmark.requestedAtMs,
    durationMs: activeBenchmark.durationMs,
    targetFps: activeBenchmark.targetFps,
    encoderProfile: activeBenchmark.requestedEncoderProfile,
    requestedEncoderProfile: activeBenchmark.requestedEncoderProfile,
    activeEncoderProfile: activeBenchmark.activeEncoderProfile,
    encoderTuning: activeBenchmark.requestedEncoderTuning,
    requestedEncoderTuning: activeBenchmark.requestedEncoderTuning,
    activeEncoderTuning: activeBenchmark.activeEncoderTuning,
    benchmarkProtocolVersion: 2,
    browserConfigId: activeBenchmark.browserConfigId,
    requestedBrowserConfigGeneration:
      activeBenchmark.requestedBrowserConfigGeneration,
    browserConfigGeneration: activeBenchmark.browserConfigGeneration,
    requestedDecoderMode: activeBenchmark.requestedDecoderMode,
    appliedDecoderMode: activeBenchmark.appliedDecoderMode,
    decoderAccelerationConfigured:
      activeBenchmark.decoderAccelerationConfigured,
    browserPrepareStartedAtMs: activeBenchmark.browserPrepareStartedAtMs,
    browserPreparedAtMs: activeBenchmark.browserPreparedAtMs,
    browserPrepareClientDurationMs:
      activeBenchmark.browserPrepareClientDurationMs,
    requestedCaptureShortEdge: activeBenchmark.requestedCaptureShortEdge,
    captureShortEdgeActive: activeBenchmark.captureShortEdgeActive,
    captureWidthActive: activeBenchmark.captureWidthActive,
    captureHeightActive: activeBenchmark.captureHeightActive,
    captureStreamGeneration: activeBenchmark.captureStreamGeneration,
    thermalStateStart: activeBenchmark.thermalStateStart,
    thermalStateEnd: activeBenchmark.thermalStateEnd,
    thermalStateWorstObserved: activeBenchmark.thermalStateWorstObserved,
    thermalContaminated: activeBenchmark.thermalContaminated,
    producerSessionId: activeBenchmark.producerSessionId,
    captureSource: activeBenchmark.captureSource,
    phoneFrameTransport: activeBenchmark.phoneFrameTransport,
    phoneControlTransport: activeBenchmark.phoneControlTransport,
    warmupMs: activeBenchmark.warmupMs,
    browserClientId: activeBenchmark.browserClientId,
    browserLeaseGeneration: activeBenchmark.browserLeaseGeneration,
    phoneStartedAtMs: activeBenchmark.phoneStartedAtMs,
    phoneCompletedAtMs: activeBenchmark.phoneCompletedAtMs,
    expiresAtMs: activeBenchmark.expiresAtMs,
  }
}

export function benchmarkStatusPayload(latestBenchmark, active) {
  const latestAccepted =
    typeof latestBenchmark?.runId === 'string'
      ? {
          runId: latestBenchmark.runId,
          receivedAtMs: latestBenchmark.receivedAtMs,
        }
      : null
  return { ok: true, latestAccepted, active }
}

function sendToPinnedBenchmarkBrowser(run, message) {
  const socket = run.browserPoseSocket
  if (
    clients.get(socket) !== 'browser-pose' ||
    socket.readyState !== WebSocket.OPEN
  ) {
    return false
  }
  socket.send(JSON.stringify(message))
  return true
}

function handleBrowserBenchmarkPrepareAck(socket, message) {
  const run = activeBenchmark
  const details = clientDetails.get(socket)
  if (run && socket !== run.browserPoseSocket) {
    rejectBenchmarkMessage(
      message?.runId ?? null,
      'browser-prepare-rejected',
      'browser-prepare-not-from-pinned-socket',
      details?.clientId ?? null,
    )
    return
  }
  const error = browserPrepareAckValidationError(run, details, message)
  if (
    !error &&
    (activeBrowserFrameSocket !== run.browserFrameSocket ||
      activeBrowserClientId !== run.browserClientId ||
      browserLeaseGeneration !== run.browserLeaseGeneration)
  ) {
    rejectBenchmarkMessage(
      message.runId,
      'browser-prepare-rejected',
      'browser-prepare-lease-changed',
      details?.clientId ?? null,
    )
    invalidateActiveBenchmark('browser-prepare-lease-changed')
    releaseActiveBenchmark(run)
    return
  }
  if (error) {
    rejectBenchmarkMessage(
      message?.runId ?? null,
      'browser-prepare-rejected',
      error,
      details?.clientId ?? null,
    )
    if (browserPrepareAckShouldAbortRun(run, message, error)) {
      invalidateActiveBenchmark(error)
      releaseActiveBenchmark(run)
    }
    return
  }

  run.browserConfigGeneration = message.browserConfigGeneration
  run.appliedDecoderMode = message.decoderModeApplied
  run.decoderAccelerationConfigured =
    message.decoderAccelerationConfigured
  run.browserPreparedAtMs = Date.now()
  run.browserPrepareClientDurationMs = message.prepareDurationMs
  run.phase = 'requested'
  retainDiagnostic(diagnostics.benchmarkEvents, {
    type: 'benchmark-state',
    runId: run.runId,
    phase: 'browser-prepared',
    browserConfigId: run.browserConfigId,
    browserConfigGeneration: run.browserConfigGeneration,
    decoderMode: run.appliedDecoderMode,
    decoderAccelerationConfigured: run.decoderAccelerationConfigured,
    renderedFrameId: message.renderedFrameId,
    browserPrepareDurationMs:
      run.browserPreparedAtMs - run.browserPrepareStartedAtMs,
    browserPrepareClientDurationMs: run.browserPrepareClientDurationMs,
    requestedCaptureShortEdge: run.requestedCaptureShortEdge,
    captureShortEdgeActive: run.captureShortEdgeActive,
    captureWidthActive: run.captureWidthActive,
    captureHeightActive: run.captureHeightActive,
    captureStreamGeneration: run.captureStreamGeneration,
    thermalStateStart: run.thermalStateStart,
    thermalStateEnd: run.thermalStateEnd,
    thermalStateWorstObserved: run.thermalStateWorstObserved,
    thermalContaminated: run.thermalContaminated,
  })
  broadcastBenchmarkCommand(run.phoneCommand)
  armActiveBenchmarkTimeout(
    run,
    Date.now() + run.warmupMs + run.durationMs + 10_000,
    'run-timeout',
  )
}

function releaseActiveBenchmark(run) {
  if (!run || activeBenchmark !== run) return
  if (activeBenchmarkTimer) clearTimeout(activeBenchmarkTimer)
  activeBenchmarkTimer = null
  clearBenchmarkCommandRetries(run.runId)
  activeBenchmark = null
}

function armActiveBenchmarkTimeout(run, expiresAtMs, timeoutPhase) {
  if (activeBenchmark !== run) return
  if (activeBenchmarkTimer) clearTimeout(activeBenchmarkTimer)
  run.expiresAtMs = expiresAtMs
  activeBenchmarkTimer = setTimeout(() => {
    if (activeBenchmark !== run) return
    retainDiagnostic(diagnostics.benchmarkEvents, {
      type: 'benchmark-state',
      runId: run.runId,
      phase: timeoutPhase,
      valid: run.valid,
      invalidReason: run.invalidReason,
    })
    releaseActiveBenchmark(run)
  }, Math.max(1, expiresAtMs - Date.now()))
  activeBenchmarkTimer.unref()
}

function invalidateActiveBenchmark(reason, context = {}) {
  const run = activeBenchmark
  if (!run || !run.valid) return
  run.valid = false
  run.invalidReason = reason
  run.invalidatedAtMs = Date.now()
  clearBenchmarkCommandRetries(run.runId)
  retainDiagnostic(diagnostics.benchmarkEvents, {
    type: 'benchmark-state',
    runId: run.runId,
    phase: 'invalidated',
    reason,
    ...context,
  })

  // Stop the pinned browser's local measurement immediately. The phone may
  // still finish its already scheduled interval; its terminal status releases
  // the invalid run without ever accepting a report from a replacement tab.
  sendToPinnedBenchmarkBrowser(run, {
    type: 'benchmark-status',
    benchmarkProtocolVersion: 2,
    producerSessionId: run.producerSessionId,
    captureSource: run.captureSource,
    runId: run.runId,
    phase: 'cancelled',
    timestampMs: Date.now(),
    durationMs: run.durationMs,
    targetFps: run.targetFps,
    encoderProfile: run.requestedEncoderProfile,
    encoderProfileActive: run.activeEncoderProfile,
    encoderTuning: run.requestedEncoderTuning,
    encoderTuningActive: run.activeEncoderTuning,
  })
}

function invalidateBenchmarkForDisconnectedSocket(socket, role) {
  const run = activeBenchmark
  if (!run) return
  if (socket === run.browserFrameSocket) {
    invalidateActiveBenchmark('pinned-browser-frame-disconnected')
  } else if (socket === run.browserPoseSocket) {
    invalidateActiveBenchmark('pinned-browser-receiver-disconnected')
  } else if (socket === run.phonePoseSocket) {
    invalidateActiveBenchmark('pinned-phone-control-disconnected')
    releaseActiveBenchmark(run)
  } else if (socket === run.phoneFrameSocket) {
    invalidateActiveBenchmark(`pinned-phone-${role}-disconnected`)
  }
}

export function benchmarkStatusEnvelopeValidationError(run, message) {
  if (message.benchmarkProtocolVersion !== 2) {
    return 'benchmark-protocol-version-mismatch'
  }
  if (message.runId !== run.runId) return 'run-id-mismatch'
  const thermalStateError = optionalThermalStateValidationError(message)
  if (thermalStateError) return thermalStateError
  const observedIdentity = producerIdentityFrom(message)
  if (!observedIdentity) return 'status-producer-identity-missing'
  if (!sameProducerIdentity(run, observedIdentity)) {
    return 'status-producer-identity-mismatch'
  }
  return null
}

function benchmarkStatusValidationError(run, socket, message) {
  const envelopeError = benchmarkStatusEnvelopeValidationError(run, message)
  if (envelopeError) return envelopeError
  if (socket !== run.phonePoseSocket) return 'status-not-from-pinned-phone'
  if (clientDetails.get(socket)?.producerIdentityValid !== true) {
    return 'status-producer-connection-conflict'
  }
  if (message.durationMs !== run.durationMs) return 'duration-mismatch'
  if (message.targetFps !== run.targetFps) return 'target-fps-mismatch'
  if (message.encoderProfile !== run.requestedEncoderProfile) {
    return 'requested-encoder-profile-mismatch'
  }
  const requiresActiveConfiguration =
    message.phase === 'started' || message.phase === 'completed'
  if (requiresActiveConfiguration) {
    const captureConfigurationError =
      benchmarkCaptureStatusValidationError(run, message)
    if (captureConfigurationError) return captureConfigurationError
  }
  if (requiresActiveConfiguration && message.encoderProfileActive == null) {
    return 'missing-active-encoder-profile'
  }
  const activeEncoderProfile = message.encoderProfileActive
  if (
    activeEncoderProfile !== 'legacy' &&
    activeEncoderProfile !== 'low-latency' &&
    !(message.phase === 'cancelled' && activeEncoderProfile == null)
  ) {
    return 'invalid-active-encoder-profile'
  }
  if (
    run.activeEncoderProfile !== null &&
    activeEncoderProfile != null &&
    activeEncoderProfile !== run.activeEncoderProfile
  ) {
    return 'active-encoder-profile-changed'
  }
  if (
    message.encoderTuning !== undefined &&
    message.encoderTuning !== null &&
    !isEncoderTuning(message.encoderTuning)
  ) {
    return 'invalid-requested-encoder-tuning'
  }
  const requestedEncoderTuning = normalizeEncoderTuning(message.encoderTuning)
  if (requestedEncoderTuning !== run.requestedEncoderTuning) {
    return 'requested-encoder-tuning-mismatch'
  }
  if (requiresActiveConfiguration && message.encoderTuningActive == null) {
    return 'missing-active-encoder-tuning'
  }
  const rawActiveEncoderTuning = message.encoderTuningActive
  if (
    message.phase === 'cancelled' &&
    (rawActiveEncoderTuning === null || rawActiveEncoderTuning === undefined)
  ) {
    if (!Number.isFinite(message.timestampMs)) return 'invalid-timestamp'
    return null
  }
  if (!isEncoderTuning(rawActiveEncoderTuning)) {
    return 'invalid-active-encoder-tuning'
  }
  const activeEncoderTuning = rawActiveEncoderTuning
  if (
    requiresActiveConfiguration &&
    encoderTuningConfigurationError(
      activeEncoderProfile,
      activeEncoderTuning,
    )
  ) {
    return 'invalid-active-encoder-configuration'
  }
  if (
    run.activeEncoderTuning !== null &&
    activeEncoderTuning !== run.activeEncoderTuning
  ) {
    return 'active-encoder-tuning-changed'
  }
  if (!Number.isFinite(message.timestampMs)) return 'invalid-timestamp'
  return null
}

export function benchmarkReportValidationError(run, report) {
  if (!report || typeof report !== 'object') return 'missing-report'
  if (report.schemaVersion !== 3) return 'schema-version-mismatch'
  if (report.runId !== run.runId) return 'report-run-id-mismatch'
  if (!Number.isFinite(report.durationMs)) return 'invalid-report-duration'
  if (
    report.durationMs < run.durationMs * 0.8 ||
    report.durationMs > run.durationMs + 5_000
  ) {
    return 'report-duration-out-of-range'
  }

  const startedAtMs = Date.parse(report.startedAt)
  const endedAtMs = Date.parse(report.endedAt)
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) {
    return 'invalid-report-timestamps'
  }
  if (
    endedAtMs < startedAtMs ||
    Math.abs(endedAtMs - startedAtMs - report.durationMs) > 1_500
  ) {
    return 'inconsistent-report-timestamps'
  }
  if (
    Math.abs(startedAtMs - run.phoneStartedAtMs) > 2_500 ||
    Math.abs(endedAtMs - run.phoneCompletedAtMs) > 2_500
  ) {
    return 'report-timestamps-outside-pinned-run'
  }

  const screen = report.screen
  if (!screen || typeof screen !== 'object') return 'missing-screen-metrics'
  if (screen.codec !== 'h264') return 'unexpected-screen-codec'
  const frameCounts = [
    screen.receivedFrames,
    screen.decodedFrames,
    screen.renderedFrames,
  ]
  if (
    frameCounts.some(
      (value) => !Number.isSafeInteger(value) || value <= 0,
    ) ||
    screen.decodedFrames > screen.receivedFrames ||
    screen.renderedFrames > screen.decodedFrames
  ) {
    return 'invalid-frame-counts'
  }
  const maxReasonableFrames = Math.ceil(
    run.targetFps * ((report.durationMs + 2_000) / 1_000) * 2,
  )
  if (screen.receivedFrames > maxReasonableFrames) {
    return 'frame-count-out-of-range'
  }

  const configuration = report.configuration
  if (
    !configuration ||
    typeof configuration !== 'object' ||
    typeof configuration.fingerprint !== 'string' ||
    configuration.fingerprint.length === 0 ||
    !configuration.parameters ||
    typeof configuration.parameters !== 'object'
  ) {
    return 'missing-report-configuration'
  }
  if (configuration.parameters.sourceTargetFps !== run.targetFps) {
    return 'report-target-fps-mismatch'
  }
  if (
    configuration.parameters.producerSessionId !== run.producerSessionId ||
    configuration.parameters.captureSource !== run.captureSource
  ) {
    return 'report-producer-identity-mismatch'
  }
  if (
    !configuration.fingerprint.endsWith(
      `-source${run.captureSource}-session${run.producerSessionId}`,
    )
  ) {
    return 'report-fingerprint-provenance-mismatch'
  }
  if (
    run.activeEncoderProfile === null ||
    configuration.parameters.encoderProfile !== run.activeEncoderProfile
  ) {
    return 'report-encoder-profile-mismatch'
  }
  const rawReportRequestedEncoderTuning =
    configuration.parameters.encoderTuningRequested
  if (!isEncoderTuning(rawReportRequestedEncoderTuning)) {
    return 'invalid-report-requested-encoder-tuning'
  }
  const reportRequestedEncoderTuning = rawReportRequestedEncoderTuning
  if (reportRequestedEncoderTuning !== run.requestedEncoderTuning) {
    return 'report-requested-encoder-tuning-mismatch'
  }
  const rawReportActiveEncoderTuning = configuration.parameters.encoderTuning
  if (!isEncoderTuning(rawReportActiveEncoderTuning)) {
    return 'invalid-report-encoder-tuning'
  }
  const reportActiveEncoderTuning = rawReportActiveEncoderTuning
  if (
    run.activeEncoderTuning === null ||
    reportActiveEncoderTuning !== run.activeEncoderTuning
  ) {
    return 'report-encoder-tuning-mismatch'
  }
  if (configuration.parameters.browserConfigId !== run.browserConfigId) {
    return 'report-browser-config-id-mismatch'
  }
  if (
    configuration.parameters.browserConfigGeneration !==
    run.browserConfigGeneration
  ) {
    return 'report-browser-config-generation-mismatch'
  }
  if (
    configuration.parameters.decoderModeRequested !==
      run.requestedDecoderMode ||
    configuration.parameters.decoderModeApplied !== run.appliedDecoderMode
  ) {
    return 'report-decoder-mode-mismatch'
  }
  if (
    configuration.parameters.decoderAccelerationConfigured !==
    run.decoderAccelerationConfigured
  ) {
    return 'report-decoder-acceleration-mismatch'
  }
  if (
    configuration.parameters.browserPrepareDurationMs !==
    run.browserPrepareClientDurationMs
  ) {
    return 'report-browser-prepare-duration-mismatch'
  }
  if (
    configuration.parameters.captureShortEdgeRequested !==
      run.requestedCaptureShortEdge ||
    configuration.parameters.captureShortEdgeActive !==
      run.captureShortEdgeActive ||
    configuration.parameters.captureWidthActive !== run.captureWidthActive ||
    configuration.parameters.captureHeightActive !== run.captureHeightActive
  ) {
    return 'report-capture-dimensions-mismatch'
  }
  if (
    configuration.parameters.captureStreamGeneration !==
    run.captureStreamGeneration
  ) {
    return 'report-capture-stream-generation-mismatch'
  }
  const captureFingerprint =
    `-capture${run.requestedCaptureShortEdge}` +
    `-active${run.captureShortEdgeActive}` +
    `-${run.captureWidthActive}x${run.captureHeightActive}` +
    `-generation${run.captureStreamGeneration}-`
  if (!configuration.fingerprint.includes(captureFingerprint)) {
    return 'report-capture-fingerprint-mismatch'
  }
  if (
    configuration.parameters.thermalStateStart !== run.thermalStateStart ||
    configuration.parameters.thermalStateEnd !== run.thermalStateEnd ||
    configuration.parameters.thermalStateWorstObserved !==
      run.thermalStateWorstObserved ||
    configuration.parameters.thermalContaminated !== run.thermalContaminated
  ) {
    return 'report-thermal-state-mismatch'
  }
  return null
}

function rejectBenchmarkMessage(runId, phase, reason, clientId = null) {
  retainDiagnostic(diagnostics.benchmarkEvents, {
    type: 'benchmark-state',
    runId,
    phase,
    reason,
    clientId,
  })
}

function handleBrowserBenchmarkCancel(socket, message) {
  const run = activeBenchmark
  const details = clientDetails.get(socket)
  if (!run) {
    rejectBenchmarkMessage(
      message.runId,
      'cancel-rejected',
      'no-active-run',
      details?.clientId ?? null,
    )
    return
  }
  if (
    message.runId !== run.runId ||
    socket !== run.browserPoseSocket ||
    details?.clientId !== run.browserClientId
  ) {
    rejectBenchmarkMessage(
      message.runId,
      'cancel-rejected',
      'not-pinned-run-or-browser',
      details?.clientId ?? null,
    )
    return
  }

  run.valid = false
  run.invalidReason =
    typeof message.reason === 'string' && message.reason.length <= 128
      ? message.reason
      : 'browser-cancelled'
  retainDiagnostic(diagnostics.benchmarkEvents, {
    type: 'benchmark-state',
    runId: run.runId,
    phase: 'cancelled-by-browser',
    reason: run.invalidReason,
    clientId: run.browserClientId,
  })
  releaseActiveBenchmark(run)
}

function handleBrowserBenchmarkReport(socket, message) {
  const run = activeBenchmark
  const details = clientDetails.get(socket)
  const messageRunId =
    typeof message.runId === 'string' ? message.runId : null
  if (!run) {
    rejectBenchmarkMessage(
      messageRunId,
      'report-rejected',
      'no-active-run',
      details?.clientId ?? null,
    )
    return
  }

  let rejectionReason = null
  if (messageRunId !== run.runId) {
    rejectionReason = 'run-id-mismatch'
  } else if (!run.valid) {
    rejectionReason = `run-invalid:${run.invalidReason}`
  } else if (run.phase !== 'awaiting-report') {
    rejectionReason = 'phone-has-not-completed'
  } else if (
    socket !== run.browserPoseSocket ||
    details?.clientId !== run.browserClientId
  ) {
    rejectionReason = 'report-not-from-pinned-browser'
  } else if (
    activeBrowserFrameSocket !== run.browserFrameSocket ||
    activeBrowserClientId !== run.browserClientId ||
    browserLeaseGeneration !== run.browserLeaseGeneration
  ) {
    rejectionReason = 'browser-lease-changed'
  } else {
    const nowMs = Date.now()
    const frameDetails = clientDetails.get(run.browserFrameSocket)
    if (
      browserBenchmarkReadinessError(
        frameDetails,
        details,
        run.browserClientId,
        nowMs,
      ) !== null
    ) {
      rejectionReason = 'pinned-browser-not-ready'
    } else {
      rejectionReason = benchmarkReportValidationError(run, message.report)
    }
  }

  if (rejectionReason) {
    rejectBenchmarkMessage(
      messageRunId,
      'report-rejected',
      rejectionReason,
      details?.clientId ?? null,
    )
    if (
      rejectionReason === 'browser-lease-changed' ||
      rejectionReason === 'pinned-browser-not-ready'
    ) {
      invalidateActiveBenchmark(rejectionReason)
    }
    return
  }

  diagnostics.latestBrowserBenchmark = {
    runId: run.runId,
    receivedAtMs: Date.now(),
    browserClientId: run.browserClientId,
    browserLeaseGeneration: run.browserLeaseGeneration,
    requestedEncoderProfile: run.requestedEncoderProfile,
    activeEncoderProfile: run.activeEncoderProfile,
    requestedEncoderTuning: run.requestedEncoderTuning,
    activeEncoderTuning: run.activeEncoderTuning,
    browserConfigId: run.browserConfigId,
    browserConfigGeneration: run.browserConfigGeneration,
    requestedDecoderMode: run.requestedDecoderMode,
    appliedDecoderMode: run.appliedDecoderMode,
    decoderAccelerationConfigured: run.decoderAccelerationConfigured,
    browserPrepareDurationMs:
      run.browserPreparedAtMs - run.browserPrepareStartedAtMs,
    browserPrepareClientDurationMs: run.browserPrepareClientDurationMs,
    benchmarkProtocolVersion: 2,
    requestedCaptureShortEdge: run.requestedCaptureShortEdge,
    captureShortEdgeActive: run.captureShortEdgeActive,
    captureWidthActive: run.captureWidthActive,
    captureHeightActive: run.captureHeightActive,
    captureStreamGeneration: run.captureStreamGeneration,
    thermalStateStart: run.thermalStateStart,
    thermalStateEnd: run.thermalStateEnd,
    thermalStateWorstObserved: run.thermalStateWorstObserved,
    thermalContaminated: run.thermalContaminated,
    producerSessionId: run.producerSessionId,
    captureSource: run.captureSource,
    phoneFrameTransport: run.phoneFrameTransport,
    phoneControlTransport: run.phoneControlTransport,
    report: message.report,
  }
  retainDiagnostic(diagnostics.benchmarkEvents, {
    type: 'benchmark-state',
    runId: run.runId,
    phase: 'report-accepted',
    clientId: run.browserClientId,
    producerSessionId: run.producerSessionId,
    captureSource: run.captureSource,
  })
  releaseActiveBenchmark(run)
}

function handlePhoneBenchmarkStatus(socket, message) {
  const run = activeBenchmark
  if (!run) {
    rejectBenchmarkMessage(
      message.runId,
      'phone-status-rejected',
      'no-active-run',
    )
    return
  }
  if (socket !== run.phonePoseSocket) {
    rejectBenchmarkMessage(
      message.runId,
      'phone-status-rejected',
      'status-not-from-pinned-phone',
    )
    return
  }

  const validationError = benchmarkStatusValidationError(run, socket, message)
  if (validationError) {
    rejectBenchmarkMessage(
      message.runId,
      'phone-status-rejected',
      validationError,
    )
    if (message.runId === run.runId) {
      invalidateActiveBenchmark(`invalid-phone-status:${validationError}`)
    }
    return
  }
  if (
    message.phase !== 'started' &&
    message.phase !== 'completed' &&
    message.phase !== 'cancelled'
  ) {
    rejectBenchmarkMessage(
      message.runId,
      'phone-status-rejected',
      'unsupported-phone-phase',
    )
    return
  }

  clearBenchmarkCommandRetries(run.runId)
  if (!run.valid) {
    retainDiagnostic(diagnostics.benchmarkEvents, {
      ...message,
      phase: `invalid-run-${message.phase}`,
      invalidReason: run.invalidReason,
    })
    if (message.phase === 'completed' || message.phase === 'cancelled') {
      releaseActiveBenchmark(run)
    }
    return
  }

  const nowMs = Date.now()
  if (message.phase === 'started') {
    if (run.phase !== 'requested') {
      rejectBenchmarkMessage(
        message.runId,
        'phone-status-rejected',
        `unexpected-started-phase:${run.phase}`,
      )
      return
    }
    const phoneSourcePair = selectFreshPhoneSourcePair(
      nowMs,
      run.phonePoseSocket,
      null,
      {
        captureShortEdgeRequested: message.captureShortEdgeRequested,
        captureShortEdgeActive: message.captureShortEdgeActive,
        captureWidthActive: message.captureWidthActive,
        captureHeightActive: message.captureHeightActive,
        captureStreamGeneration: message.captureStreamGeneration,
      },
      'screencapturekit-host',
    )
    if (
      !phoneSourcePair.pair ||
      !sameProducerIdentity(run, phoneSourcePair.pair)
    ) {
      rejectBenchmarkMessage(
        message.runId,
        'phone-status-rejected',
        phoneSourcePair.reason ?? 'phone-source-identity-changed-at-start',
      )
      invalidateActiveBenchmark(
        phoneSourcePair.reason ?? 'phone-source-identity-changed-at-start',
      )
      return
    }
    run.phoneFrameSocket = phoneSourcePair.pair.phoneFrameSocket
    run.phoneFrameRole = phoneSourcePair.pair.phoneFrameRole
    const frameDetails =
      run.phoneFrameRole === 'raw-frame'
        ? rawFramePhones.get(run.phoneFrameSocket)
        : clientDetails.get(run.phoneFrameSocket)
    run.phoneFrameTransport = phoneTransportSnapshot(
      run.phoneFrameRole,
      run.phoneFrameSocket,
      frameDetails,
    )
    run.phoneControlTransport = phoneTransportSnapshot(
      'phone-pose',
      run.phonePoseSocket,
      clientDetails.get(run.phonePoseSocket),
    )
    run.activeEncoderProfile = message.encoderProfileActive
    run.activeEncoderTuning = message.encoderTuningActive
    run.captureShortEdgeActive = message.captureShortEdgeActive
    run.captureWidthActive = message.captureWidthActive
    run.captureHeightActive = message.captureHeightActive
    run.captureStreamGeneration = message.captureStreamGeneration
    observeBenchmarkThermalState(run, message.thermalState, 'started')
    run.phase = 'running'
    run.phoneStartedAtMs = nowMs
    retainDiagnostic(diagnostics.benchmarkEvents, message)
    sendToPinnedBenchmarkBrowser(run, message)
    armActiveBenchmarkTimeout(
      run,
      nowMs + run.durationMs + 10_000,
      'running-timeout',
    )
    return
  }

  if (message.phase === 'cancelled') {
    retainDiagnostic(diagnostics.benchmarkEvents, message)
    sendToPinnedBenchmarkBrowser(run, message)
    releaseActiveBenchmark(run)
    return
  }

  if (run.phase !== 'running' || run.phoneStartedAtMs == null) {
    rejectBenchmarkMessage(
      message.runId,
      'phone-status-rejected',
      `completed-before-start:${run.phase}`,
    )
    invalidateActiveBenchmark('phone-completed-before-valid-start')
    releaseActiveBenchmark(run)
    return
  }
  const observedDurationMs = nowMs - run.phoneStartedAtMs
  if (
    observedDurationMs < run.durationMs * 0.8 ||
    observedDurationMs > run.durationMs + 5_000
  ) {
    rejectBenchmarkMessage(
      message.runId,
      'phone-status-rejected',
      'phone-duration-out-of-range',
    )
    invalidateActiveBenchmark('phone-duration-out-of-range', {
      observedDurationMs,
    })
    releaseActiveBenchmark(run)
    return
  }

  run.phase = 'awaiting-report'
  run.phoneCompletedAtMs = nowMs
  observeBenchmarkThermalState(run, message.thermalState, 'completed')
  retainDiagnostic(diagnostics.benchmarkEvents, message)
  sendToPinnedBenchmarkBrowser(run, message)
  armActiveBenchmarkTimeout(run, nowMs + 5_000, 'browser-report-timeout')
}

function broadcastBenchmarkCommand(command) {
  const run = activeBenchmark
  if (!run || run.runId !== command.runId) return
  const payload = JSON.stringify(command)
  clearBenchmarkCommandRetries(command.runId)
  if (
    clients.get(run.phonePoseSocket) === 'phone-pose' &&
    run.phonePoseSocket.readyState === WebSocket.OPEN
  ) {
    run.phonePoseSocket.send(payload)
  }

  // A benchmark command is tiny but must survive a coincident Wi-Fi/socket
  // transition. The phone ignores duplicate run requests while one is
  // warming/running, so bounded retries make control reliable without ever
  // duplicating the measured interval.
  const timers = new Set()
  for (const delayMs of [250, 500, 1_000]) {
    const timer = setTimeout(() => {
      if (benchmarkCommandTimers.get(command.runId) !== timers) return
      timers.delete(timer)
      if (
        activeBenchmark === run &&
        run.valid &&
        clients.get(run.phonePoseSocket) === 'phone-pose' &&
        run.phonePoseSocket.readyState === WebSocket.OPEN
      ) {
        run.phonePoseSocket.send(payload)
      }
      if (timers.size === 0) benchmarkCommandTimers.delete(command.runId)
    }, delayMs)
    timer.unref()
    timers.add(timer)
  }
  benchmarkCommandTimers.set(command.runId, timers)
}

const signalingBacklog = {
  'browser-webrtc': [],
  'phone-webrtc': [],
}

function oppositeWebRTCRole(role) {
  return role === 'browser-webrtc' ? 'phone-webrtc' : 'browser-webrtc'
}

function relayWebRTC(role, data) {
  const targetRole = oppositeWebRTCRole(role)
  const text = data.toString()
  if (role === 'browser-webrtc') {
    try {
      const message = JSON.parse(text)
      if (message.type === 'webrtc-offer') {
        // An offer defines a new peer session. Keeping an answer or candidate
        // from the previous session makes a freshly reconnected browser apply
        // an answer while already stable.
        signalingBacklog['browser-webrtc'].length = 0
        signalingBacklog['phone-webrtc'].length = 0
      }
    } catch {
      // Invalid signaling JSON is relayed unchanged; each peer validates it.
    }
  }
  for (const [client, clientRole] of clients) {
    if (clientRole === targetRole && client.readyState === WebSocket.OPEN) {
      // `ws` sends Buffer values as binary by default. WebRTC signaling must
      // stay a text frame because URLSessionWebSocketTask dispatches binary
      // frames through a different case on iOS.
      client.send(text)
    }
  }

  // Retain the active session's signaling so a phone-side reconnect can
  // receive the offer and candidates without forcing a browser refresh.
  const backlog = signalingBacklog[role]
  backlog.push(text)
  if (backlog.length > 64) backlog.shift()
}

function flushWebRTCBacklog(role, socket) {
  const sourceRole = oppositeWebRTCRole(role)
  const backlog = signalingBacklog[sourceRole]
  for (const message of backlog) socket.send(message)
}

const server = http.createServer((request, response) => {
  const requestURL = new URL(
    request.url ?? '/',
    `http://${request.headers.host ?? 'localhost'}`,
  )

  if (requestURL.pathname === '/quality/snapshot') {
    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'POST' }); response.end(); return
    }
    if (!isLoopbackAddress(request.socket.remoteAddress) ||
        request.headers['x-phone3d-quality-probe'] !== '1') {
      response.writeHead(403); response.end(); return
    }
    const reply = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      response.end(JSON.stringify(body))
    }
    if (activeBenchmark || pendingQualitySnapshot) {
      reply(409, { ok: false, error: 'benchmark-or-quality-snapshot-active' }); return
    }
    const bitRateParameter = requestURL.searchParams.get('averageBitRateMbps')
    let averageBitRate
    if (bitRateParameter !== null) {
      const parsedMbps = Number.parseInt(bitRateParameter, 10)
      if (String(parsedMbps) !== bitRateParameter || parsedMbps < 1 || parsedMbps > 20) {
        reply(400, { ok: false, error: 'averageBitRateMbps-must-be-an-integer-from-1-to-20' }); return
      }
      averageBitRate = parsedMbps * 1_000_000
    }
    const sources = [...clients].filter(([socket, role]) => {
      const details = clientDetails.get(socket)
      return role === 'phone-pose' && socket.readyState === WebSocket.OPEN &&
        details?.qualitySnapshotSupported === true &&
        details.captureSource === 'screencapturekit-host' &&
        details.lastCaptureState === 'streaming' &&
        Date.now() - (details.lastCaptureHeartbeatAtMs ?? 0) < 2500
    })
    if (sources.length !== 1) {
      reply(503, { ok: false, error: 'need-one-streaming-phone-with-snapshot-capability' }); return
    }
    const socket = sources[0][0]
    const runId = randomUUID()
    const requestState = { runId, socket, reply, timer: null }
    requestState.timer = setTimeout(() => {
      if (pendingQualitySnapshot !== requestState) return
      pendingQualitySnapshot = null
      reply(504, { ok: false, runId, error: 'snapshot-timeout-no-automatic-retry' })
    }, 12000)
    pendingQualitySnapshot = requestState
    response.once('close', () => {
      if (pendingQualitySnapshot !== requestState) return
      clearTimeout(requestState.timer)
      pendingQualitySnapshot = null
    })
    socket.send(JSON.stringify({
      type: 'quality-snapshot-request', runId, ...(averageBitRate ? { averageBitRate } : {}),
    }))
    return
  }

  if (
    requestURL.pathname === '/browser-clients/prune' &&
    request.method === 'POST'
  ) {
    if (!isLoopbackAddress(request.socket.remoteAddress)) {
      response.writeHead(403, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: false, error: 'loopback-only' }))
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: true, ...pruneInactiveBrowserClients() }))
    return
  }

  if (requestURL.pathname === '/transport/config') {
    const reply = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    if (request.method !== 'POST') { reply(405, { ok: false, error: 'POST-required' }); return }
    if (!isLoopbackAddress(request.socket.remoteAddress) || request.headers['x-phone3d-transport-probe'] !== '1') {
      reply(403, { ok: false, error: 'loopback-probe-only' }); return
    }
    const configuration = parseFrameTransportConfiguration(requestURL.searchParams)
    if (!configuration) { reply(400, { ok: false, error: 'invalid-route-or-window' }); return }
    if (activeBenchmark || pendingQualitySnapshot) { reply(409, { ok: false, error: 'measurement-active' }); return }
    const sources = [...clients.entries()].filter(([socket, role]) => {
      const details = clientDetails.get(socket)
      return role === 'phone-pose' && socket.readyState === WebSocket.OPEN &&
        details?.frameTransportConfigurationSupported === true &&
        details.captureSource === 'screencapturekit-host' && details.lastCaptureState === 'streaming' &&
        Date.now() - (details.lastCaptureHeartbeatAtMs ?? 0) < 2_500
    })
    if (sources.length !== 1) { reply(503, { ok: false, error: 'need-one-capable-streaming-phone' }); return }
    const runId = randomUUID()
    sources[0][0].send(JSON.stringify({ type: 'frame-transport-config', runId, ...configuration }))
    // Dispatch is not application: the caller must wait for the matching
    // configuration ID in fresh device telemetry before measuring anything.
    reply(202, { ok: true, runId, ...configuration })
    return
  }

  if (requestURL.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: true, ...counts() }))
    return
  }

  if (requestURL.pathname === '/transport/trace') {
    if (request.method !== 'GET' || !isLoopbackAddress(request.socket.remoteAddress)) {
      response.writeHead(403); response.end(); return
    }
    const after = Number(requestURL.searchParams.get('after') ?? 0)
    if (!Number.isSafeInteger(after) || after < 0) { response.writeHead(400); response.end(); return }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: true, ...transportTrace.after(after) }))
    return
  }

  if (requestURL.pathname === '/diagnostics') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        ok: true,
        ...diagnostics,
        phoneTransports: currentPhoneTransports(),
        activeBenchmark: activeBenchmarkSummary(),
      }),
    )
    return
  }

  if (requestURL.pathname === '/benchmark/latest') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        ok: true,
        benchmark: diagnostics.latestBrowserBenchmark,
        active: activeBenchmarkSummary(),
      }),
    )
    return
  }

  if (requestURL.pathname === '/benchmark/status') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify(
        benchmarkStatusPayload(
          diagnostics.latestBrowserBenchmark,
          activeBenchmarkSummary(),
        ),
      ),
    )
    return
  }

  if (requestURL.pathname === '/benchmark/start') {
    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'POST' })
      response.end()
      return
    }
    if (!isLoopbackAddress(request.socket.remoteAddress)) {
      response.writeHead(403, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: false, error: 'loopback only' }))
      return
    }
    if (activeBenchmark || pendingQualitySnapshot) {
      response.writeHead(409, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          ok: false,
          error: 'a benchmark or quality snapshot is already active',
          active: activeBenchmarkSummary(),
        }),
      )
      return
    }

    const encoderProfile =
      requestURL.searchParams.get('encoderProfile') === 'legacy'
        ? 'legacy'
        : 'low-latency'
    const requestedEncoderTuning = requestURL.searchParams.get('encoderTuning')
    const encoderTuning = requestedEncoderTuning ?? 'default'
    const requestedDecoderMode =
      requestURL.searchParams.get('decoderMode') ?? 'software'
    const requestedDecoderAcceleration = browserDecoderAcceleration(
      requestedDecoderMode,
    )
    if (!requestedDecoderAcceleration) {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          ok: false,
          error: `unsupported decoderMode "${requestedDecoderMode}"`,
          allowedDecoderModes: browserDecoderModes,
        }),
      )
      return
    }
    const tuningConfigurationError = encoderTuningConfigurationError(
      encoderProfile,
      encoderTuning,
    )
    if (tuningConfigurationError) {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          ok: false,
          error: tuningConfigurationError,
          encoderProfile,
          encoderTuning,
          allowedEncoderTunings: encoderTunings,
        }),
      )
      return
    }

    ensureActiveBrowserClient()
    const connected = counts()
    const nowMs = Date.now()
    const browserFrameConnected =
      activeBrowserFrameSocket !== null &&
      clients.get(activeBrowserFrameSocket) === 'browser' &&
      activeBrowserFrameSocket.readyState === WebSocket.OPEN
    const activeBrowserFrameDetails = browserFrameConnected
      ? clientDetails.get(activeBrowserFrameSocket)
      : null
    const selectedFrameClientId = activeBrowserFrameDetails?.clientId ?? null
    const readyBrowserReceiverSocket = browserFrameConnected
      ? selectBrowserPoseSocket({
          clientId: selectedFrameClientId,
          nowMs,
        })
      : null
    const readyBrowserReceiverDetails = readyBrowserReceiverSocket
      ? clientDetails.get(readyBrowserReceiverSocket)
      : null
    let browserReadinessError = browserFrameConnected
      ? browserBenchmarkReadinessError(
          activeBrowserFrameDetails,
          readyBrowserReceiverDetails,
          activeBrowserClientId,
          nowMs,
        )
      : 'browser-frame-disconnected'
    if (
      browserReadinessError === null &&
      (!Number.isSafeInteger(
        readyBrowserReceiverDetails?.browserConfigGeneration,
      ) || readyBrowserReceiverDetails.browserConfigGeneration <= 0)
    ) {
      browserReadinessError = 'browser-config-generation-missing'
    }
    const readyBrowserFrame = browserReadinessError === null
    const unrestrictedPhoneSourceSelection = selectFreshPhoneSourcePair(nowMs)
    const phoneSourceSelection = selectFreshPhoneSourcePair(
      nowMs,
      null,
      null,
      null,
      'screencapturekit-host',
    )
    const phoneSourcePair = phoneSourceSelection.pair
    const readyPhonePose = phoneSourcePair !== null
    const readyBrowserReceiver = browserReadinessError === null
    if (
      !readyPhonePose ||
      !readyBrowserReceiver ||
      !readyBrowserFrame
    ) {
      response.writeHead(409, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          ok: false,
          error: 'live phone capture and browser telemetry must be ready',
          readyPhonePose,
          phoneSourceReason:
            resolutionBenchmarkCaptureSourceError(
              unrestrictedPhoneSourceSelection,
            ) ?? phoneSourceSelection.reason,
          distinctProducerSessions:
            phoneSourceSelection.distinctProducerSessions,
          readyBrowserReceiver,
          readyBrowserFrame,
          browserReadinessError,
          ...connected,
        }),
      )
      return
    }

    const requestedDurationMs = Number.parseInt(
      requestURL.searchParams.get('durationMs') ?? '15000',
      10,
    )
    const durationMs = Number.isFinite(requestedDurationMs)
      ? Math.min(60_000, Math.max(5_000, requestedDurationMs))
      : 15_000
    const requestedTargetFps = Number.parseInt(
      requestURL.searchParams.get('targetFps') ?? '30',
      10,
    )
    const targetFps = Number.isFinite(requestedTargetFps)
      ? Math.min(120, Math.max(15, requestedTargetFps))
      : 30
    const requestedWarmupMs = Number.parseInt(
      requestURL.searchParams.get('warmupMs') ?? '2000',
      10,
    )
    const warmupMs = Number.isFinite(requestedWarmupMs)
      ? Math.min(5_000, Math.max(500, requestedWarmupMs))
      : 2_000
    const captureShortEdgeParameter =
      requestURL.searchParams.get('captureShortEdge') ?? '960'
    const requestedCaptureShortEdge = Number.parseInt(
      captureShortEdgeParameter,
      10,
    )
    if (
      String(requestedCaptureShortEdge) !== captureShortEdgeParameter ||
      !captureShortEdges.includes(requestedCaptureShortEdge)
    ) {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          ok: false,
          error: `unsupported captureShortEdge "${captureShortEdgeParameter}"`,
          allowedCaptureShortEdges: captureShortEdges,
        }),
      )
      return
    }
    const runId = randomUUID()
    const browserConfigId = randomUUID()
    const requestedBrowserConfigGeneration =
      readyBrowserReceiverDetails.browserConfigGeneration + 1
    const requestedAtMs = Date.now()
    const command = {
      type: 'benchmark-request',
      benchmarkProtocolVersion: 2,
      producerSessionId: phoneSourcePair.producerSessionId,
      captureSource: phoneSourcePair.captureSource,
      runId,
      durationMs,
      targetFps,
      encoderProfile,
      encoderTuning,
      warmupMs,
      captureShortEdge: requestedCaptureShortEdge,
      requestedAtMs,
    }
    activeBenchmark = {
      runId,
      phase: 'browser-preparing',
      valid: true,
      invalidReason: null,
      requestedAtMs,
      durationMs,
      targetFps,
      requestedEncoderProfile: encoderProfile,
      activeEncoderProfile: null,
      requestedEncoderTuning: encoderTuning,
      activeEncoderTuning: null,
      benchmarkProtocolVersion: 2,
      browserConfigId,
      requestedBrowserConfigGeneration,
      browserConfigGeneration: null,
      requestedDecoderMode,
      requestedDecoderAcceleration,
      appliedDecoderMode: null,
      decoderAccelerationConfigured: null,
      browserPrepareStartedAtMs: requestedAtMs,
      browserPreparedAtMs: null,
      browserPrepareClientDurationMs: null,
      requestedCaptureShortEdge,
      captureShortEdgeActive: null,
      captureWidthActive: null,
      captureHeightActive: null,
      captureStreamGeneration: null,
      thermalStateStart: null,
      thermalStateEnd: null,
      thermalStateWorstObserved: null,
      thermalContaminated: false,
      producerSessionId: phoneSourcePair.producerSessionId,
      captureSource: phoneSourcePair.captureSource,
      warmupMs,
      browserFrameSocket: activeBrowserFrameSocket,
      browserPoseSocket: readyBrowserReceiverSocket,
      browserClientId: selectedFrameClientId,
      browserLeaseGeneration,
      // Applying the requested encoder configuration can replace the frame
      // transport during warmup. Pin the freshest matching socket only after
      // the phone emits the protocol-v2 `started` status.
      phoneFrameSocket: null,
      phoneFrameRole: null,
      phoneFrameTransport: null,
      phoneControlTransport: null,
      phonePoseSocket: phoneSourcePair.phonePoseSocket,
      phoneStartedAtMs: null,
      phoneCompletedAtMs: null,
      expiresAtMs: null,
      phoneCommand: command,
    }
    armActiveBenchmarkTimeout(
      activeBenchmark,
      requestedAtMs + browserPrepareTimeoutMs,
      'browser-prepare-timeout',
    )
    retainDiagnostic(diagnostics.benchmarkEvents, {
      ...command,
      phase: 'browser-preparing',
      browserConfigId,
      requestedBrowserConfigGeneration,
      requestedDecoderMode,
      requestedDecoderAcceleration,
      requestedCaptureShortEdge,
    })
    sendToPinnedBenchmarkBrowser(activeBenchmark, {
      type: 'browser-benchmark-prepare',
      browserConfigProtocolVersion: 1,
      runId,
      browserConfigId,
      browserConfigGeneration: requestedBrowserConfigGeneration,
      decoderMode: requestedDecoderMode,
      decoderAcceleration: requestedDecoderAcceleration,
      requestedAtMs,
    })
    response.writeHead(202, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        ok: true,
        runId,
        durationMs,
        targetFps,
        encoderProfile,
        requestedEncoderProfile: encoderProfile,
        activeEncoderProfile: null,
        encoderTuning,
        requestedEncoderTuning: encoderTuning,
        activeEncoderTuning: null,
        benchmarkProtocolVersion: 2,
        browserConfigId,
        requestedBrowserConfigGeneration,
        requestedDecoderMode,
        requestedDecoderAcceleration,
        requestedCaptureShortEdge,
        phase: 'browser-preparing',
        producerSessionId: phoneSourcePair.producerSessionId,
        captureSource: phoneSourcePair.captureSource,
        warmupMs,
      }),
    )
    return
  }

  response.writeHead(404)
  response.end()
})

const sockets = new WebSocketServer({ server, maxPayload: 12 * 1024 * 1024 })

sockets.on('connection', (socket, request) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  const role = url.searchParams.get('role')
  const requestedClientId = url.searchParams.get('clientId')
  const clientId =
    requestedClientId && requestedClientId.length <= 128
      ? requestedClientId
      : null
  const producerIdentityDetails = queryProducerIdentityDetails(url)

  if (
    role !== 'browser' &&
    role !== 'browser-pose' &&
    role !== 'phone' &&
    role !== 'phone-pose' &&
    role !== 'browser-webrtc' &&
    role !== 'phone-webrtc'
  ) {
    socket.close(1008, 'unsupported bridge role')
    return
  }

  if (
    browserClientRoles.has(role) &&
    clientId !== null &&
    blockedBrowserClientIds.has(clientId)
  ) {
    socket.close(4001, 'inactive browser blocked')
    return
  }

  clients.set(socket, role)
  clientDetails.set(socket, {
    remoteAddress: request.socket.remoteAddress ?? null,
    remotePort: request.socket.remotePort ?? null,
    localAddress: request.socket.localAddress ?? null,
    localPort: request.socket.localPort ?? null,
    addressFamily: request.socket.remoteFamily ?? null,
    clientId,
    ...producerIdentityDetails,
    connectedAtMs: Date.now(),
    lastActivityAtMs: Date.now(),
    lastCaptureHeartbeatAtMs: null,
    lastCaptureState: null,
    lastEncoderStatus: null,
    lastCodec: null,
    lastFrameCodec: null,
    lastFrameId: null,
    lastFrameMetadataAtMs: null,
    lastCaptureContentStatus: null,
    lastFreshContent: null,
    captureShortEdgeRequested: null,
    captureShortEdgeActive: null,
    captureWidthActive: null,
    captureHeightActive: null,
    captureStreamGeneration: null,
    lastFrameAtMs: null,
    lastFrameCodec: null,
    lastFrameId: null,
    lastFrameMetadataAtMs: null,
    lastReceiverStatusAtMs: null,
    receiverVisibilityState: null,
    receiverHasFocus: null,
    receiverScreenStale: null,
    browserLeaseGeneration: null,
    browserLeaseActivatedAtMs: null,
    lastFrameReceivedAtMs: null,
    lastFrameRenderedAtMs: null,
    browserConfigId: null,
    browserConfigGeneration: null,
    decoderModeRequested: null,
    decoderModeApplied: null,
    decoderAccelerationConfigured: null,
    lastH264OutputFormat: null,
    lastFrameRelayedAtMs: null,
    lastFrameRelayedId: null,
    // A browser can connect in the middle of an H.264 GOP. Do not waste
    // bandwidth on undecodable deltas while it waits for a recovery IDR.
    awaitingH264Keyframe: role === 'browser',
    lastRecoveryKeyframeRequestAtMs: 0,
  })
  if (role === 'browser') {
    activateBrowserSocket(socket)
  }
  replaceSupersededBrowserClientSockets(socket, role, clientId)
  if (role === 'phone' || role === 'browser') {
    // Either endpoint may reconnect in the middle of a GOP. An immediate IDR
    // makes the first usable frame independent of which side arrived first;
    // per-browser delta handling below retries at a bounded cadence if this
    // control message races the phone encoder startup.
    requestRecoveryKeyframe()
  }
  if (role === 'browser-webrtc') {
    // A fresh browser offer starts a fresh peer session; stale answers and ICE
    // candidates from an earlier tab must never leak into it.
    signalingBacklog['browser-webrtc'].length = 0
    signalingBacklog['phone-webrtc'].length = 0
  }
  if (role === 'browser-webrtc' || role === 'phone-webrtc') {
    flushWebRTCBacklog(role, socket)
  }
  broadcastStatus()

  socket.on('message', (data, isBinary) => {
    const details = clientDetails.get(socket)
    if (details) details.lastActivityAtMs = Date.now()
    if (
      !isBinary &&
      (role === 'browser-webrtc' || role === 'phone-webrtc')
    ) {
      relayWebRTC(role, data)
      return
    }

    if (role === 'browser' && !isBinary) {
      try {
        const message = JSON.parse(data.toString())
        const details = clientDetails.get(socket)
        const isActiveBrowser = browserSocketOwnsFrameLease(
          socket,
          activeBrowserFrameSocket,
        )
        if (message.type === 'request-keyframe' && isActiveBrowser) {
          broadcastToFramePhones(JSON.stringify(message))
        }
      } catch {
        // Ignore browser messages that are not bridge control JSON.
      }
      return
    }

    if (role === 'browser-pose' && !isBinary) {
      try {
        const message = JSON.parse(data.toString())
        if (message.type === 'browser-receiver-status') {
          const details = clientDetails.get(socket)
          if (details) {
            alignBrowserReceiverWithActiveLease(details)
            details.lastReceiverStatusAtMs = Date.now()
            details.receiverVisibilityState = message.visibilityState ?? null
            details.receiverHasFocus = message.hasFocus === true
            details.receiverScreenStale = message.screenStale ?? null
            details.lastFrameReceivedAtMs = Number.isFinite(
              message.lastFrameReceivedAtMs,
            )
              ? message.lastFrameReceivedAtMs
              : null
            details.lastFrameRenderedAtMs = Number.isFinite(
              message.lastFrameRenderedAtMs,
            )
              ? message.lastFrameRenderedAtMs
              : null
            details.browserConfigId =
              typeof message.browserConfigId === 'string'
                ? message.browserConfigId
                : null
            details.browserConfigGeneration = Number.isSafeInteger(
              message.browserConfigGeneration,
            )
              ? message.browserConfigGeneration
              : null
            details.decoderModeRequested =
              browserDecoderAcceleration(message.decoderModeRequested) !== null
                ? message.decoderModeRequested
                : null
            details.decoderModeApplied =
              browserDecoderAcceleration(message.decoderModeApplied) !== null
                ? message.decoderModeApplied
                : null
            details.decoderAccelerationConfigured =
              typeof message.decoderAccelerationConfigured === 'string'
                ? message.decoderAccelerationConfigured
                : null
          }
          const run = activeBenchmark
          if (run && socket === run.browserPoseSocket) {
            const receiverStatusError =
              benchmarkBrowserReceiverStatusError(run, details)
            if (receiverStatusError) {
              invalidateActiveBenchmark(receiverStatusError)
            }
          }
          if (
            details?.clientId &&
            details.receiverVisibilityState === 'visible' &&
            details.receiverHasFocus &&
            (!activeBenchmark ||
              details.clientId === activeBrowserClientId) &&
            (details.clientId === activeBrowserClientId ||
              (browserLeaseFailures.get(details.clientId)?.blockedUntilMs ?? 0) <=
                Date.now())
          ) {
            activateBrowserClient(details.clientId)
          }
          checkBrowserLeaseHealth(Date.now())
          const activeFrameDetails = activeBrowserFrameSocket
            ? clientDetails.get(activeBrowserFrameSocket)
            : null
          retainDiagnostic(diagnostics.receiverSamples, {
            ...message,
            serverBrowser: browserReceiverServerState(
              details,
              activeFrameDetails,
              activeBrowserClientId,
              Date.now(),
            ),
          })
        } else if (message.type === 'pose-mode') {
          if (socket === selectBrowserPoseSocket()) {
            broadcastToPosePhones(JSON.stringify(message))
          }
        } else if (
          message.type === 'h264-output-format' &&
          (message.format === 'annex-b' || message.format === 'avcc')
        ) {
          if (socket === selectBrowserPoseSocket()) {
            broadcastH264OutputFormatToPosePhones(message.format)
          }
        } else if (message.type === 'browser-benchmark-cancel') {
          handleBrowserBenchmarkCancel(socket, message)
        } else if (message.type === 'browser-benchmark-prepare-ack') {
          handleBrowserBenchmarkPrepareAck(socket, message)
        } else if (message.type === 'browser-benchmark-report') {
          handleBrowserBenchmarkReport(socket, message)
        }
      } catch {
        // Ignore browser telemetry that is not valid control JSON.
      }
      return
    }

    if (role !== 'phone' && role !== 'phone-pose') return

    if (isBinary && role === 'phone') {
      const metadata = pendingFrameMetadata.get(socket)
      pendingFrameMetadata.delete(socket)
      relayPhoneFrame(
        data,
        metadata,
        (acknowledgment) => {
          if (socket.readyState === WebSocket.OPEN) socket.send(acknowledgment)
        },
        socket,
        'websocket-frame',
        details,
      )
      return
    }

    let message
    try {
      message = JSON.parse(data.toString())
    } catch {
      return
    }

    if (message.type === 'quality-snapshot-result' && role === 'phone-pose') {
      const pending = pendingQualitySnapshot
      if (!pending || socket !== pending.socket || message.runId !== pending.runId) return
      const error = qualitySnapshotResultError(message, pending.runId)
      clearTimeout(pending.timer)
      pendingQualitySnapshot = null
      pending.reply(error ? 422 : 200, error
        ? { ok: false, runId: pending.runId, error }
        : { ok: true, runId: pending.runId, relativePath: message.relativePath,
          frameId: message.frameId, width: message.width, height: message.height })
      return
    }

    if (message.type === 'clock-sync') {
      const bridgeReceiveAtPreciseMs = preciseWallClockMs()
      const requestedPhoneSendAtPreciseMs = Number(
        message.phoneSendAtPreciseMs ?? message.phoneSendAtMs,
      )
      const phoneSendAtPreciseMs = Number.isFinite(
        requestedPhoneSendAtPreciseMs,
      )
        ? requestedPhoneSendAtPreciseMs
        : Number(message.phoneSendAtMs)
      const phoneSendAtMs = Number.isSafeInteger(message.phoneSendAtMs)
        ? message.phoneSendAtMs
        : Math.trunc(phoneSendAtPreciseMs)
      const bridgeSendAtPreciseMs = preciseWallClockMs()
      socket.send(
        JSON.stringify({
          type: 'clock-sync-reply',
          requestId: message.requestId,
          clockSyncVersion: 2,
          phoneSendAtMs,
          bridgeReceiveAtMs: Math.trunc(bridgeReceiveAtPreciseMs),
          bridgeSendAtMs: Math.trunc(bridgeSendAtPreciseMs),
          phoneSendAtPreciseMs,
          bridgeReceiveAtPreciseMs,
          bridgeSendAtPreciseMs,
        }),
      )
      return
    }

    if (message.type === 'frame-meta' && role === 'phone') {
      const receivedMetadata = {
        ...message,
        metadataReceivedAtMs: Date.now(),
      }
      observeProducerIdentity(details, receivedMetadata)
      updateCaptureFreshness(details, receivedMetadata)
      updateCaptureConfiguration(details, receivedMetadata)
      pendingFrameMetadata.set(socket, receivedMetadata)
      const run = activeBenchmark
      if (run?.valid && socket === run.phoneFrameSocket) {
        const observedIdentity = producerIdentityFrom(receivedMetadata)
        if (!observedIdentity) {
          invalidateActiveBenchmark('frame-producer-identity-missing')
        } else if (
          details?.producerIdentityValid !== true ||
          !sameProducerIdentity(run, observedIdentity)
        ) {
          invalidateActiveBenchmark('frame-producer-identity-mismatch')
        } else {
          const freshnessError = captureFreshnessError(receivedMetadata)
          if (freshnessError) invalidateActiveBenchmark(freshnessError)
        }
      }
      return
    }

    if (message.type === 'pose' && role === 'phone-pose') {
      observeProducerIdentity(details, message)
      const run = activeBenchmark
      if (run?.valid) {
        if (socket !== run.phonePoseSocket) return
        const producerError = benchmarkProducerMessageError(
          run,
          socket,
          message,
          'pose',
        )
        if (producerError || details?.producerIdentityValid !== true) {
          invalidateActiveBenchmark(
            producerError ?? 'pose-producer-connection-conflict',
          )
          return
        }
      }
      const bridgeReceivedAtMs = Date.now()
      broadcastToPoseBrowsers(
        JSON.stringify({
          ...message,
          bridgeReceivedAtMs,
          bridgeRelayedAtMs: Date.now(),
        }),
      )
      return
    }

    if (message.type === 'encoder-status' && role === 'phone-pose') {
      observeProducerIdentity(details, message)
      if (details) {
        details.lastCaptureHeartbeatAtMs = Date.now()
        details.lastCaptureState = message.captureState ?? null
        details.lastEncoderStatus = message.encoderStatus ?? null
        details.lastCodec = message.codec ?? null
        details.qualitySnapshotSupported = message.qualitySnapshotSupported === true
        details.frameTransportConfigurationSupported = message.frameTransportConfigurationSupported === true
        updateCaptureFreshness(details, message)
        updateCaptureConfiguration(details, message)
      }
      const traceACK = transportTrace.append(message, Date.now())
      if (traceACK && details?.producerIdentityValid === true && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(traceACK))
      }
      delete message.frameTransportTraceSamples
      retainDiagnostic(diagnostics.encoderSamples, message)
      const run = activeBenchmark
      if (run?.valid) {
        if (socket !== run.phonePoseSocket) return
        const producerError = benchmarkProducerMessageError(
          run,
          socket,
          message,
          'encoder-status',
        )
        const readinessError = benchmarkEncoderReadinessError(run, message)
        const activeConfigurationError =
          benchmarkEncoderStatusValidationError(run, message)
        if (
          producerError ||
          details?.producerIdentityValid !== true ||
          readinessError ||
          activeConfigurationError
        ) {
          invalidateActiveBenchmark(
            producerError ??
              (details?.producerIdentityValid !== true
                ? 'encoder-status-producer-connection-conflict'
                : readinessError ?? activeConfigurationError),
          )
          return
        }
        observeBenchmarkThermalState(run, message.thermalState)
      }
      broadcastToPoseBrowsers(JSON.stringify(message))
      return
    }

    if (message.type === 'benchmark-status' && role === 'phone-pose') {
      observeProducerIdentity(details, message)
      handlePhoneBenchmarkStatus(socket, message)
    }
  })

  socket.on('close', () => {
    invalidateBenchmarkForDisconnectedSocket(socket, role)
    clients.delete(socket)
    clientDetails.delete(socket)
    pendingFrameMetadata.delete(socket)
    ensureActiveBrowserClient()
    broadcastStatus()
  })

  socket.on('error', () => {
    invalidateBenchmarkForDisconnectedSocket(socket, role)
    clients.delete(socket)
    clientDetails.delete(socket)
    pendingFrameMetadata.delete(socket)
    ensureActiveBrowserClient()
    broadcastStatus()
  })
})

const maxRawFrameRecordBytes = 12 * 1024 * 1024
const rawFrameServer = net.createServer((socket) => {
  socket.setNoDelay(true)
  socket.setKeepAlive(true, 2_000)
  const details = {
    remoteAddress: socket.remoteAddress ?? null,
    remotePort: socket.remotePort ?? null,
    localAddress: socket.localAddress ?? null,
    localPort: socket.localPort ?? null,
    addressFamily: socket.remoteFamily ?? null,
    producerSessionId: null,
    captureSource: null,
    producerIdentityValid: null,
    lastActivityAtMs: Date.now(),
    lastFrameAtMs: null,
    lastCaptureContentStatus: null,
    lastFreshContent: null,
    captureShortEdgeRequested: null,
    captureShortEdgeActive: null,
    captureWidthActive: null,
    captureHeightActive: null,
    captureStreamGeneration: null,
  }
  rawFramePhones.set(socket, details)
  broadcastStatus()
  requestRecoveryKeyframe()

  let buffered = Buffer.alloc(0)
  let bufferedStartedAt = 0
  socket.on('data', (chunk) => {
    const chunkReceivedAt = performance.now()
    if (buffered.byteLength === 0) bufferedStartedAt = chunkReceivedAt
    details.lastActivityAtMs = Date.now()
    buffered = buffered.byteLength === 0
      ? chunk
      : Buffer.concat([buffered, chunk])

    while (buffered.byteLength >= 4) {
      const recordLength = buffered.readUInt32BE(0)
      if (recordLength <= frameEnvelopeHeaderBytes ||
          recordLength > maxRawFrameRecordBytes) {
        socket.destroy(new Error('invalid raw frame record length'))
        return
      }
      if (buffered.byteLength < 4 + recordLength) return

      const record = buffered.subarray(4, 4 + recordLength)
      const readTiming = { startedAt: bufferedStartedAt, completedAt: chunkReceivedAt }
      buffered = buffered.subarray(4 + recordLength)
      // Previously buffered bytes formed only the incomplete leading record;
      // any remainder after it belongs to this newest chunk.
      bufferedStartedAt = chunkReceivedAt
      relayPhoneFrame(
        record,
        null,
        (acknowledgment) => {
          sendRawFrameControl(socket, acknowledgment)
        },
        socket,
        'raw-frame',
        details,
        readTiming,
      )
    }
  })

  const removeRawFramePhone = () => {
    if (rawFramePhones.has(socket)) {
      invalidateBenchmarkForDisconnectedSocket(socket, 'raw-frame')
      rawFramePhones.delete(socket)
      broadcastStatus()
    }
  }
  socket.on('close', removeRawFramePhone)
  socket.on('error', removeRawFramePhone)
})

const browserLeaseHealthTimer = startBrowserLeaseHealthTimer(
  checkBrowserLeaseHealth,
)

const phoneLivenessTimer = setInterval(() => {
  const now = Date.now()

  for (const [client, role] of clients) {
    const details = clientDetails.get(client)
    if (!details) continue
    const lastRelevantActivityAtMs =
      role === 'phone-pose'
        ? (details.lastCaptureHeartbeatAtMs ?? details.lastActivityAtMs)
        : role === 'phone'
          ? (details.lastFrameAtMs ?? details.lastActivityAtMs)
          : null
    if (
      lastRelevantActivityAtMs !== null &&
      now - lastRelevantActivityAtMs > 5_000
    ) {
      client.terminate()
    }
  }

  for (const [client, details] of rawFramePhones) {
    const poseSources = [...clients.entries()]
      .filter(([, role]) => role === 'phone-pose')
      .map(([socket]) => clientDetails.get(socket)).filter(Boolean)
    if (rawFrameLivenessExpired(details, poseSources, now)) {
      client.destroy()
    }
  }
}, 1_000)
phoneLivenessTimer.unref()

function shutdown() {
  clearInterval(browserLeaseHealthTimer)
  clearInterval(phoneLivenessTimer)
  releaseActiveBenchmark(activeBenchmark)
  for (const runId of benchmarkCommandTimers.keys()) {
    clearBenchmarkCommandRetries(runId)
  }
  for (const client of rawFramePhones.keys()) client.destroy()
  rawFrameServer.close()
  for (const client of clients.keys()) client.close(1001, 'bridge shutting down')
  sockets.close(() => server.close())
}

if (isDirectExecution) {
  server.listen(port, host, () => {
    console.log(`Phone bridge listening on ws://127.0.0.1:${port}/?role=browser`)
    for (const address of localAddresses()) {
      console.log(`iPhone endpoint: ws://${address}:${port}/?role=phone`)
    }
  })

  rawFrameServer.listen(framePort, host, () => {
    console.log(`Low-latency iPhone frame endpoint: tcp://[${host}]:${framePort}`)
  })

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
