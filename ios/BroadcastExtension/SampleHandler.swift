import CoreImage
import CoreMedia
import CoreVideo
import Foundation
import ImageIO
import ReplayKit

final class SampleHandler: RPBroadcastSampleHandler {
    private struct BenchmarkRun {
        let id: String
        let durationMs: Int
        let targetFps: Int
        // `encoderProfile` is the requested profile and remains the field used
        // by the current bridge contract. The active field records a runtime
        // low-latency -> legacy fallback without making the status invalid.
        let encoderProfile: String
        let encoderProfileActive: String?
        // The requested tuning is kept separate from the effective tuning so
        // an unsupported VideoToolbox preset is never reported as applied.
        let encoderTuning: String
        let encoderTuningActive: String?
    }

    private struct BenchmarkEvent {
        let run: BenchmarkRun
        let phase: String
    }

    private struct CaptureTimestampEstimate {
        let timestampMs: Int64
        let source: String
        let isValid: Bool
        // Signed ReplayKit PTS age relative to the host clock at callback
        // processing time. A negative value means the PTS is slightly ahead.
        let sampleAgeMs: Double?
    }

    private struct DiagnosticCounters {
        var captured: Int64 = 0
        var submitted: Int64 = 0
        var encoded: Int64 = 0
        var accepted: Int64 = 0
        var rejected: Int64 = 0
        var cadenceDrops: Int64 = 0
        var transportDrops: Int64 = 0
        var encoderDrops: Int64 = 0
        var conversionFailures: Int64 = 0
        var directFrames: Int64 = 0
        var convertedFrames: Int64 = 0
        var lastPayloadBytes = 0
        var inputPixelFormat: OSType = 0
        var lastPresentationTimestamp = CMTime.invalid
        var presentationIntervalTotalMs = 0.0
        var presentationIntervalSamples: Int64 = 0
        var presentationIntervalMaxMs = 0.0
        var conversionTotalMs = 0.0
        var conversionSamples: Int64 = 0
        var conversionMaxMs = 0.0
    }

    private struct LifecycleState {
        var isBroadcasting = false
        var isPaused = false
    }

    private let frameSocket = LowLatencyFrameSocket()
    private let poseSocket = LiveSocket()
    private let producerSessionId = UUID().uuidString.lowercased()
    private let captureSource = "replaykit-broadcast-upload"
    // The producer session changes for every broadcast-upload lifetime, so one
    // generation is sufficient while still making every H.264 frame explicit.
    private let captureStreamGeneration: Int64 = 1
    private let h264PipelineEpoch: UInt64 = 1
    private lazy var motion = MotionStreamer(
        socket: poseSocket,
        producerSessionId: producerSessionId,
        captureSource: captureSource
    )

    // ReplayKit supplies frames serially today, but keeping all VideoToolbox
    // and Core Image state on a queue also serializes benchmark profile changes
    // and lifecycle teardown against a frame callback.
    private let pipelineQueue = DispatchQueue(
        label: "Phone3D.Broadcast.pipeline",
        qos: .userInteractive
    )
    private let networkQueue = DispatchQueue(
        label: "Phone3D.Broadcast.network",
        qos: .userInitiated
    )
    private let benchmarkQueue = DispatchQueue(
        label: "Phone3D.Broadcast.benchmark",
        qos: .userInitiated
    )

    private let imageContext = CIContext(options: [.cacheIntermediates: false])
    private let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
    private lazy var h264Encoder = H264Encoder(codecOutputHandler: {
        [weak self] data, timing, isKeyframe, decoderCodec,
        bitstreamFormat, decoderDescription in
        self?.sendH264Frame(
            data: data,
            timing: timing,
            isKeyframe: isKeyframe,
            decoderCodec: decoderCodec,
            bitstreamFormat: bitstreamFormat,
            decoderDescription: decoderDescription
        ) ?? false
    })

    // Pipeline-queue confined state.
    private var frameRateGate = FrameRateGate()
    private var targetFrameRate = 30
    private var encoderProfile = H264Encoder.Profile.lowLatency
    private var encoderTuning = H264Encoder.Tuning.default
    private var encoderTuningCommandRequestedRaw: String?
    private var encoderTuningCommandFallbackReason: String?
    private var nextFrameId: Int64 = 0
    private var h264PixelBufferPool: CVPixelBufferPool?
    private var h264PixelBufferDimensions: (width: Int, height: Int)?
    private var diagnosticTimer: DispatchSourceTimer?

    // Network-queue confined state.
    private var bridgeURL: URL?
    private var frameReconnectWorkItem: DispatchWorkItem?
    private var poseReconnectWorkItem: DispatchWorkItem?
    private var frameReconnectAttempt = 0
    private var poseReconnectAttempt = 0

    // Benchmark-queue confined state.
    private var pendingBenchmarkRun: BenchmarkRun?
    private var benchmarkRun: BenchmarkRun?
    private var benchmarkStartWorkItem: DispatchWorkItem?
    private var benchmarkEndWorkItem: DispatchWorkItem?
    private var deferredTerminalBenchmarkEvent: BenchmarkEvent?

    private let lifecycleLock = NSLock()
    private var lifecycleState = LifecycleState()
    private let diagnosticLock = NSLock()
    private var diagnosticCounters = DiagnosticCounters()

    override init() {
        super.init()

        frameSocket.onStateChange = { [weak self] state in
            self?.networkQueue.async { [weak self] in
                self?.handleFrameSocketState(state)
            }
        }
        frameSocket.onKeyframeRequest = { [weak self] in
            self?.pipelineQueue.async { [weak self] in
                self?.h264Encoder.requestKeyframe()
            }
        }
        poseSocket.onStateChange = { [weak self] state in
            self?.networkQueue.async { [weak self] in
                self?.handlePoseSocketState(state)
            }
        }
        poseSocket.onKeyframeRequest = { [weak self] in
            self?.pipelineQueue.async { [weak self] in
                self?.h264Encoder.requestKeyframe()
            }
        }
        poseSocket.onTextMessage = { [weak self] text in
            self?.handlePoseControl(text)
        }
    }

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        guard
            let value = Bundle.main.object(forInfoDictionaryKey: "LiveBridgeURL") as? String,
            let url = URL(string: value),
            url.host != nil,
            url.port != nil
        else {
            finishBroadcastWithError(BroadcastError.missingBridgeURL)
            return
        }

        lifecycleLock.withLock {
            lifecycleState.isBroadcasting = true
            lifecycleState.isPaused = false
        }
        pipelineQueue.sync {
            resetPipelineForStart()
            startDiagnostics()
        }
        networkQueue.sync {
            bridgeURL = url
            frameReconnectAttempt = 0
            poseReconnectAttempt = 0
            connectBridgeServices(to: url)
            motion.start()
        }
    }

    override func broadcastPaused() {
        let shouldPause = lifecycleLock.withLock {
            guard lifecycleState.isBroadcasting else { return false }
            lifecycleState.isPaused = true
            return true
        }
        guard shouldPause else { return }
        benchmarkQueue.async { [weak self] in
            self?.finishBenchmark(result: "cancelled")
        }
        networkQueue.sync {
            cancelReconnects()
            motion.stop()
        }
        pipelineQueue.sync {
            frameRateGate.reset()
            h264Encoder.invalidate()
            releaseConversionPool()
        }
    }

    override func broadcastResumed() {
        let shouldResume = lifecycleLock.withLock {
            guard lifecycleState.isBroadcasting else { return false }
            lifecycleState.isPaused = false
            return true
        }
        guard shouldResume else { return }

        pipelineQueue.sync {
            frameRateGate.reset()
            h264Encoder.requestKeyframe()
        }
        networkQueue.sync {
            guard let bridgeURL else { return }
            if frameSocket.state != .connected,
               frameSocket.state != .connecting {
                frameSocket.connect(to: bridgeURL)
            }
            if poseSocket.state != .connected,
               poseSocket.state != .connecting {
                poseSocket.connect(to: poseBridgeURL(from: bridgeURL))
            }
            motion.start()
        }
    }

    override func broadcastFinished() {
        lifecycleLock.withLock {
            lifecycleState.isBroadcasting = false
            lifecycleState.isPaused = false
        }
        benchmarkQueue.sync {
            finishBenchmark(result: "cancelled")
        }
        networkQueue.sync {
            cancelReconnects()
            motion.stop()
            frameSocket.disconnect()
            poseSocket.disconnect()
            bridgeURL = nil
        }
        pipelineQueue.sync {
            stopDiagnostics()
            frameRateGate.reset()
            h264Encoder.invalidate()
            releaseConversionPool()
            nextFrameId = 0
        }
    }

    override func processSampleBuffer(
        _ sampleBuffer: CMSampleBuffer,
        with sampleBufferType: RPSampleBufferType
    ) {
        guard
            sampleBufferType == .video,
            shouldProcessFrames()
        else { return }

        // Do not allow ReplayKit callbacks to queue up behind conversion or
        // VideoToolbox. A synchronous hop provides strict freshness semantics;
        // the callback itself is back-pressured instead of retaining old frames.
        pipelineQueue.sync {
            autoreleasepool {
                processVideoSampleBuffer(sampleBuffer)
            }
        }
    }

    // MARK: - Frame pipeline

    private func resetPipelineForStart() {
        stopDiagnostics()
        frameRateGate.reset()
        targetFrameRate = 30
        encoderProfile = .lowLatency
        encoderTuning = .default
        encoderTuningCommandRequestedRaw = nil
        encoderTuningCommandFallbackReason = nil
        nextFrameId = 0
        h264Encoder.invalidate()
        h264Encoder.setProfile(.lowLatency)
        h264Encoder.setTuning(.default)
        h264Encoder.setTargetFrameRate(targetFrameRate)
        h264Encoder.requestKeyframe()
        releaseConversionPool()
        diagnosticLock.withLock {
            diagnosticCounters = DiagnosticCounters()
        }
    }

    private func processVideoSampleBuffer(_ sampleBuffer: CMSampleBuffer) {
        guard shouldProcessFrames(), CMSampleBufferIsValid(sampleBuffer) else { return }

        let presentationTimestamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        // Test bounded downstream capacity before consuming a cadence deadline.
        // If either stage is busy, the next fresh ReplayKit callback can be
        // admitted as soon as capacity returns instead of waiting another full
        // target-frame interval.
        let transportReady = frameSocket.canAcceptOrderedFrame()
        let encoderReady = transportReady
            ? h264Encoder.canAcceptFrame()
            : false
        guard frameRateGate.accepts(
            timestampSeconds: CMTimeGetSeconds(presentationTimestamp),
            targetFramesPerSecond: targetFrameRate,
            downstreamReady: transportReady && encoderReady
        ) else {
            diagnosticLock.withLock {
                if !transportReady {
                    diagnosticCounters.rejected += 1
                    diagnosticCounters.transportDrops += 1
                } else if !encoderReady {
                    diagnosticCounters.rejected += 1
                    diagnosticCounters.encoderDrops += 1
                } else {
                    diagnosticCounters.cadenceDrops += 1
                }
            }
            return
        }

        recordCapturedFrame(presentationTimestamp: presentationTimestamp)

        let callbackAtMs = LiveProtocol.timestampMs()
        let captureTimestamp = estimatedCaptureTimestamp(
            presentationTimestamp: presentationTimestamp,
            callbackAtMs: callbackAtMs
        )
        guard let sourcePixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            diagnosticLock.withLock {
                diagnosticCounters.rejected += 1
                diagnosticCounters.conversionFailures += 1
            }
            return
        }

        let frameOrientation = imageOrientation(from: sampleBuffer)
        let inputWidth = CVPixelBufferGetWidth(sourcePixelBuffer)
        let inputHeight = CVPixelBufferGetHeight(sourcePixelBuffer)
        let inputPixelFormat = CVPixelBufferGetPixelFormatType(sourcePixelBuffer)
        let directOutputDimensions = h264OutputDimensions(
            width: inputWidth,
            height: inputHeight
        )
        let canEncodeDirectly = (
            frameOrientation == nil || frameOrientation == .up
        ) && inputWidth == directOutputDimensions.width
            && inputHeight == directOutputDimensions.height
            && supportsDirectH264Input(pixelFormat: inputPixelFormat)

        diagnosticLock.withLock {
            diagnosticCounters.inputPixelFormat = inputPixelFormat
        }

        if canEncodeDirectly {
            nextFrameId += 1
            let frameId = nextFrameId
            let outputOrientation =
                directOutputDimensions.height >= directOutputDimensions.width
                ? "portrait"
                : "landscape"
            let timing = H264FrameTiming(
                frameId: frameId,
                captureAtMs: captureTimestamp.timestampMs,
                callbackAtMs: callbackAtMs,
                // H264Encoder replaces this immediately before the
                // VideoToolbox submission.
                encodeStartedAtMs: 0,
                width: directOutputDimensions.width,
                height: directOutputDimensions.height,
                orientation: outputOrientation,
                captureTimestampSource: captureTimestamp.source,
                captureTimestampValid: captureTimestamp.isValid,
                captureSampleAgeMs: captureTimestamp.sampleAgeMs,
                captureContentStatus: "complete",
                freshContent: true,
                captureStreamGeneration: captureStreamGeneration,
                h264PipelineEpoch: h264PipelineEpoch,
                sourcePresentationSeconds: CMTimeGetSeconds(presentationTimestamp)
            )
            let submitted = h264Encoder.encode(
                pixelBuffer: sourcePixelBuffer,
                timing: timing
            )
            diagnosticLock.withLock {
                if submitted {
                    diagnosticCounters.submitted += 1
                    diagnosticCounters.directFrames += 1
                } else {
                    diagnosticCounters.rejected += 1
                    diagnosticCounters.encoderDrops += 1
                }
            }
            return
        }

        // The common ReplayKit path above is already an encoder-compatible
        // NV12 surface at the desired dimensions. Construct Core Image state
        // only for the uncommon rotation, scaling, or pixel-format fallback.
        var image = CIImage(cvPixelBuffer: sourcePixelBuffer)
        if let frameOrientation {
            image = image.oriented(frameOrientation)
        }
        let extent = image.extent.integral
        guard extent.width > 0, extent.height > 0 else {
            diagnosticLock.withLock {
                diagnosticCounters.rejected += 1
                diagnosticCounters.conversionFailures += 1
            }
            return
        }

        let outputDimensions = h264OutputDimensions(
            width: Int(extent.width),
            height: Int(extent.height)
        )
        nextFrameId += 1
        let frameId = nextFrameId
        let outputOrientation = outputDimensions.height >= outputDimensions.width
            ? "portrait"
            : "landscape"

        let conversionStartedAtMs = LiveProtocol.timestampMs()
        let conversionStartedAtUptime = ProcessInfo.processInfo.systemUptime
        guard let outputPixelBuffer = h264PixelBuffer(
            image: image,
            extent: extent,
            width: outputDimensions.width,
            height: outputDimensions.height
        ) else {
            diagnosticLock.withLock {
                diagnosticCounters.rejected += 1
                diagnosticCounters.conversionFailures += 1
            }
            return
        }
        let conversionEndedAtMs = LiveProtocol.timestampMs()
        let conversionMs = max(
            0,
            (ProcessInfo.processInfo.systemUptime - conversionStartedAtUptime) * 1_000
        )
        let timing = H264FrameTiming(
            frameId: frameId,
            captureAtMs: captureTimestamp.timestampMs,
            callbackAtMs: callbackAtMs,
            // H264Encoder replaces this immediately before the
            // VideoToolbox submission.
            encodeStartedAtMs: 0,
            width: outputDimensions.width,
            height: outputDimensions.height,
            orientation: outputOrientation,
            captureTimestampSource: captureTimestamp.source,
            captureTimestampValid: captureTimestamp.isValid,
            captureSampleAgeMs: captureTimestamp.sampleAgeMs,
            captureContentStatus: "complete",
            freshContent: true,
            captureStreamGeneration: captureStreamGeneration,
            h264PipelineEpoch: h264PipelineEpoch,
            conversionStartedAtMs: conversionStartedAtMs,
            conversionEndedAtMs: conversionEndedAtMs,
            sourcePresentationSeconds: CMTimeGetSeconds(presentationTimestamp)
        )
        let submitted = h264Encoder.encode(
            pixelBuffer: outputPixelBuffer,
            timing: timing
        )
        diagnosticLock.withLock {
            if submitted {
                diagnosticCounters.submitted += 1
                diagnosticCounters.convertedFrames += 1
                diagnosticCounters.conversionTotalMs += conversionMs
                diagnosticCounters.conversionSamples += 1
                diagnosticCounters.conversionMaxMs = max(
                    diagnosticCounters.conversionMaxMs,
                    conversionMs
                )
            } else {
                diagnosticCounters.rejected += 1
                diagnosticCounters.encoderDrops += 1
            }
        }
    }

    private func sendH264Frame(
        data: Data,
        timing: H264FrameTiming,
        isKeyframe: Bool,
        decoderCodec: String?,
        bitstreamFormat: H264Encoder.BitstreamFormat,
        decoderDescription: Data?
    ) -> Bool {
        let encodedAtMs = LiveProtocol.timestampMs()
        let clock = poseSocket.clockEstimate()
        let metadata = FrameMetadataMessage(
            producerSessionId: producerSessionId,
            captureSource: captureSource,
            frameId: timing.frameId,
            timestampMs: timing.captureAtMs,
            captureAtMs: timing.captureAtMs,
            callbackAtMs: timing.callbackAtMs,
            encodeStartedAtMs: timing.encodeStartedAtMs,
            encodedAtMs: encodedAtMs,
            width: timing.width,
            height: timing.height,
            orientation: timing.orientation,
            jpegBytes: data.count,
            codec: "h264",
            isKeyframe: isKeyframe,
            decoderCodec: decoderCodec,
            h264BitstreamFormat: bitstreamFormat.rawValue,
            decoderDescriptionBase64: decoderDescription?.base64EncodedString(),
            clockOffsetMs: clock?.offsetMs,
            clockRttMs: clock?.rttMs,
            captureTimestampSource: timing.captureTimestampSource,
            captureTimestampValid: timing.captureTimestampValid,
            captureSampleAgeMs: timing.captureSampleAgeMs,
            captureContentStatus: timing.captureContentStatus,
            freshContent: timing.freshContent,
            captureShortEdgeActive: min(timing.width, timing.height),
            captureWidthActive: timing.width,
            captureHeightActive: timing.height,
            captureStreamGeneration: timing.captureStreamGeneration,
            h264PipelineEpoch: timing.h264PipelineEpoch,
            conversionStartedAtMs: timing.conversionStartedAtMs,
            conversionEndedAtMs: timing.conversionEndedAtMs
        )
        guard let json = LiveProtocol.json(metadata) else { return false }
        let accepted = frameSocket.sendOrderedFrame(
            frameId: timing.frameId,
            metadata: json,
            encodedData: data,
            isKeyframe: isKeyframe
        )
        diagnosticLock.withLock {
            diagnosticCounters.encoded += 1
            diagnosticCounters.lastPayloadBytes = data.count
            if accepted {
                diagnosticCounters.accepted += 1
            } else {
                diagnosticCounters.rejected += 1
                diagnosticCounters.transportDrops += 1
            }
        }
        return accepted
    }

    private func h264PixelBuffer(
        image: CIImage,
        extent: CGRect,
        width: Int,
        height: Int
    ) -> CVPixelBuffer? {
        if h264PixelBufferPool == nil ||
            h264PixelBufferDimensions?.width != width ||
            h264PixelBufferDimensions?.height != height {
            releaseConversionPool()
            let attributes: [CFString: Any] = [
                kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA,
                kCVPixelBufferWidthKey: width,
                kCVPixelBufferHeightKey: height,
                kCVPixelBufferIOSurfacePropertiesKey: [:]
            ]
            var pool: CVPixelBufferPool?
            let status = CVPixelBufferPoolCreate(
                kCFAllocatorDefault,
                nil,
                attributes as CFDictionary,
                &pool
            )
            guard status == kCVReturnSuccess, let pool else { return nil }
            h264PixelBufferPool = pool
            h264PixelBufferDimensions = (width, height)
        }

        guard let pool = h264PixelBufferPool else { return nil }
        var pixelBuffer: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(
            kCFAllocatorDefault,
            pool,
            &pixelBuffer
        ) == kCVReturnSuccess,
            let pixelBuffer
        else { return nil }

        let translatedImage = image.transformed(
            by: CGAffineTransform(
                translationX: -extent.minX,
                y: -extent.minY
            )
        )
        let scaledImage = translatedImage.transformed(
            by: CGAffineTransform(
                scaleX: CGFloat(width) / extent.width,
                y: CGFloat(height) / extent.height
            )
        )
        imageContext.render(
            scaledImage,
            to: pixelBuffer,
            bounds: CGRect(x: 0, y: 0, width: width, height: height),
            colorSpace: colorSpace
        )
        return pixelBuffer
    }

    private func releaseConversionPool() {
        if let h264PixelBufferPool {
            CVPixelBufferPoolFlush(h264PixelBufferPool, .excessBuffers)
        }
        h264PixelBufferPool = nil
        h264PixelBufferDimensions = nil
    }

    private func supportsDirectH264Input(pixelFormat: OSType) -> Bool {
        switch pixelFormat {
        case kCVPixelFormatType_32BGRA,
             kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
             kCVPixelFormatType_420YpCbCr8BiPlanarFullRange:
            return true
        default:
            return false
        }
    }

    private func h264OutputDimensions(
        width: Int,
        height: Int
    ) -> (width: Int, height: Int) {
        let shortEdge = min(width, height)
        let scale = shortEdge > 960 ? 960.0 / Double(shortEdge) : 1

        func evenDimension(_ value: Int) -> Int {
            let scaled = max(2, Int((Double(value) * scale).rounded()))
            return scaled.isMultiple(of: 2) ? scaled : scaled + 1
        }

        return (evenDimension(width), evenDimension(height))
    }

    private func estimatedCaptureTimestamp(
        presentationTimestamp: CMTime,
        callbackAtMs: Int64
    ) -> CaptureTimestampEstimate {
        let hostTimestamp = CMClockGetTime(CMClockGetHostTimeClock())
        guard presentationTimestamp.isValid, hostTimestamp.isValid else {
            return CaptureTimestampEstimate(
                timestampMs: callbackAtMs,
                source: "callback-fallback",
                isValid: false,
                sampleAgeMs: nil
            )
        }

        let sampleAgeSeconds = CMTimeGetSeconds(
            CMTimeSubtract(hostTimestamp, presentationTimestamp)
        )
        let sampleAgeMs = sampleAgeSeconds.isFinite
            ? sampleAgeSeconds * 1_000
            : nil
        guard
            sampleAgeSeconds.isFinite,
            // ReplayKit on iOS 27 can deliver a sample whose presentation time
            // is marginally ahead of the host clock sampled in this callback.
            // Accept at most one 20 fps frame of lead, but tag it separately so
            // reports never silently mix it with ordinary capture timestamps.
            sampleAgeSeconds >= -0.05,
            sampleAgeSeconds <= 1
        else {
            return CaptureTimestampEstimate(
                timestampMs: callbackAtMs,
                source: "callback-fallback",
                isValid: false,
                sampleAgeMs: sampleAgeMs
            )
        }

        return CaptureTimestampEstimate(
            timestampMs: callbackAtMs - Int64((sampleAgeSeconds * 1_000).rounded()),
            source: sampleAgeSeconds < 0
                ? "replaykit-presentation-timestamp-future-tolerated"
                : "replaykit-presentation-timestamp",
            isValid: true,
            sampleAgeMs: sampleAgeMs
        )
    }

    private func imageOrientation(
        from sampleBuffer: CMSampleBuffer
    ) -> CGImagePropertyOrientation? {
        guard
            let value = CMGetAttachment(
                sampleBuffer,
                key: RPVideoSampleOrientationKey as CFString,
                attachmentModeOut: nil
            ) as? NSNumber
        else { return nil }

        return CGImagePropertyOrientation(rawValue: value.uint32Value)
    }

    private func recordCapturedFrame(presentationTimestamp: CMTime) {
        diagnosticLock.withLock {
            diagnosticCounters.captured += 1
            if diagnosticCounters.lastPresentationTimestamp.isValid {
                let intervalMs = CMTimeGetSeconds(
                    CMTimeSubtract(
                        presentationTimestamp,
                        diagnosticCounters.lastPresentationTimestamp
                    )
                ) * 1_000
                if intervalMs.isFinite, intervalMs >= 0 {
                    diagnosticCounters.presentationIntervalTotalMs += intervalMs
                    diagnosticCounters.presentationIntervalSamples += 1
                    diagnosticCounters.presentationIntervalMaxMs = max(
                        diagnosticCounters.presentationIntervalMaxMs,
                        intervalMs
                    )
                }
            }
            diagnosticCounters.lastPresentationTimestamp = presentationTimestamp
        }
    }

    // MARK: - Diagnostics

    private func startDiagnostics() {
        stopDiagnostics()
        let timer = DispatchSource.makeTimerSource(queue: pipelineQueue)
        timer.schedule(deadline: .now() + 1, repeating: 1, leeway: .milliseconds(50))
        timer.setEventHandler { [weak self] in
            self?.sendDiagnosticHeartbeat()
        }
        diagnosticTimer = timer
        timer.resume()
    }

    private func stopDiagnostics() {
        diagnosticTimer?.setEventHandler {}
        diagnosticTimer?.cancel()
        diagnosticTimer = nil
    }

    private func sendDiagnosticHeartbeat() {
        let encoderState = h264Encoder.diagnosticState()
        let transportState = frameSocket.frameTransportDiagnosticState()
        let counters = diagnosticLock.withLock { diagnosticCounters }
        let lifecycle = lifecycleLock.withLock { lifecycleState }
        var payload: [String: Any] = [
            "type": "encoder-status",
            "producerSessionId": producerSessionId,
            "captureSource": captureSource,
            "timestampMs": LiveProtocol.timestampMs(),
            "codec": ScreenCodec.h264.rawValue,
            "source": "replaykit-broadcast-upload",
            "captured": counters.captured,
            "submitted": counters.submitted,
            "encoded": counters.encoded,
            "accepted": counters.accepted,
            "rejected": counters.rejected,
            "cadenceDrops": counters.cadenceDrops,
            "transportDrops": counters.transportDrops,
            "encoderDrops": counters.encoderDrops,
            "conversionFailures": counters.conversionFailures,
            "lastPayloadBytes": counters.lastPayloadBytes,
            "encoderStatus": encoderState.status,
            "encoderResets": encoderState.resets,
            "encoderInFlight": encoderState.inFlight,
            "encoderBusyDrops": encoderState.busyDrops,
            "encoderProfileSelected": encoderState.selectedProfile,
            "encoderTuningRequested": encoderState.selectedTuning,
            "captureContentStatus": "complete",
            "freshContent": true,
            "captureStreamGeneration": captureStreamGeneration,
            "h264PipelineEpoch": h264PipelineEpoch,
            "thermalState": LiveProtocol.thermalStateValue(),
            "h264BitstreamFormatSelected": h264Encoder.bitstreamFormatDiagnosticValue(),
            "targetFps": targetFrameRate,
            "frameAwaitingAck": transportState.awaitingAck,
            "frameAckCount": transportState.ackCount,
            "frameAckTimeouts": transportState.ackTimeouts,
            "frameAckHardTimeouts": transportState.ackTimeouts,
            "frameAckSoftTimeouts": transportState.ackSoftTimeouts,
            "frameAckMaxMs": transportState.maxAckMs,
            "frameAckRtoMs": transportState.ackRtoMs,
            "frameAckArmedRtoMs": transportState.ackArmedRtoMs,
            "frameAckHardDeadlineMs": transportState.ackHardDeadlineMs,
            "frameAckRtoMinMs": transportState.ackRtoMinMs,
            "frameAckRtoMaxMs": transportState.ackRtoMaxMs,
            "frameAckHardMaxMs": transportState.ackHardMaxMs,
            "frameAckRtoBackoff": transportState.ackRtoBackoff,
            "frameAckLastWasKeyframe": transportState.lastFrameWasKeyframe,
            "frameAckLastPayloadBytes": transportState.lastFramePayloadBytes,
            "frameSendCompletionMaxMs": transportState.maxSendCompletionMs,
            "frameAckWindow": transportState.window,
            "captureState": lifecycle.isBroadcasting
                ? (lifecycle.isPaused ? "paused" : "streaming")
                : "idle",
            "frameSocket": frameSocket.state.rawValue,
            "frameSocketGeneration": transportState.connectionGeneration,
            "frameSocketConnectTimeouts": transportState.connectTimeouts,
            "frameSocketWaitingStates": transportState.waitingStates,
            "frameSocketRoutePreference": transportState.routePreference,
            "frameSocketRouteUsesWiredEthernet": transportState.routeUsesWiredEthernet,
            "frameSocketRouteUsesWiFi": transportState.routeUsesWiFi,
            "frameSocketWiredEthernetFallbacks": transportState.wiredEthernetFallbacks,
            "poseSocket": poseSocket.state.rawValue,
            "h264DirectFrames": counters.directFrames,
            "h264ConvertedFrames": counters.convertedFrames
        ]
        if let lastAckMs = transportState.lastAckMs {
            payload["frameAckLastMs"] = lastAckMs
        }
        if let smoothedMs = transportState.ackSmoothedMs {
            payload["frameAckSmoothedMs"] = smoothedMs
        }
        if let variationMs = transportState.ackVariationMs {
            payload["frameAckVariationMs"] = variationMs
        }
        if let sendCompletionMs = transportState.lastSendCompletionMs {
            payload["frameSendCompletionLastMs"] = sendCompletionMs
        }
        if let failureReason = transportState.lastFailureReason {
            payload["frameSocketLastFailure"] = failureReason
        }
        if let interfaces = transportState.routeInterfaces {
            payload["frameSocketRouteInterfaces"] = interfaces
        }
        if counters.inputPixelFormat != 0 {
            payload["h264InputPixelFormat"] = counters.inputPixelFormat
        }
        if counters.presentationIntervalSamples > 0 {
            payload["presentationIntervalAverageMs"] =
                counters.presentationIntervalTotalMs /
                    Double(counters.presentationIntervalSamples)
            payload["presentationIntervalMaxMs"] = counters.presentationIntervalMaxMs
        }
        if counters.conversionSamples > 0 {
            payload["conversionAverageMs"] =
                counters.conversionTotalMs / Double(counters.conversionSamples)
            payload["conversionMaxMs"] = counters.conversionMaxMs
        }
        if let activeProfile = encoderState.activeProfile {
            payload["encoderProfileActive"] = activeProfile
        }
        if let activeTuning = encoderState.activeTuning {
            payload["encoderTuningActive"] = activeTuning
        }
        if let status = encoderState.tuningPresetQueryStatus {
            payload["encoderTuningPresetQueryStatus"] = status
        }
        if let status = encoderState.tuningPresetApplyStatus {
            payload["encoderTuningPresetApplyStatus"] = status
        }
        if let supported = encoderState.tuningPresetSupported {
            payload["encoderTuningPresetSupported"] = supported
        }
        if let count = encoderState.tuningPresetPropertyCount {
            payload["encoderTuningPresetPropertyCount"] = count
        }
        if let reason = encoderState.tuningFallbackReason {
            payload["encoderTuningFallbackReason"] = reason
        } else if let reason = encoderTuningCommandFallbackReason {
            payload["encoderTuningFallbackReason"] = reason
        }
        if !encoderState.tuningEvents.isEmpty {
            payload["encoderTuningEvents"] = encoderState.tuningEvents
        }
        if let rawRequest = encoderTuningCommandRequestedRaw {
            payload["encoderTuningCommandRequestedRaw"] = rawRequest
        }
        if let status = encoderState.sessionCreateStatus {
            payload["encoderSessionCreateStatus"] = status
        }
        payload["encoderPropertyStatuses"] = encoderState.propertyStatuses
        if let status = encoderState.prepareStatus {
            payload["encoderPrepareStatus"] = status
        }
        if let status = encoderState.hardwareQueryStatus {
            payload["encoderHardwareQueryStatus"] = status
        }
        if let usingHardware = encoderState.usingHardwareEncoder {
            payload["encoderUsingHardware"] = usingHardware
        }
        if let codec = encoderState.rfc6381Codec {
            payload["encoderRFC6381Codec"] = codec
        }
        if let status = encoderState.maxFrameDelayZeroStatus {
            payload["maxFrameDelayZeroStatus"] = status
        }
        if let status = encoderState.maxFrameDelayFallbackStatus {
            payload["maxFrameDelayFallbackStatus"] = status
        }
        if let count = encoderState.effectiveMaxFrameDelayCount {
            payload["effectiveMaxFrameDelayCount"] = count
        }

        guard
            let data = try? JSONSerialization.data(withJSONObject: payload),
            let json = String(data: data, encoding: .utf8)
        else { return }
        // Do not share the pose coalescing slot: diagnostics are sparse control
        // messages and must survive the next 60-240 Hz motion update.
        poseSocket.sendControl(text: json)
    }

    // MARK: - Control and benchmark

    private func handlePoseControl(_ text: String) {
        guard
            let data = text.data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let type = object["type"] as? String
        else { return }

        if type == "frame-ack",
           let frameNumber = object["frameId"] as? NSNumber {
            frameSocket.acknowledgeFrame(frameId: frameNumber.int64Value)
            return
        }
        if type == "request-keyframe" {
            pipelineQueue.async { [weak self] in
                self?.h264Encoder.requestKeyframe()
            }
            return
        }
        if type == "h264-output-format",
           let command = try? JSONDecoder().decode(
               H264OutputFormatCommand.self,
               from: data
           ),
           let format = H264Encoder.BitstreamFormat(rawValue: command.format) {
            pipelineQueue.async { [weak self] in
                guard let self else { return }
                guard self.h264Encoder.bitstreamFormatDiagnosticValue() !=
                    format.rawValue else { return }
                self.h264Encoder.setBitstreamFormat(format)
                self.frameRateGate.reset()
            }
            return
        }
        if type == "pose-mode",
           let command = try? JSONDecoder().decode(PoseModeCommand.self, from: data) {
            motion.setPresentationMode(
                command.mode,
                requestedHz: command.requestedHz
            )
            return
        }
        if type == "benchmark-request",
           let command = try? JSONDecoder().decode(
               BenchmarkRequestCommand.self,
               from: data
           ) {
            benchmarkQueue.async { [weak self] in
                self?.startBenchmark(command)
            }
        }
    }

    private func startBenchmark(_ command: BenchmarkRequestCommand) {
        guard
            benchmarkRun == nil,
            pendingBenchmarkRun == nil,
            benchmarkStartWorkItem == nil,
            shouldProcessFrames()
        else { return }

        let currentConfiguration = pipelineQueue.sync {
            (
                targetFps: targetFrameRate,
                profile: encoderProfile,
                tuning: encoderTuning
            )
        }
        let appliedTargetFps = min(
            60,
            max(15, command.targetFps ?? currentConfiguration.targetFps)
        )
        let appliedProfile = command.encoderProfile.flatMap(
            H264Encoder.Profile.init(rawValue:)
        ) ?? currentConfiguration.profile
        let requestedTuningRaw = command.encoderTuning ?? "default"
        let parsedTuning = H264Encoder.Tuning(rawValue: requestedTuningRaw)
        let appliedTuning = parsedTuning ?? .default
        let tuningCommandFallbackReason = parsedTuning == nil
            ? "unsupported-tuning(\(requestedTuningRaw))"
            : nil
        let encoderConfigurationChanged =
            appliedProfile != currentConfiguration.profile ||
            appliedTuning != currentConfiguration.tuning
        pipelineQueue.sync {
            h264Encoder.setProfile(appliedProfile)
            h264Encoder.setTuning(appliedTuning)
            h264Encoder.setTargetFrameRate(appliedTargetFps)
            targetFrameRate = appliedTargetFps
            encoderProfile = appliedProfile
            encoderTuning = appliedTuning
            encoderTuningCommandRequestedRaw = parsedTuning == nil
                ? requestedTuningRaw
                : nil
            encoderTuningCommandFallbackReason = tuningCommandFallbackReason
            frameRateGate.reset()
            h264Encoder.requestKeyframe()
        }
        if encoderConfigurationChanged {
            networkQueue.async { [weak self] in
                guard
                    let self,
                    self.shouldRunConnections(),
                    let bridgeURL = self.bridgeURL
                else { return }
                // Throw away bytes buffered under the old encoder profile; the
                // pose/control WebSocket remains alive through the boundary.
                self.frameSocket.connect(to: bridgeURL)
            }
        }

        let durationMs = min(60_000, max(5_000, command.durationMs))
        let warmupMs = min(5_000, max(500, command.warmupMs ?? 2_000))
        let pendingRun = BenchmarkRun(
            id: command.runId,
            durationMs: durationMs,
            targetFps: appliedTargetFps,
            encoderProfile: appliedProfile.rawValue,
            encoderProfileActive: nil,
            encoderTuning: appliedTuning.rawValue,
            encoderTuningActive: nil
        )
        pendingBenchmarkRun = pendingRun
        let startWorkItem = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.benchmarkStartWorkItem = nil
            guard self.pendingBenchmarkRun?.id == pendingRun.id else { return }
            self.pendingBenchmarkRun = nil
            let activeConfiguration = self.activeEncoderConfiguration()
            let resolvedRun = activeConfiguration.map {
                self.run(pendingRun, withActiveEncoderConfiguration: $0)
            } ?? pendingRun
            guard
                self.shouldProcessFrames(),
                self.frameSocket.state == .connected,
                self.poseSocket.state == .connected,
                activeConfiguration != nil,
                self.benchmarkRun == nil
            else {
                self.sendBenchmarkEvent(run: resolvedRun, phase: "cancelled")
                return
            }

            self.benchmarkRun = resolvedRun
            self.sendBenchmarkEvent(run: resolvedRun, phase: "started")
            let endWorkItem = DispatchWorkItem { [weak self] in
                self?.finishBenchmark(result: "completed")
            }
            self.benchmarkEndWorkItem = endWorkItem
            self.benchmarkQueue.asyncAfter(
                deadline: .now() + Double(durationMs) / 1_000,
                execute: endWorkItem
            )
        }
        benchmarkStartWorkItem = startWorkItem
        benchmarkQueue.asyncAfter(
            deadline: .now() + Double(warmupMs) / 1_000,
            execute: startWorkItem
        )
    }

    private func finishBenchmark(result: String) {
        benchmarkStartWorkItem?.cancel()
        benchmarkStartWorkItem = nil
        benchmarkEndWorkItem?.cancel()
        benchmarkEndWorkItem = nil
        let activeRun = benchmarkRun
        benchmarkRun = nil
        let pendingRun = pendingBenchmarkRun
        pendingBenchmarkRun = nil
        if let activeRun {
            if result == "completed" {
                let activeConfiguration = activeEncoderConfiguration()
                guard BenchmarkEncoderConfigurationVerification
                    .completionIsVerified(
                        startedProfile: activeRun.encoderProfileActive,
                        startedTuning: activeRun.encoderTuningActive,
                        currentProfile: activeConfiguration?.profile,
                        currentTuning: activeConfiguration?.tuning
                    ) else {
                    sendBenchmarkEvent(run: activeRun, phase: "cancelled")
                    return
                }
                sendBenchmarkEvent(run: activeRun, phase: "completed")
            } else {
                sendBenchmarkEvent(run: activeRun, phase: result)
            }
        } else if let pendingRun {
            // A warmup has not published "started" yet, but it still needs a
            // terminal event so the controller can discard the pending run.
            sendBenchmarkEvent(
                run: pendingRun,
                phase: "cancelled"
            )
        }
    }

    private func sendBenchmarkEvent(run: BenchmarkRun, phase: String) {
        let event = BenchmarkEvent(run: run, phase: phase)
        if phase != "started" {
            // Keep the latest terminal state until a later pose connection can
            // replay it. Duplicate terminal events are idempotent in the
            // browser because it only finishes the matching active run.
            deferredTerminalBenchmarkEvent = event
        }
        sendBenchmarkEventIfConnected(event)
    }

    private func sendBenchmarkEventIfConnected(_ event: BenchmarkEvent) {
        guard poseSocket.state == .connected else { return }
        let run = event.run
        var payload: [String: Any] = [
            "type": "benchmark-status",
            "benchmarkProtocolVersion": 2,
            "producerSessionId": producerSessionId,
            "captureSource": captureSource,
            "runId": run.id,
            "phase": event.phase,
            "timestampMs": LiveProtocol.timestampMs(),
            "durationMs": run.durationMs,
            "targetFps": run.targetFps,
            "encoderProfile": run.encoderProfile,
            "encoderTuning": run.encoderTuning,
            "captureStreamGeneration": captureStreamGeneration,
            "h264PipelineEpoch": h264PipelineEpoch,
            "thermalState": LiveProtocol.thermalStateValue()
        ]
        if let activeProfile = run.encoderProfileActive {
            payload["encoderProfileActive"] = activeProfile
        }
        if let activeTuning = run.encoderTuningActive {
            payload["encoderTuningActive"] = activeTuning
        }
        guard
            let data = try? JSONSerialization.data(withJSONObject: payload),
            let json = String(data: data, encoding: .utf8)
        else { return }
        poseSocket.sendControl(text: json)
    }

    private func replayDeferredTerminalBenchmarkEvent() {
        guard let event = deferredTerminalBenchmarkEvent else { return }
        sendBenchmarkEventIfConnected(event)
    }

    private func activeEncoderConfiguration() -> (
        profile: String,
        tuning: String
    )? {
        pipelineQueue.sync {
            let state = h264Encoder.diagnosticState()
            guard
                let activeProfile = state.activeProfile,
                let activeTuning = state.activeTuning
            else { return nil }
            return (profile: activeProfile, tuning: activeTuning)
        }
    }

    private func run(
        _ run: BenchmarkRun,
        withActiveEncoderConfiguration activeConfiguration: (
            profile: String,
            tuning: String
        )
    ) -> BenchmarkRun {
        return BenchmarkRun(
            id: run.id,
            durationMs: run.durationMs,
            targetFps: run.targetFps,
            encoderProfile: run.encoderProfile,
            encoderProfileActive: activeConfiguration.profile,
            encoderTuning: run.encoderTuning,
            encoderTuningActive: activeConfiguration.tuning
        )
    }

    // MARK: - Network lifecycle

    private func connectBridgeServices(to bridgeURL: URL) {
        cancelReconnects()
        frameSocket.connect(to: bridgeURL)
        poseSocket.connect(to: poseBridgeURL(from: bridgeURL))
    }

    private func handleFrameSocketState(_ state: LowLatencyFrameSocket.State) {
        if state == .connected {
            frameReconnectAttempt = 0
            frameReconnectWorkItem?.cancel()
            frameReconnectWorkItem = nil
            pipelineQueue.async { [weak self] in
                self?.frameRateGate.reset()
                self?.h264Encoder.requestKeyframe()
            }
        } else if state == .failed, shouldRunConnections() {
            scheduleFrameSocketReconnect()
        }
    }

    private func handlePoseSocketState(_ state: LiveSocket.State) {
        if state == .connected {
            poseReconnectAttempt = 0
            poseReconnectWorkItem?.cancel()
            poseReconnectWorkItem = nil
            benchmarkQueue.async { [weak self] in
                self?.replayDeferredTerminalBenchmarkEvent()
            }
        } else if state == .failed, shouldRunConnections() {
            schedulePoseSocketReconnect()
        }
    }

    private func scheduleFrameSocketReconnect() {
        guard frameReconnectWorkItem == nil else { return }
        let delay = reconnectDelay(attempt: frameReconnectAttempt, base: 0.05)
        frameReconnectAttempt += 1
        let workItem = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.frameReconnectWorkItem = nil
            guard self.shouldRunConnections(), let bridgeURL = self.bridgeURL else { return }
            self.frameSocket.connect(to: bridgeURL)
        }
        frameReconnectWorkItem = workItem
        networkQueue.asyncAfter(deadline: .now() + delay, execute: workItem)
    }

    private func schedulePoseSocketReconnect() {
        guard poseReconnectWorkItem == nil else { return }
        let delay = reconnectDelay(attempt: poseReconnectAttempt, base: 0.1)
        poseReconnectAttempt += 1
        let workItem = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.poseReconnectWorkItem = nil
            guard self.shouldRunConnections(), let bridgeURL = self.bridgeURL else { return }
            self.poseSocket.connect(to: self.poseBridgeURL(from: bridgeURL))
        }
        poseReconnectWorkItem = workItem
        networkQueue.asyncAfter(deadline: .now() + delay, execute: workItem)
    }

    private func cancelReconnects() {
        frameReconnectWorkItem?.cancel()
        frameReconnectWorkItem = nil
        poseReconnectWorkItem?.cancel()
        poseReconnectWorkItem = nil
    }

    private func reconnectDelay(attempt: Int, base: TimeInterval) -> TimeInterval {
        let multiplier = pow(2.0, Double(min(5, max(0, attempt))))
        return min(2, base * multiplier)
    }

    private func poseBridgeURL(from bridgeURL: URL) -> URL {
        roleURL(from: bridgeURL, role: "phone-pose")
    }

    private func roleURL(from bridgeURL: URL, role: String) -> URL {
        guard var components = URLComponents(
            url: bridgeURL,
            resolvingAgainstBaseURL: false
        ) else { return bridgeURL }
        var queryItems = components.queryItems ?? []
        if let roleIndex = queryItems.firstIndex(where: { $0.name == "role" }) {
            queryItems[roleIndex] = URLQueryItem(name: "role", value: role)
        } else {
            queryItems.append(URLQueryItem(name: "role", value: role))
        }
        queryItems.removeAll {
            $0.name == "producerSessionId" || $0.name == "captureSource"
        }
        queryItems.append(
            URLQueryItem(name: "producerSessionId", value: producerSessionId)
        )
        queryItems.append(
            URLQueryItem(name: "captureSource", value: captureSource)
        )
        components.queryItems = queryItems
        return components.url ?? bridgeURL
    }

    // MARK: - Lifecycle predicates

    private func shouldProcessFrames() -> Bool {
        lifecycleLock.withLock {
            lifecycleState.isBroadcasting && !lifecycleState.isPaused
        }
    }

    private func shouldRunConnections() -> Bool {
        shouldProcessFrames()
    }
}

private enum BroadcastError: LocalizedError {
    case missingBridgeURL

    var errorDescription: String? {
        "The LiveBridgeURL setting is missing or invalid."
    }
}
