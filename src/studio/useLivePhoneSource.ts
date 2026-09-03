import { useCallback, useEffect, useRef, useState } from 'react'
import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three'
import type { ScreenOrientation } from '../model/iphone17'
import type { PoseSample } from './contracts'
import {
  buildLiveMeasurementReport,
  type FrameMeasurementSample,
  type LiveMeasurementReport,
  type PoseMeasurementSample,
  type PoseRenderMeasurementSample,
} from './liveMeasurement'
import {
  multiplyQuaternions,
  normalizeQuaternion,
  parseLiveTextMessage,
  relativeQuaternion,
  type FrameMetadataMessage,
  type LivePoseMessage,
  type QuaternionTuple,
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
  frames: Map<number, FrameMeasurementSample>
  poses: PoseMeasurementSample[]
  poseRenders: PoseRenderMeasurementSample[]
  droppedBeforeDecode: number
}

interface PendingFrame {
  bytes: ArrayBuffer
  metadata: FrameMetadataMessage | null
  browserReceivedAtMs: number
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

export function getDefaultBridgeUrl() {
  return `ws://${window.location.hostname}:4319/?role=browser`
}

export function getPoseBridgeUrl() {
  return `ws://${window.location.hostname}:4319/?role=browser-pose`
}

export function getWebRTCBridgeUrl() {
  return `ws://${window.location.hostname}:4319/?role=browser-webrtc`
}

export function useLivePhoneSource() {
  const socketRef = useRef<WebSocket | null>(null)
  const poseSocketRef = useRef<WebSocket | null>(null)
  const webRTCSignalRef = useRef<WebSocket | null>(null)
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null)
  const webRTCVideoRef = useRef<HTMLVideoElement | null>(null)
  const webRTCFrameRequestRef = useRef<number | null>(null)
  const webRTCStatsTimerRef = useRef<number | null>(null)
  const textureRef = useRef<CanvasTexture | null>(null)
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
  const lastPoseReceivedRef = useRef<number | null>(null)
  const activeMeasurementRef = useRef<ActiveMeasurement | null>(null)
  const [media, setMedia] = useState<ScreenMedia | null>(null)
  const [orientation, setOrientation] = useState<ScreenOrientation>('portrait')
  const [poseReady, setPoseReady] = useState(false)
  const [hasManualLevel, setHasManualLevel] = useState(false)
  const [screenStale, setScreenStale] = useState(false)
  const [poseStale, setPoseStale] = useState(false)
  const [posePresentationMode, setPosePresentationModeState] =
    useState<PosePresentationMode>('synchronized')
  const [poseDiagnostics, setPoseDiagnostics] =
    useState<LivePoseDiagnostics | null>(null)
  const [status, setStatus] = useState<LivePhoneStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<LivePhoneStats>(initialStats)
  const [measurement, setMeasurement] =
    useState<LiveMeasurementState>(initialMeasurement)

  const releaseResources = useCallback(() => {
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
    lastPoseReceivedRef.current = null
  }, [])

  const finishMeasurement = useCallback(() => {
    const active = activeMeasurementRef.current
    if (!active) return
    activeMeasurementRef.current = null
    const endedAtMs = Date.now()
    const frames = [...active.frames.values()]
    const report = buildLiveMeasurementReport(
      active.startedAtMs,
      endedAtMs,
      frames,
      active.poses,
      active.poseRenders,
      active.droppedBeforeDecode,
    )
    setMeasurement({
      status: 'complete',
      elapsedMs: endedAtMs - active.startedAtMs,
      receivedFrames: frames.length,
      renderedFrames: report.screen.renderedFrames,
      poseSamples: active.poses.length,
      poseRenderSamples: active.poseRenders.length,
      report,
    })
  }, [])

  const startMeasurement = useCallback(() => {
    const startedAtMs = Date.now()
    activeMeasurementRef.current = {
      startedAtMs,
      frames: new Map(),
      poses: [],
      poseRenders: [],
      droppedBeforeDecode: 0,
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
  }, [])

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
    (frameId: number, renderedAtMs = Date.now()) => {
      const frame = activeMeasurementRef.current?.frames.get(frameId)
      if (frame && frame.renderedAtMs === null) frame.renderedAtMs = renderedAtMs
    },
    [],
  )

  const disconnect = useCallback(() => {
    finishMeasurement()
    releaseResources()
    setMedia(null)
    setPoseReady(false)
    setHasManualLevel(false)
    setScreenStale(false)
    setPoseStale(false)
    setPoseDiagnostics(null)
    setStatus('idle')
    setError(null)
    setStats(initialStats)
  }, [finishMeasurement, releaseResources])

  const calibratePose = useCallback(() => {
    const rawPose = rawPoseRef.current
    if (!rawPose) return

    zeroPoseRef.current = rawPose
    poseRef.current = {
      timestampMs: Date.now(),
      quaternion: STANDARD_TABLETOP_QUATERNION,
    }
    ultraPoseKinematicsRef.current = null
    previousUltraPoseKinematicsRef.current = null
    setPoseDiagnostics({
      latestSensorRelative: [0, 0, 0, 1],
      targetQuaternion: STANDARD_TABLETOP_QUATERNION,
      sampledAtMs: Date.now(),
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
          timestampMs: Date.now(),
          quaternion: tabletopQuaternion(reference, rawPose),
        }
      }
    },
    [sendPosePresentationMode],
  )

  const connect = useCallback(() => {
    finishMeasurement()
    releaseResources()
    setMedia(null)
    setPoseReady(false)
    setHasManualLevel(false)
    setScreenStale(false)
    setPoseStale(false)
    setPoseDiagnostics(null)
    setStatus('connecting')
    setError(null)
    setStats(initialStats)

    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d', { alpha: false })

    if (!context) {
      setStatus('error')
      setError('This browser could not create the live screen canvas.')
      return
    }

    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    texture.generateMipmaps = false
    textureRef.current = texture

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
    let lastPoseUiUpdate = 0
    let webRTCFrames = 0
    let previousWebRTCStats: WebRTCReceiverSample | null = null
    let webRTCFpsSamples: WebRTCReceiverSample[] = []
    let webRTCPhonePresent = false
    let offeredForCurrentWebRTCPhone = false
    let makingWebRTCOffer = false
    const h264Frames = new Map<number, PendingFrame>()
    let awaitingH264Keyframe = false
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

    const h264DecoderConfig: VideoDecoderConfig = {
      // The 960 x 2088 low-latency stream is explicitly encoded as Baseline
      // profile, constraint byte 0, Level 4.1 so Chrome can use hardware decode.
      codec: 'avc1.420029',
      optimizeForLatency: true,
      hardwareAcceleration: 'prefer-hardware',
    }

    const requestKeyframe = () => {
      const now = Date.now()
      if (now - lastKeyframeRequestAtMs < 500) return
      lastKeyframeRequestAtMs = now
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'request-keyframe' }))
      }
    }

    const commitDecodedFrame = (
      frame: PendingFrame,
      width: number,
      height: number,
      decodedAtMs: number,
    ) => {
      texture.needsUpdate = true
      frames += 1
      const captureAtMacMs = frame.metadata
        ? phoneTimeOnMac(
            frame.metadata.captureAtMs,
            frame.metadata.clockOffsetMs,
          )
        : null
      const synchronizedPose = applyPoseForPresentedFrame(
        captureAtMacMs,
        decodedAtMs,
      )

      if (frame.metadata) {
        const sample = activeMeasurementRef.current?.frames.get(
          frame.metadata.frameId,
        )
        if (sample) {
          sample.decodedAtMs = decodedAtMs
          sample.poseScreenSkewMs = synchronizedPose?.nearestSampleDeltaMs ?? null
        }
        liveFrameRenderRef.current = { frameId: frame.metadata.frameId }
      }

      setMedia((current) => {
        if (
          current?.kind === 'texture' &&
          current.width === width &&
          current.height === height
        ) {
          return current
        }

        return {
          kind: 'texture',
          name: 'Live iPhone screen',
          texture,
          width,
          height,
        }
      })
      setStatus('ready')

      const now = performance.now()
      if (now - lastFrameUiUpdate > 200) {
        lastFrameUiUpdate = now
        setStats((current) => ({
          ...current,
          frames,
          codec: frame.metadata?.codec ?? current.codec,
          frameLatencyMs:
            captureAtMacMs === null
              ? null
              : Math.max(0, decodedAtMs - captureAtMacMs),
          poseSyncDelayMs,
          poseSyncErrorMs,
          poseSyncMode,
        }))
      }
    }

    const ensureH264Decoder = () => {
      const currentDecoder = videoDecoderRef.current
      if (currentDecoder && currentDecoder.state !== 'closed') {
        return currentDecoder
      }
      if (typeof VideoDecoder === 'undefined') return null

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
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width
            canvas.height = height
          }
          context.drawImage(videoFrame, 0, 0, width, height)
          videoFrame.close()
          commitDecodedFrame(frame, width, height, Date.now())
        },
        error: () => {
          setStatus('error')
          setError('The browser H.264 decoder rejected the live stream.')
        },
      })
      decoder.configure(h264DecoderConfig)
      videoDecoderRef.current = decoder
      return decoder
    }

    const decodeNextFrame = async () => {
      if (decodingFrame || !pendingFrame) return
      decodingFrame = true
      const frame = pendingFrame
      pendingFrame = null

      try {
        if (frame.metadata?.codec === 'h264') {
          const decoder = ensureH264Decoder()
          if (!decoder) {
            throw new Error('WebCodecs VideoDecoder is unavailable')
          }

          const isKeyframe = frame.metadata.isKeyframe === true
          if (awaitingH264Keyframe && !isKeyframe) {
            const active = activeMeasurementRef.current
            if (active) active.droppedBeforeDecode += 1
            requestKeyframe()
            return
          }

          if (decoder.decodeQueueSize > 2 && !isKeyframe) {
            const active = activeMeasurementRef.current
            if (active) {
              active.droppedBeforeDecode += h264Frames.size + 1
            }
            decoder.reset()
            decoder.configure(h264DecoderConfig)
            h264Frames.clear()
            awaitingH264Keyframe = true
            requestKeyframe()
            return
          }

          if (isKeyframe) {
            if (awaitingH264Keyframe) {
              decoder.reset()
              decoder.configure(h264DecoderConfig)
              h264Frames.clear()
            }
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
        const decodedAtMs = Date.now()
        commitDecodedFrame(frame, canvas.width, canvas.height, decodedAtMs)
      } catch {
        setStatus('error')
        setError('The live bridge sent a frame this browser could not decode.')
      } finally {
        decodingFrame = false
        if (pendingFrame) void decodeNextFrame()
      }
    }

    const handlePoseMessage = (message: LivePoseMessage) => {
      const browserReceivedAtMs = Date.now()
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
      lastFrameReceivedRef.current = Date.now()
      setScreenStale(false)
      setOrientation(height >= width ? 'portrait' : 'landscape')
      setMedia((current) => {
        if (
          current?.kind === 'video' &&
          current.element === video &&
          current.width === width &&
          current.height === height
        ) {
          return current
        }
        return {
          kind: 'video',
          name: 'Live iPhone screen · WebRTC',
          element: video,
          width,
          height,
        }
      })
      setStatus('ready')
      setError(null)
    }

    const countWebRTCFrame: VideoFrameRequestCallback = (
      _now,
      metadata,
    ) => {
      const video = webRTCVideoRef.current
      if (!video || peerConnectionRef.current !== peerConnection) return
      const presentedAtMacMs = Date.now()
      const captureAtMacMs = captureTimeToEpochMs(
        metadata.captureTime,
        presentedAtMacMs,
        performance.timeOrigin,
      )
      if (usesVideoAlignedPose(posePresentationModeRef.current)) {
        applyPoseForPresentedFrame(captureAtMacMs, presentedAtMacMs)
      }
      webRTCFrames += 1
      updateWebRTCMedia(video)
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
        setError('WebRTC video negotiation failed; H.264 and JPEG remain available on the iPhone.')
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
      try {
        const offer = await peerConnection.createOffer({
          iceRestart: peerConnection.remoteDescription !== null,
          offerToReceiveVideo: true,
        })
        await peerConnection.setLocalDescription(offer)
        if (webRTCSignal.readyState === WebSocket.OPEN) {
          webRTCSignal.send(
            JSON.stringify({ type: 'webrtc-offer', sdp: offer.sdp }),
          )
        }
      } catch {
        offeredForCurrentWebRTCPhone = false
        setError('The browser could not create a WebRTC video offer.')
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
      }
      webRTCPhonePresent = nextWebRTCPhonePresent
      setStats((current) => ({
        ...current,
        browsers: message.browsers,
        phones: message.phones,
      }))
      if (message.phones > 0) {
        sendPosePresentationMode(posePresentationModeRef.current)
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
              timestampMs: Date.now(),
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
        typeof message.candidate === 'string'
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
        setStatus('connecting')
        requestKeyframe()
      }
    })

    socket.addEventListener('message', (event) => {
      if (socketRef.current !== socket) return

      if (event.data instanceof ArrayBuffer) {
        const browserReceivedAtMs = Date.now()
        lastFrameReceivedRef.current = browserReceivedAtMs
        setScreenStale(false)
        const metadata = frameMetadataQueue.shift() ?? null
        const active = activeMeasurementRef.current

        if (active && metadata) {
          const offset = metadata.clockOffsetMs
          const captureAtMacMs = phoneTimeOnMac(metadata.captureAtMs, offset)
          active.frames.set(metadata.frameId, {
            frameId: metadata.frameId,
            codec: metadata.codec,
            captureAtMacMs,
            callbackAtMacMs: phoneTimeOnMac(metadata.callbackAtMs, offset),
            encodeStartedAtMacMs: phoneTimeOnMac(
              metadata.encodeStartedAtMs,
              offset,
            ),
            encodedAtMacMs: phoneTimeOnMac(metadata.encodedAtMs, offset),
            bridgeReceivedAtMs: metadata.bridgeReceivedAtMs,
            bridgeRelayedAtMs: metadata.bridgeRelayedAtMs,
            browserReceivedAtMs,
            decodedAtMs: null,
            renderedAtMs: null,
            payloadBytes: metadata.payloadBytes ?? metadata.jpegBytes,
            clockRttMs: metadata.clockRttMs,
            poseScreenSkewMs: null,
          })
        }

        if (pendingFrame && active) active.droppedBeforeDecode += 1
        pendingFrame = { bytes: event.data, metadata, browserReceivedAtMs }
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
        setOrientation(message.orientation)
        return
      }

      handlePoseMessage(message)
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
      }
    })

    poseSocket.addEventListener('open', () => {
      if (poseSocketRef.current === poseSocket) {
        sendPosePresentationMode(posePresentationModeRef.current)
      }
    })

    poseSocket.addEventListener('error', () => {
      if (poseSocketRef.current === poseSocket) setPoseStale(true)
    })

    socket.addEventListener('error', () => {
      if (socketRef.current !== socket) return
      setStatus('error')
      setError('Cannot reach the local phone bridge on port 4319.')
    })

    socket.addEventListener('close', () => {
      if (socketRef.current !== socket) return
      socketRef.current = null
      finishMeasurement()
      setStatus('idle')
    })
  }, [finishMeasurement, releaseResources, sendPosePresentationMode])

  useEffect(() => disconnect, [disconnect])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now()
      const lastFrame = lastFrameReceivedRef.current
      const lastPose = lastPoseReceivedRef.current
      const active = activeMeasurementRef.current

      setScreenStale(lastFrame !== null && now - lastFrame > 1_000)
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
  }, [])

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
