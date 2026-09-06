import Combine
import CoreMedia
import CoreImage
import ImageIO
import ScreenCaptureKit
import UIKit

final class ScreenCaptureController: NSObject, ObservableObject {
    struct BenchmarkRun: Identifiable, Equatable {
        let id: String
        let startedAt: Date
        let endsAt: Date
        let durationMs: Int
        let warmupMs: Int
        let targetFps: Int
        let encoderProfile: String
        let encoderProfileActive: String?
        let encoderTuning: String
        let encoderTuningActive: String?
        let requestedShortEdge: Int
        let activeShortEdge: Int?
        let activeWidth: Int?
        let activeHeight: Int?
        let streamGeneration: Int64
        let h264PipelineEpoch: UInt64?
    }

    private struct CaptureStreamIdentity: Equatable {
        let generation: Int64
        let requestedShortEdge: Int
        let configuredDimensions: CaptureOutputDimensions
    }

    private struct CaptureStreamObservation: Equatable {
        let generation: Int64
        var actualDimensions: CaptureOutputDimensions? = nil
        var encodedDimensions: CaptureOutputDimensions? = nil
        var encodedProfile: String? = nil
        var encodedTuning: String? = nil
        var encodedPipelineEpoch: UInt64? = nil
        var currentFrameFreshContent = false
        var lastVerifiedFreshFrameAtMs: Int64? = nil
    }

    private struct PendingBenchmarkContext {
        let run: BenchmarkRun
        var readiness: BenchmarkCaptureReadiness
        var readinessEpoch: UInt64
    }

    private struct BenchmarkEvent {
        let run: BenchmarkRun
        let phase: String
    }

    private struct CadenceSummary {
        let frameCount: Int
        let intervalCount: Int
        let averageIntervalMs: Double?
        let p95IntervalMs: Double?
        let maximumIntervalMs: Double?

        var framesPerSecond: Double? {
            guard let averageIntervalMs, averageIntervalMs > 0 else {
                return nil
            }
            return 1_000 / averageIntervalMs
        }
    }

    private struct CadenceWindow {
        let intervalCapacity: Int
        private var lastTimestampMs: Double?
        private var intervalsMs: [Double] = []
        private var nextWriteIndex = 0

        mutating func reset() {
            lastTimestampMs = nil
            intervalsMs.removeAll(keepingCapacity: true)
            nextWriteIndex = 0
        }

        @discardableResult
        mutating func record(timestampMs: Double) -> Bool {
            guard timestampMs.isFinite else { return false }
            guard let lastTimestampMs else {
                self.lastTimestampMs = timestampMs
                return true
            }

            let intervalMs = timestampMs - lastTimestampMs
            guard intervalMs.isFinite, intervalMs >= 0 else {
                reset()
                self.lastTimestampMs = timestampMs
                return false
            }

            self.lastTimestampMs = timestampMs
            if intervalsMs.count < intervalCapacity {
                intervalsMs.append(intervalMs)
            } else {
                intervalsMs[nextWriteIndex] = intervalMs
                nextWriteIndex = (nextWriteIndex + 1) % intervalCapacity
            }
            return true
        }

        func summary() -> CadenceSummary {
            guard !intervalsMs.isEmpty else {
                return CadenceSummary(
                    frameCount: lastTimestampMs == nil ? 0 : 1,
                    intervalCount: 0,
                    averageIntervalMs: nil,
                    p95IntervalMs: nil,
                    maximumIntervalMs: nil
                )
            }

            let average = intervalsMs.reduce(0, +) / Double(intervalsMs.count)
            let sorted = intervalsMs.sorted()
            let p95Index = min(
                sorted.count - 1,
                max(0, Int(ceil(Double(sorted.count) * 0.95)) - 1)
            )
            return CadenceSummary(
                frameCount: intervalsMs.count + 1,
                intervalCount: intervalsMs.count,
                averageIntervalMs: average,
                p95IntervalMs: sorted[p95Index],
                maximumIntervalMs: sorted.last
            )
        }
    }

    private struct SampleSummary {
        let sampleCount: Int
        let average: Double?
        let minimum: Double?
        let maximum: Double?
    }

    private struct SampleWindow {
        let capacity: Int
        private var samples: [Double] = []
        private var nextWriteIndex = 0

        mutating func reset() {
            samples.removeAll(keepingCapacity: true)
            nextWriteIndex = 0
        }

        mutating func record(_ value: Double) {
            guard value.isFinite else { return }
            if samples.count < capacity {
                samples.append(value)
            } else {
                samples[nextWriteIndex] = value
                nextWriteIndex = (nextWriteIndex + 1) % capacity
            }
        }

        func summary() -> SampleSummary {
            guard !samples.isEmpty else {
                return SampleSummary(
                    sampleCount: 0,
                    average: nil,
                    minimum: nil,
                    maximum: nil
                )
            }
            return SampleSummary(
                sampleCount: samples.count,
                average: samples.reduce(0, +) / Double(samples.count),
                minimum: samples.min(),
                maximum: samples.max()
            )
        }
    }

    private enum DisplayTimeStatus: String {
        case valid
        case missingOrUnsupported = "missing-or-unsupported"
        case invalid
    }

    private enum SCKFrameStatusKind: String {
        case complete
        case started
        case idle
        case blank
        case suspended
        case stopped
        case missing
        case unknown

        var shouldProcess: Bool {
            switch self {
            case .complete, .started, .missing, .unknown:
                return true
            case .idle, .blank, .suspended, .stopped:
                return false
            }
        }

        var isFreshVisual: Bool {
            switch self {
            case .complete, .started:
                return true
            case .idle, .blank, .suspended, .stopped, .missing, .unknown:
                return false
            }
        }

        static func classify(rawValue: Int?) -> Self {
            guard let rawValue else { return .missing }
            switch rawValue {
            case SCFrameStatus.complete.rawValue:
                return .complete
            case SCFrameStatus.idle.rawValue:
                return .idle
            case SCFrameStatus.blank.rawValue:
                return .blank
            case SCFrameStatus.suspended.rawValue:
                return .suspended
            case SCFrameStatus.started.rawValue:
                return .started
            case SCFrameStatus.stopped.rawValue:
                return .stopped
            default:
                // Future ScreenCaptureKit frame statuses must be retained until
                // their semantics are known; dropping them could hide new video.
                return .unknown
            }
        }
    }

    private struct SCKFrameStatusCounts {
        var complete: Int64 = 0
        var started: Int64 = 0
        var idle: Int64 = 0
        var blank: Int64 = 0
        var suspended: Int64 = 0
        var stopped: Int64 = 0
        var missing: Int64 = 0
        var unknown: Int64 = 0

        mutating func reset() {
            self = SCKFrameStatusCounts()
        }

        mutating func record(_ status: SCKFrameStatusKind) {
            switch status {
            case .complete:
                complete += 1
            case .started:
                started += 1
            case .idle:
                idle += 1
            case .blank:
                blank += 1
            case .suspended:
                suspended += 1
            case .stopped:
                stopped += 1
            case .missing:
                missing += 1
            case .unknown:
                unknown += 1
            }
        }

        var retained: Int64 {
            complete + started + missing + unknown
        }

        var dropped: Int64 {
            idle + blank + suspended + stopped
        }
    }

    private struct CaptureTimestampEstimate {
        let timestampMs: Int64
        let source: String
        let isValid: Bool
        let sampleAgeMs: Double?
        let displayTimeStatus: DisplayTimeStatus
    }

    private struct CadenceDiagnosticSnapshot {
        let generation: Int64
        let resetAtMs: Int64
        let rawCallback: CadenceSummary
        let rawPresentation: CadenceSummary
        let freshVisualCallback: CadenceSummary
        let freshVisualPresentation: CadenceSummary
        let gatedCallback: CadenceSummary
        let gatedPresentation: CadenceSummary
        let rawPresentationInvalidSamples: Int64
        let gatedPresentationInvalidSamples: Int64
        let displayTimeValidSamples: Int64
        let displayTimeMissingOrUnsupportedSamples: Int64
        let displayTimeInvalidSamples: Int64
        let presentationTimestampFallbackSamples: Int64
        let callbackFallbackSamples: Int64
        let captureSampleAge: SampleSummary
        let lastCaptureTimestampSource: String?
        let lastCaptureTimestampValid: Bool?
        let lastCaptureSampleAgeMs: Double?
        let lastDisplayTimeStatus: String?
        let frameStatusCounts: SCKFrameStatusCounts
        let lastFrameStatus: String
        let lastFrameFreshContent: Bool
    }

    enum CaptureState: Equatable {
        case idle
        case choosing
        case starting
        case streaming
        case failed(String)

        var label: String {
            switch self {
            case .idle:
                return "Ready"
            case .choosing:
                return "Choose Full Display in the system sheet"
            case .starting:
                return "Starting live capture..."
            case .streaming:
                return "Streaming screen and motion"
            case let .failed(message):
                return message
            }
        }

        var isActive: Bool {
            switch self {
            case .choosing, .starting, .streaming:
                return true
            case .idle, .failed:
                return false
            }
        }

        var diagnosticValue: String {
            switch self {
            case .idle:
                return "idle"
            case .choosing:
                return "choosing"
            case .starting:
                return "starting"
            case .streaming:
                return "streaming"
            case .failed:
                return "failed"
            }
        }
    }

    @Published private(set) var captureState: CaptureState = .idle
    @Published private(set) var socketState: LowLatencyFrameSocket.State = .idle
    @Published private(set) var poseSocketState: LiveSocket.State = .idle
    @Published private(set) var videoRouteDescription = "Waiting for connection"
    @Published private(set) var webRTCState: WebRTCStreamer.State = .idle
    @Published private(set) var benchmarkRun: BenchmarkRun?
    @Published private(set) var benchmarkStimulusRun: BenchmarkRun?
    @Published private(set) var transportPreparationID: String?
    @Published var streamCodec: ScreenCodec = .h264

    private let picker = SCContentSharingPicker.shared
    private let socket = LowLatencyFrameSocket()
    private let poseSocket = LiveSocket()
    private let webRTCStreamer = WebRTCStreamer()
    private let producerSessionId = UUID().uuidString.lowercased()
    private let captureSource = "screencapturekit-host"
    private lazy var motion = MotionStreamer(
        socket: poseSocket,
        producerSessionId: producerSessionId,
        captureSource: captureSource
    )
    private let captureQueue = DispatchQueue(
        label: "Phone3D.ScreenCapture",
        qos: .userInteractive
    )
    private let imageContext = CIContext(options: [.cacheIntermediates: false])
    private let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
    // ScreenCaptureKit on iOS does not expose minimumFrameInterval. Gate before
    // Core Image conversion so capture callbacks never build a stale queue.
    private var h264TargetFrameRate = 60
    // The naming is counter-intuitive, but repeated USB/SCK measurements on
    // the target phone show that legacy + speed-priority sustains 60 fps with
    // a materially lower interaction tail than low-latency rate control.
    private var h264EncoderProfile: H264Encoder.Profile = .legacy
    private var h264EncoderTuning: H264Encoder.Tuning = .speedPriority
    private var encoderTuningCommandRequestedRaw: String?
    private var encoderTuningCommandFallbackReason: String?
    private lazy var qualitySnapshot = H264QualitySnapshot { [weak self] result in
        guard let self else { return }
        var message = result
        message["type"] = "quality-snapshot-result"
        message["producerSessionId"] = self.producerSessionId
        message["captureSource"] = self.captureSource
        if let data = try? JSONSerialization.data(withJSONObject: message),
           let text = String(data: data, encoding: .utf8) {
            self.poseSocket.send(text: text)
        }
    }
    private lazy var h264Encoder: H264Encoder = {
        let encoder = H264Encoder(codecOutputHandler: {
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
        encoder.setProfile(h264EncoderProfile)
        encoder.setTuning(h264EncoderTuning)
        encoder.setTargetFrameRate(h264TargetFrameRate)
        return encoder
    }()

    private var activeStream: SCStream?
    private var activeFilter: SCContentFilter?
    private var installedStreamIdentity: CaptureStreamIdentity?
    private var nextStreamGeneration: Int64 = 0
    // These identities are captureQueue-owned. Replacing the dictionary is a
    // generation barrier: callbacks from every older SCStream become inert.
    private var streamOutputIdentities: [ObjectIdentifier: CaptureStreamIdentity] = [:]
    private var activeStreamOutputIdentity: CaptureStreamIdentity?
    private var activeStreamObservation: CaptureStreamObservation?
    private var benchmarkReadinessTargetGeneration: Int64?
    private var benchmarkReadinessTargetRunID: String?
    private var benchmarkReadinessNotificationSent = false
    private var benchmarkReadinessEpoch: UInt64 = 0
    private var frameReconnectWorkItem: DispatchWorkItem?
    private var poseReconnectWorkItem: DispatchWorkItem?
    private var webRTCReconnectWorkItem: DispatchWorkItem?
    private var diagnosticTimer: DispatchSourceTimer?
    private var benchmarkStartWorkItem: DispatchWorkItem?
    private var benchmarkEndWorkItem: DispatchWorkItem?
    private var benchmarkPendingTimeoutWorkItem: DispatchWorkItem?
    private var pendingBenchmarkContext: PendingBenchmarkContext?
    private var deferredTerminalBenchmarkEvent: BenchmarkEvent?
    private let benchmarkFreshFrameMaximumAgeMs: Int64 = 500
    private var frameRateGate = FrameRateGate()
    private var nextFrameId: Int64 = 0
    private var h264PixelBufferPool: CVPixelBufferPool?
    private var h264PixelBufferDimensions: (width: Int, height: Int)?
    private let h264DeliveryLock = NSLock()
    private var nextH264PipelineEpoch: UInt64 = 0
    private var currentH264PipelineEpoch: UInt64 = 0
    private var frameTransportConfigurationId: String?
    // Capture-queue snapshots, updated by SwiftUI's main-thread lifecycle.
    private var appForegroundForDiagnostics = false
    private var visibleBenchmarkStimulusID: String?
    private var activeH264DeliveryIdentity: H264PipelineIdentity?
    private let diagnosticLock = NSLock()
    private var capturedFrameCount: Int64 = 0
    private var submittedFrameCount: Int64 = 0
    private var encodedFrameCount: Int64 = 0
    private var acceptedFrameCount: Int64 = 0
    private var rejectedFrameCount: Int64 = 0
    private var lastEncodedPayloadBytes = 0
    private var encodedPayloadByteCount: Int64 = 0
    private var acceptedPayloadByteCount: Int64 = 0
    private var encodedKeyframeCount: Int64 = 0
    private let cadenceWindowIntervalCapacity = 120
    private var cadenceGeneration: Int64 = 0
    private var cadenceResetAtMs: Int64 = 0
    private var rawCallbackCadence = CadenceWindow(intervalCapacity: 120)
    private var rawPresentationCadence = CadenceWindow(intervalCapacity: 120)
    private var freshVisualCallbackCadence = CadenceWindow(intervalCapacity: 120)
    private var freshVisualPresentationCadence = CadenceWindow(intervalCapacity: 120)
    private var gatedCallbackCadence = CadenceWindow(intervalCapacity: 120)
    private var gatedPresentationCadence = CadenceWindow(intervalCapacity: 120)
    private var rawPresentationInvalidSamples: Int64 = 0
    private var gatedPresentationInvalidSamples: Int64 = 0
    private var displayTimeValidSamples: Int64 = 0
    private var displayTimeMissingOrUnsupportedSamples: Int64 = 0
    private var displayTimeInvalidSamples: Int64 = 0
    private var presentationTimestampFallbackSamples: Int64 = 0
    private var callbackFallbackSamples: Int64 = 0
    private var captureSampleAgeWindow = SampleWindow(capacity: 120)
    private var lastCaptureTimestampSource: String?
    private var lastCaptureTimestampValid: Bool?
    private var lastCaptureSampleAgeMs: Double?
    private var lastDisplayTimeStatus: String?
    private var sckFrameStatusCounts = SCKFrameStatusCounts()
    private var captureFreshnessState = CaptureFreshnessState()
    private var conversionTotalMs = 0.0
    private var conversionSamples: Int64 = 0
    private var conversionMaxMs = 0.0
    private var webRTCDirectFrameCount: Int64 = 0
    private var webRTCConvertedFrameCount: Int64 = 0
    private var h264DirectFrameCount: Int64 = 0
    private var h264ConvertedFrameCount: Int64 = 0
    private var h264LastInputPixelFormat: OSType = 0

    override init() {
        super.init()
        picker.add(self)

        var pickerConfiguration = picker.defaultConfiguration
        pickerConfiguration.showsMicrophoneControl = false
        picker.defaultConfiguration = pickerConfiguration

        socket.onStateChange = { [weak self] state in
            guard let self else { return }
            self.socketState = state
            if state != .connected { self.videoRouteDescription = "Waiting for connection" }
            if state != .connected {
                self.invalidatePendingBenchmarkReadinessForTransport()
                if self.benchmarkRun != nil {
                    self.finishBenchmark(result: "cancelled")
                }
            }
            if state == .connected {
                self.frameReconnectWorkItem?.cancel()
                self.frameReconnectWorkItem = nil
                self.captureQueue.async { [weak self] in
                    self?.h264Encoder.requestKeyframe()
                }
            } else if state == .failed, self.captureState.isActive {
                self.scheduleFrameSocketReconnect()
            }
        }
        socket.onKeyframeRequest = { [weak self] in
            self?.captureQueue.async { [weak self] in
                self?.h264Encoder.requestKeyframe()
            }
        }
        webRTCStreamer.onStateChange = { [weak self] state in
            guard let self else { return }
            if state == .connected {
                self.webRTCReconnectWorkItem?.cancel()
                self.webRTCReconnectWorkItem = nil
            }
            self.webRTCState = state
            if state == .failed, self.captureState.isActive {
                self.scheduleWebRTCReconnect()
            }
        }
        poseSocket.onStateChange = { [weak self] state in
            guard let self else { return }
            self.poseSocketState = state
            if state == .connected {
                self.socket.resetTraceDelivery()
                self.poseReconnectWorkItem?.cancel()
                self.poseReconnectWorkItem = nil
                self.replayDeferredTerminalBenchmarkEvent()
            }
            if state == .failed, self.captureState.isActive {
                self.finishBenchmark(result: "cancelled")
                self.schedulePoseSocketReconnect()
            }
        }
        poseSocket.onTextMessage = { [weak self] text in
            self?.handlePoseControl(text)
        }
    }

    deinit {
        picker.remove(self)
    }

    private func handlePoseControl(_ text: String) {
        guard
            let data = text.data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let type = object["type"] as? String
        else { return }

        if type == "frame-transport-trace-ack",
           let command = try? JSONDecoder().decode(FrameTransportTraceACKCommand.self, from: data),
           command.producerSessionId == producerSessionId {
            socket.acknowledgeTraceDelivery(through: command.throughRevision,
                generation: command.exportGeneration)
            return
        }

        if type == "frame-ack",
           let frameNumber = object["frameId"] as? NSNumber {
            socket.acknowledgeFrame(frameId: frameNumber.int64Value,
                bridge: object.compactMapValues { $0 as? Double })
            return
        }

        if type == "h264-output-format",
           let command = try? JSONDecoder().decode(
               H264OutputFormatCommand.self,
               from: data
           ),
           let format = H264Encoder.BitstreamFormat(rawValue: command.format) {
            captureQueue.async { [weak self] in
                guard let self else { return }
                // Browser heartbeats repeat the desired format so a newly
                // connected producer can self-heal. Repeating the already
                // active value must not advance the delivery epoch: the
                // encoder itself is idempotent, and a synthetic epoch change
                // would invalidate an otherwise stable benchmark.
                guard self.h264Encoder.bitstreamFormatDiagnosticValue() !=
                    format.rawValue else { return }
                self.advanceH264PipelineBoundary(
                    captureStreamGeneration:
                        self.activeStreamOutputIdentity?.generation
                )
                self.h264Encoder.setBitstreamFormat(format)
                self.frameRateGate.reset()
                self.resetCadenceDiagnostics()
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

        if type == "quality-snapshot-request",
           let command = try? JSONDecoder().decode(
               QualitySnapshotRequestCommand.self,
               from: data
           ), UUID(uuidString: command.runId) != nil {
            guard captureState == .streaming, streamCodec == .h264,
                  benchmarkRun == nil, pendingBenchmarkContext == nil,
                  benchmarkStartWorkItem == nil else { return }
            captureQueue.async { [weak self] in
                guard let self else { return }
                let requestedBitRate = command.averageBitRate ??
                    self.h264Encoder.averageBitRateDiagnosticValue()
                guard (1_000_000...20_000_000).contains(requestedBitRate) else {
                    return
                }
                if requestedBitRate !=
                    self.h264Encoder.averageBitRateDiagnosticValue() {
                    self.advanceH264PipelineBoundary(
                        captureStreamGeneration:
                            self.activeStreamOutputIdentity?.generation
                    )
                    _ = self.h264Encoder.setAverageBitRate(requestedBitRate)
                    self.frameRateGate.reset()
                    self.resetCadenceDiagnostics()
                }
                _ = self.qualitySnapshot.arm(
                    id: command.runId,
                    averageBitRate: requestedBitRate
                )
            }
            return
        }

        if type == "frame-transport-config",
           let command = try? JSONDecoder().decode(FrameTransportConfigurationCommand.self, from: data),
           UUID(uuidString: command.runId) != nil,
           (1...3).contains(command.window),
           captureState == .streaming,
           benchmarkRun == nil, pendingBenchmarkContext == nil,
           benchmarkStartWorkItem == nil,
           let url = bridgeURL() {
            // A static SCK source need not emit a new frame after reconnect.
            // Brief visible motion bootstraps source/receiver identity without
            // weakening the benchmark's fresh-frame readiness requirements.
            transportPreparationID = command.runId
            DispatchQueue.main.asyncAfter(deadline: .now() + 6) { [weak self] in
                guard self?.transportPreparationID == command.runId else { return }
                self?.transportPreparationID = nil
            }
            captureQueue.async { [weak self] in
                guard let self else { return }
                self.qualitySnapshot.cancel(reason: "transport-reconfiguration")
                self.advanceH264PipelineBoundary(
                    captureStreamGeneration: self.activeStreamOutputIdentity?.generation)
                self.h264Encoder.invalidate()
                _ = self.socket.configure(route: command.route, window: command.window)
                self.socket.connect(to: url)
                self.frameRateGate.reset()
                self.frameTransportConfigurationId = command.runId
            }
            return
        }

        if type == "benchmark-request",
           let command = try? JSONDecoder().decode(BenchmarkRequestCommand.self, from: data) {
            startBenchmark(
                runId: command.runId,
                durationMs: command.durationMs,
                targetFps: command.targetFps,
                encoderProfile: command.encoderProfile,
                encoderTuning: command.encoderTuning,
                warmupMs: command.warmupMs,
                captureShortEdge: command.captureShortEdge
            )
        }
    }

    func chooseFullDisplay() {
        guard picker.isAvailable else {
            captureState = .failed("Screen capture is unavailable on this device")
            return
        }
        guard let bridgeURL = bridgeURL() else {
            captureState = .failed("LiveBridgeURL is missing or invalid")
            return
        }

        connectBridgeServices(to: bridgeURL)
        motion.start()
        startDiagnostics()
        picker.isActive = true
        captureState = .choosing
        // Apple's iOS full-display capture flow uses the shared picker's
        // standard presentation. The user makes the final system-level choice.
        picker.present()
    }

    func stop() {
        transportPreparationID = nil
        finishBenchmark(result: "cancelled")
        frameReconnectWorkItem?.cancel()
        frameReconnectWorkItem = nil
        poseReconnectWorkItem?.cancel()
        poseReconnectWorkItem = nil
        webRTCReconnectWorkItem?.cancel()
        webRTCReconnectWorkItem = nil
        diagnosticTimer?.cancel()
        diagnosticTimer = nil
        picker.isActive = false
        motion.stop()
        socket.disconnect()
        poseSocket.disconnect()
        webRTCStreamer.disconnect()
        nextFrameId = 0
        captureQueue.async { [weak self] in
            guard let self else { return }
            self.streamOutputIdentities.removeAll(keepingCapacity: true)
            self.activeStreamOutputIdentity = nil
            self.activeStreamObservation = nil
            self.frameRateGate.reset()
            self.advanceH264PipelineBoundary(captureStreamGeneration: nil)
            self.h264Encoder.invalidate()
            self.h264PixelBufferPool = nil
            self.h264PixelBufferDimensions = nil
        }

        guard let stream = activeStream else {
            captureState = .idle
            return
        }
        activeStream = nil
        activeFilter = nil
        installedStreamIdentity = nil
        stream.stopCapture { [weak self] error in
            DispatchQueue.main.async {
                if let error {
                    self?.captureState = .failed("Stop failed: \(error.localizedDescription)")
                } else {
                    self?.captureState = .idle
                }
            }
        }
    }

    func updateAppForeground(_ active: Bool) {
        captureQueue.async { [weak self] in self?.appForegroundForDiagnostics = active }
        if !active { finishBenchmark(result: "cancelled") }
    }

    func updateBenchmarkStimulusVisibility(id: String, visible: Bool) {
        captureQueue.async { [weak self] in
            guard let self else { return }
            if visible { self.visibleBenchmarkStimulusID = id }
            else if self.visibleBenchmarkStimulusID == id { self.visibleBenchmarkStimulusID = nil }
        }
    }

    func startBenchmark(
        runId: String? = nil,
        durationMs: Int = 15_000,
        targetFps: Int? = nil,
        encoderProfile: String? = nil,
        encoderTuning: String? = nil,
        warmupMs: Int? = nil,
        captureShortEdge: Int? = nil
    ) {
        guard
            UIApplication.shared.applicationState == .active,
            captureState == .streaming,
            videoTransportConnected,
            streamCodec == .h264,
            benchmarkRun == nil,
            pendingBenchmarkContext == nil,
            benchmarkStartWorkItem == nil,
            let activeFilter,
            let currentStreamIdentity = installedStreamIdentity,
            let requestedShortEdge = BenchmarkCaptureConfiguration
                .resolvedShortEdge(captureShortEdge),
            let requestedDimensions = captureOutputDimensions(
                for: activeFilter,
                requestedShortEdge: requestedShortEdge
            ),
            requestedDimensions.shortEdge == requestedShortEdge
        else { return }

        transportPreparationID = nil
        let appliedTargetFps = min(120, max(15, targetFps ?? h264TargetFrameRate))
        let appliedEncoderProfile = encoderProfile.flatMap(
            H264Encoder.Profile.init(rawValue:)
        ) ?? h264EncoderProfile
        let requestedTuningRaw = encoderTuning ?? "default"
        let parsedEncoderTuning = H264Encoder.Tuning(rawValue: requestedTuningRaw)
        let appliedEncoderTuning = parsedEncoderTuning ?? .default
        let tuningCommandFallbackReason = parsedEncoderTuning == nil
            ? "unsupported-tuning(\(requestedTuningRaw))"
            : nil
        let encoderConfigurationChanged =
            appliedEncoderProfile != h264EncoderProfile ||
            appliedEncoderTuning != h264EncoderTuning
        let streamConfigurationChanged =
            currentStreamIdentity.requestedShortEdge != requestedShortEdge ||
            currentStreamIdentity.configuredDimensions != requestedDimensions
        let pipelineConfigurationChanged =
            appliedTargetFps != h264TargetFrameRate ||
            encoderConfigurationChanged ||
            streamConfigurationChanged

        let targetStreamIdentity: CaptureStreamIdentity
        if streamConfigurationChanged {
            targetStreamIdentity = nextCaptureStreamIdentity(
                requestedShortEdge: requestedShortEdge,
                dimensions: requestedDimensions
            )
        } else {
            targetStreamIdentity = currentStreamIdentity
        }
        let benchmarkId = runId ?? UUID().uuidString

        let readinessEpoch = captureQueue.sync { () -> UInt64 in
            benchmarkReadinessEpoch &+= 1
            benchmarkReadinessTargetGeneration = targetStreamIdentity.generation
            benchmarkReadinessTargetRunID = benchmarkId
            benchmarkReadinessNotificationSent = false
            encoderTuningCommandRequestedRaw = parsedEncoderTuning == nil
                ? requestedTuningRaw
                : nil
            encoderTuningCommandFallbackReason = tuningCommandFallbackReason
            if pipelineConfigurationChanged {
                // Change the delivery identity before invalidating any old
                // encoder session. This covers encoder-only reconfiguration as
                // well as capture geometry replacement.
                advanceH264PipelineBoundary(
                    captureStreamGeneration: targetStreamIdentity.generation
                )
            }
            if streamConfigurationChanged {
                h264Encoder.invalidate()
                h264PixelBufferPool = nil
                h264PixelBufferDimensions = nil
            }
            h264Encoder.setProfile(appliedEncoderProfile)
            h264Encoder.setTuning(appliedEncoderTuning)
            h264Encoder.setTargetFrameRate(appliedTargetFps)
            h264TargetFrameRate = appliedTargetFps
            h264EncoderProfile = appliedEncoderProfile
            h264EncoderTuning = appliedEncoderTuning
            if pipelineConfigurationChanged {
                frameRateGate.reset()
                resetCadenceDiagnostics()
                if !streamConfigurationChanged,
                   activeStreamObservation?.generation ==
                    targetStreamIdentity.generation {
                    activeStreamObservation?.encodedDimensions = nil
                    activeStreamObservation?.encodedProfile = nil
                    activeStreamObservation?.encodedTuning = nil
                    activeStreamObservation?.encodedPipelineEpoch = nil
                    activeStreamObservation?.lastVerifiedFreshFrameAtMs = nil
                }
            }
            h264Encoder.requestKeyframe()
            return benchmarkReadinessEpoch
        }

        let boundedDurationMs = min(60_000, max(5_000, durationMs))
        let boundedWarmupMs = min(5_000, max(500, warmupMs ?? 2_000))
        let pendingStartedAt = Date()
        let pendingRun = BenchmarkRun(
            id: benchmarkId,
            startedAt: pendingStartedAt,
            endsAt: pendingStartedAt.addingTimeInterval(
                Double(boundedWarmupMs + boundedDurationMs) / 1_000
            ),
            durationMs: boundedDurationMs,
            warmupMs: boundedWarmupMs,
            targetFps: h264TargetFrameRate,
            encoderProfile: h264EncoderProfile.rawValue,
            encoderProfileActive: nil,
            encoderTuning: h264EncoderTuning.rawValue,
            encoderTuningActive: nil,
            requestedShortEdge: requestedShortEdge,
            activeShortEdge: nil,
            activeWidth: nil,
            activeHeight: nil,
            streamGeneration: targetStreamIdentity.generation,
            h264PipelineEpoch: nil
        )
        pendingBenchmarkContext = PendingBenchmarkContext(
            run: pendingRun,
            readiness: BenchmarkCaptureReadiness(
                streamGeneration: targetStreamIdentity.generation,
                requestedShortEdge: requestedShortEdge,
                expectedDimensions: requestedDimensions
            ),
            readinessEpoch: readinessEpoch
        )
        // The deterministic 60 Hz stimulus begins before pipeline warmup.
        // Replacing this value with the measured run keeps the same id, so the
        // SwiftUI opacity transition cannot contaminate the measured window.
        benchmarkStimulusRun = pendingRun
        let pendingTimeoutWorkItem = DispatchWorkItem { [weak self] in
            guard
                let self,
                self.pendingBenchmarkContext?.run.id == benchmarkId
            else { return }
            self.benchmarkPendingTimeoutWorkItem = nil
            self.finishBenchmark(result: "cancelled")
        }
        benchmarkPendingTimeoutWorkItem = pendingTimeoutWorkItem
        DispatchQueue.main.asyncAfter(
            deadline: .now() + Double(
                BenchmarkCaptureConfiguration.pendingTimeoutMs(
                    warmupMs: boundedWarmupMs
                )
            ) / 1_000,
            execute: pendingTimeoutWorkItem
        )

        if pipelineConfigurationChanged, let bridgeURL = bridgeURL() {
            // Discard bytes buffered under the old encoder/capture boundary.
            // Benchmark control stays alive on the independent pose socket.
            socket.connect(to: bridgeURL)
        }
        if streamConfigurationChanged {
            installStream(
                with: activeFilter,
                identity: targetStreamIdentity
            )
        }
    }

    private func observeBenchmarkCaptureReadiness(
        identity: CaptureStreamIdentity,
        actualDimensions: CaptureOutputDimensions,
        freshContent: Bool,
        encoderReady: Bool
    ) {
        guard
            benchmarkReadinessTargetGeneration == identity.generation,
            let targetRunID = benchmarkReadinessTargetRunID,
            !benchmarkReadinessNotificationSent,
            actualDimensions == identity.configuredDimensions,
            freshContent,
            encoderReady
        else { return }
        benchmarkReadinessNotificationSent = true
        let readinessEpoch = benchmarkReadinessEpoch
        DispatchQueue.main.async { [weak self] in
            guard
                let self,
                var pending = self.pendingBenchmarkContext,
                pending.run.id == targetRunID,
                pending.run.streamGeneration == identity.generation,
                pending.readinessEpoch == readinessEpoch
            else { return }
            let becameReady = pending.readiness.observe(
                streamGeneration: identity.generation,
                actualDimensions: actualDimensions,
                freshContent: freshContent,
                encoderReady: encoderReady,
                observedAtMs: self.benchmarkMonotonicTimestampMs()
            )
            self.pendingBenchmarkContext = pending
            guard becameReady, self.benchmarkStartWorkItem == nil else { return }

            let runID = pending.run.id
            let workItem = DispatchWorkItem { [weak self] in
                self?.beginPendingBenchmark(runID: runID)
            }
            self.benchmarkStartWorkItem = workItem
            DispatchQueue.main.asyncAfter(
                deadline: .now() + Double(pending.run.warmupMs) / 1_000,
                execute: workItem
            )
        }
    }

    // Called on captureQueue whenever a previously-ready target pipeline stops
    // producing current, matching frames. The next qualifying output must earn
    // a new full warmup interval.
    private func invalidateBenchmarkCaptureReadiness(
        identity: CaptureStreamIdentity
    ) {
        guard
            benchmarkReadinessTargetGeneration == identity.generation,
            let runID = benchmarkReadinessTargetRunID
        else { return }
        let shouldNotifyMain = benchmarkReadinessNotificationSent
        benchmarkReadinessNotificationSent = false
        guard shouldNotifyMain else { return }
        benchmarkReadinessEpoch &+= 1
        let readinessEpoch = benchmarkReadinessEpoch
        DispatchQueue.main.async { [weak self] in
            self?.invalidatePendingBenchmarkReadiness(
                runID: runID,
                streamGeneration: identity.generation,
                readinessEpoch: readinessEpoch
            )
        }
    }

    private func invalidatePendingBenchmarkReadiness(
        runID: String,
        streamGeneration: Int64,
        readinessEpoch: UInt64
    ) {
        guard
            var pending = pendingBenchmarkContext,
            pending.run.id == runID,
            pending.run.streamGeneration == streamGeneration,
            readinessEpoch >= pending.readinessEpoch
        else { return }
        pending.readiness.invalidate()
        pending.readinessEpoch = readinessEpoch
        pendingBenchmarkContext = pending
        benchmarkStartWorkItem?.cancel()
        benchmarkStartWorkItem = nil
    }

    // Socket state callbacks arrive on main. Reset both halves of the
    // cross-queue readiness latch so a reconnect cannot reuse warmup earned by
    // the preceding transport generation.
    private func invalidatePendingBenchmarkReadinessForTransport() {
        guard let pending = pendingBenchmarkContext else { return }
        let readinessEpoch = captureQueue.sync { () -> UInt64? in
            guard
                benchmarkReadinessTargetGeneration ==
                    pending.run.streamGeneration,
                benchmarkReadinessTargetRunID == pending.run.id
            else { return nil }
            benchmarkReadinessEpoch &+= 1
            benchmarkReadinessNotificationSent = false
            return benchmarkReadinessEpoch
        }
        guard let readinessEpoch else {
            finishBenchmark(result: "cancelled")
            return
        }
        invalidatePendingBenchmarkReadiness(
            runID: pending.run.id,
            streamGeneration: pending.run.streamGeneration,
            readinessEpoch: readinessEpoch
        )
    }

    private func benchmarkMonotonicTimestampMs() -> Int64 {
        Int64(ProcessInfo.processInfo.systemUptime * 1_000)
    }

    private func beginPendingBenchmark(runID: String) {
        benchmarkStartWorkItem = nil
        guard
            let pending = pendingBenchmarkContext,
            pending.run.id == runID,
            pending.readiness.canStart(
                at: benchmarkMonotonicTimestampMs(),
                warmupMs: pending.run.warmupMs
            ),
            captureState == .streaming,
            videoTransportConnected,
            benchmarkRun == nil
        else {
            finishBenchmark(result: "cancelled")
            return
        }

        let active = captureQueue.sync { () -> (
            dimensions: CaptureOutputDimensions?,
            profile: String?,
            tuning: String?,
            pipelineEpoch: UInt64?,
            matches: Bool
        ) in
            let encoderState = h264Encoder.diagnosticState()
            let identity = activeStreamOutputIdentity
            let observation = activeStreamObservation
            let encoderReady =
                encoderState.activeProfile != nil &&
                encoderState.activeProfile == observation?.encodedProfile &&
                encoderState.activeTuning != nil &&
                encoderState.activeTuning == observation?.encodedTuning &&
                observation?.encodedPipelineEpoch ==
                    currentH264PipelineEpoch &&
                observation?.encodedDimensions ==
                    pending.readiness.expectedDimensions
            let matches = pending.readiness.stillMatches(
                streamGeneration: identity?.generation ?? -1,
                actualDimensions: observation?.actualDimensions,
                currentFrameFreshContent:
                    observation?.currentFrameFreshContent ?? false,
                lastVerifiedFreshFrameAtMs:
                    observation?.lastVerifiedFreshFrameAtMs,
                observedAtMs: benchmarkMonotonicTimestampMs(),
                maximumFreshFrameAgeMs: benchmarkFreshFrameMaximumAgeMs,
                encoderReady: encoderReady
            )
            if matches {
                // Warmup samples describe the target pipeline, but the
                // measured cadence window must start from a clean boundary.
                resetCadenceDiagnostics()
            } else {
                // A stale endpoint check must not consume the pending run. Wait
                // for the next verified output, then earn a new full warmup.
                benchmarkReadinessNotificationSent = false
            }
            return (
                observation?.actualDimensions,
                encoderState.activeProfile,
                encoderState.activeTuning,
                observation?.encodedPipelineEpoch,
                matches
            )
        }
        guard
            active.matches,
            let dimensions = active.dimensions,
            let activeProfile = active.profile,
            let activeTuning = active.tuning,
            let activePipelineEpoch = active.pipelineEpoch
        else {
            invalidatePendingBenchmarkReadiness(
                runID: pending.run.id,
                streamGeneration: pending.run.streamGeneration,
                readinessEpoch: pending.readinessEpoch
            )
            return
        }

        let durationSeconds = Double(pending.run.durationMs) / 1_000
        let measuredStartedAt = Date()
        let run = BenchmarkRun(
            id: pending.run.id,
            // Preserve the stimulus epoch so the Canvas does not jump back to
            // phase zero at the exact measured-window boundary.
            startedAt: pending.run.startedAt,
            endsAt: measuredStartedAt.addingTimeInterval(durationSeconds),
            durationMs: pending.run.durationMs,
            warmupMs: pending.run.warmupMs,
            targetFps: pending.run.targetFps,
            encoderProfile: pending.run.encoderProfile,
            encoderProfileActive: activeProfile,
            encoderTuning: pending.run.encoderTuning,
            encoderTuningActive: activeTuning,
            requestedShortEdge: pending.run.requestedShortEdge,
            activeShortEdge: dimensions.shortEdge,
            activeWidth: dimensions.width,
            activeHeight: dimensions.height,
            streamGeneration: pending.run.streamGeneration,
            h264PipelineEpoch: activePipelineEpoch
        )
        benchmarkPendingTimeoutWorkItem?.cancel()
        benchmarkPendingTimeoutWorkItem = nil
        pendingBenchmarkContext = nil
        benchmarkRun = run
        benchmarkStimulusRun = run
        sendBenchmarkEvent(run: run, phase: "started")

        let endWorkItem = DispatchWorkItem { [weak self] in
            self?.finishBenchmark(result: "completed")
        }
        benchmarkEndWorkItem = endWorkItem
        DispatchQueue.main.asyncAfter(
            deadline: .now() + durationSeconds,
            execute: endWorkItem
        )
    }

    func cancelBenchmark() {
        finishBenchmark(result: "cancelled")
    }

    private func finishBenchmark(result: String) {
        benchmarkPendingTimeoutWorkItem?.cancel()
        benchmarkPendingTimeoutWorkItem = nil
        benchmarkStartWorkItem?.cancel()
        benchmarkStartWorkItem = nil
        benchmarkEndWorkItem?.cancel()
        benchmarkEndWorkItem = nil
        let activeRun = benchmarkRun
        benchmarkRun = nil
        let pendingRun = pendingBenchmarkContext?.run
        pendingBenchmarkContext = nil
        benchmarkStimulusRun = nil
        captureQueue.async { [weak self] in
            guard let self else { return }
            self.benchmarkReadinessEpoch &+= 1
            self.benchmarkReadinessTargetGeneration = nil
            self.benchmarkReadinessTargetRunID = nil
            self.benchmarkReadinessNotificationSent = false
        }
        if let activeRun {
            if result == "completed" {
                let completionState = captureQueue.sync { () -> (
                    encoder: (
                        activeProfile: String?,
                        activeTuning: String?
                    ),
                    captureMatches: Bool
                ) in
                    let encoderState = h264Encoder.diagnosticState()
                    let observation = activeStreamObservation
                    let identity = activeStreamOutputIdentity
                    let nowMs = benchmarkMonotonicTimestampMs()
                    let lastVerifiedFreshFrameAtMs =
                        observation?.lastVerifiedFreshFrameAtMs
                    let hasCurrentFreshOutput =
                        observation?.currentFrameFreshContent == true &&
                        lastVerifiedFreshFrameAtMs != nil &&
                        nowMs >= lastVerifiedFreshFrameAtMs! &&
                        nowMs - lastVerifiedFreshFrameAtMs! <=
                            benchmarkFreshFrameMaximumAgeMs
                    let captureMatches =
                        identity?.generation == activeRun.streamGeneration &&
                        observation?.generation == activeRun.streamGeneration &&
                        observation?.actualDimensions == CaptureOutputDimensions(
                            width: activeRun.activeWidth ?? -1,
                            height: activeRun.activeHeight ?? -1
                        ) &&
                        observation?.encodedDimensions ==
                            CaptureOutputDimensions(
                                width: activeRun.activeWidth ?? -1,
                                height: activeRun.activeHeight ?? -1
                            ) &&
                        observation?.encodedPipelineEpoch ==
                            activeRun.h264PipelineEpoch &&
                        activeRun.h264PipelineEpoch ==
                            currentH264PipelineEpoch &&
                        hasCurrentFreshOutput
                    return (
                        (
                            encoderState.activeProfile,
                            encoderState.activeTuning
                        ),
                        captureMatches
                    )
                }
                guard BenchmarkEncoderConfigurationVerification
                    .completionIsVerified(
                        startedProfile: activeRun.encoderProfileActive,
                        startedTuning: activeRun.encoderTuningActive,
                        currentProfile: completionState.encoder.activeProfile,
                        currentTuning: completionState.encoder.activeTuning
                    ), completionState.captureMatches else {
                    sendBenchmarkEvent(run: activeRun, phase: "cancelled")
                    return
                }
                sendBenchmarkEvent(run: activeRun, phase: "completed")
            } else {
                sendBenchmarkEvent(run: activeRun, phase: result)
            }
        } else if let pendingRun {
            sendBenchmarkEvent(run: pendingRun, phase: "cancelled")
        }
    }

    private func sendBenchmarkEvent(run: BenchmarkRun, phase: String) {
        let event = BenchmarkEvent(run: run, phase: phase)
        if phase != "started" {
            // A transport failure is itself a cancellation reason. Retain the
            // terminal state until the independent pose socket reconnects.
            deferredTerminalBenchmarkEvent = event
        }
        sendBenchmarkEventIfConnected(event)
    }

    private func sendBenchmarkEventIfConnected(_ event: BenchmarkEvent) {
        guard poseSocket.state == .connected else { return }
        let run = event.run
        var payload: [String: Any] = [
            "type": "benchmark-status",
            // The new capture fields are additive so existing protocol-v2
            // receivers keep accepting legacy 960-only runs.
            "benchmarkProtocolVersion": 2,
            "producerSessionId": producerSessionId,
            "captureSource": captureSource,
            "runId": run.id,
            "phase": event.phase,
            "timestampMs": LiveProtocol.timestampMs(),
            "durationMs": run.durationMs,
            "warmupMs": run.warmupMs,
            "targetFps": run.targetFps,
            "encoderProfile": run.encoderProfile,
            "encoderTuning": run.encoderTuning,
            "captureShortEdgeRequested": run.requestedShortEdge,
            "captureStreamGeneration": run.streamGeneration,
            "thermalState": LiveProtocol.thermalStateValue()
        ]
        if let activeProfile = run.encoderProfileActive {
            payload["encoderProfileActive"] = activeProfile
        }
        if let activeTuning = run.encoderTuningActive {
            payload["encoderTuningActive"] = activeTuning
        }
        if let activeShortEdge = run.activeShortEdge {
            payload["captureShortEdgeActive"] = activeShortEdge
        }
        if let activeWidth = run.activeWidth {
            payload["captureWidthActive"] = activeWidth
        }
        if let activeHeight = run.activeHeight {
            payload["captureHeightActive"] = activeHeight
        }
        if let h264PipelineEpoch = run.h264PipelineEpoch {
            payload["h264PipelineEpoch"] = h264PipelineEpoch
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

    private func bridgeURL() -> URL? {
        guard
            let value = Bundle.main.object(forInfoDictionaryKey: "LiveBridgeURL") as? String
        else { return nil }
        return URL(string: value)
    }

    private func poseBridgeURL(from bridgeURL: URL) -> URL {
        roleURL(from: bridgeURL, role: "phone-pose")
    }

    private func roleURL(from bridgeURL: URL, role: String) -> URL {
        guard var components = URLComponents(url: bridgeURL, resolvingAgainstBaseURL: false)
        else { return bridgeURL }
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

    private func scheduleFrameSocketReconnect() {
        guard frameReconnectWorkItem == nil else { return }
        let workItem = DispatchWorkItem { [weak self] in
            guard
                let self,
                self.captureState.isActive,
                let bridgeURL = self.bridgeURL()
            else { return }
            self.frameReconnectWorkItem = nil
            self.socket.connect(to: bridgeURL)
        }
        frameReconnectWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05, execute: workItem)
    }

    private func schedulePoseSocketReconnect() {
        guard poseReconnectWorkItem == nil else { return }
        let workItem = DispatchWorkItem { [weak self] in
            guard
                let self,
                self.captureState.isActive,
                let bridgeURL = self.bridgeURL()
            else { return }
            self.poseReconnectWorkItem = nil
            self.poseSocket.connect(to: self.poseBridgeURL(from: bridgeURL))
        }
        poseReconnectWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1, execute: workItem)
    }

    private func scheduleWebRTCReconnect() {
        guard webRTCReconnectWorkItem == nil else { return }
        let workItem = DispatchWorkItem { [weak self] in
            guard
                let self,
                self.captureState.isActive,
                self.streamCodec == .webrtc,
                let bridgeURL = self.bridgeURL()
            else { return }
            self.webRTCReconnectWorkItem = nil
            self.webRTCStreamer.connect(
                to: self.roleURL(from: bridgeURL, role: "phone-webrtc")
            )
        }
        webRTCReconnectWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25, execute: workItem)
    }

    private func connectBridgeServices(to bridgeURL: URL) {
        socket.connect(to: bridgeURL)
        poseSocket.connect(to: poseBridgeURL(from: bridgeURL))
        if streamCodec == .webrtc {
            webRTCStreamer.connect(
                to: roleURL(from: bridgeURL, role: "phone-webrtc")
            )
        }
    }

    private func resetCadenceDiagnostics() {
        diagnosticLock.withLock {
            resetCadenceDiagnosticsLocked(at: LiveProtocol.timestampMs())
        }
    }

    private func resetCadenceDiagnosticsLocked(at timestampMs: Int64) {
        cadenceGeneration += 1
        cadenceResetAtMs = timestampMs
        rawCallbackCadence.reset()
        rawPresentationCadence.reset()
        freshVisualCallbackCadence.reset()
        freshVisualPresentationCadence.reset()
        gatedCallbackCadence.reset()
        gatedPresentationCadence.reset()
        rawPresentationInvalidSamples = 0
        gatedPresentationInvalidSamples = 0
        displayTimeValidSamples = 0
        displayTimeMissingOrUnsupportedSamples = 0
        displayTimeInvalidSamples = 0
        presentationTimestampFallbackSamples = 0
        callbackFallbackSamples = 0
        captureSampleAgeWindow.reset()
        lastCaptureTimestampSource = nil
        lastCaptureTimestampValid = nil
        lastCaptureSampleAgeMs = nil
        lastDisplayTimeStatus = nil
        sckFrameStatusCounts.reset()
        captureFreshnessState.reset(for: .benchmarkCadenceWindow)
    }

    private func cadenceDiagnosticSnapshot() -> CadenceDiagnosticSnapshot {
        diagnosticLock.withLock {
            CadenceDiagnosticSnapshot(
                generation: cadenceGeneration,
                resetAtMs: cadenceResetAtMs,
                rawCallback: rawCallbackCadence.summary(),
                rawPresentation: rawPresentationCadence.summary(),
                freshVisualCallback: freshVisualCallbackCadence.summary(),
                freshVisualPresentation: freshVisualPresentationCadence.summary(),
                gatedCallback: gatedCallbackCadence.summary(),
                gatedPresentation: gatedPresentationCadence.summary(),
                rawPresentationInvalidSamples: rawPresentationInvalidSamples,
                gatedPresentationInvalidSamples: gatedPresentationInvalidSamples,
                displayTimeValidSamples: displayTimeValidSamples,
                displayTimeMissingOrUnsupportedSamples:
                    displayTimeMissingOrUnsupportedSamples,
                displayTimeInvalidSamples: displayTimeInvalidSamples,
                presentationTimestampFallbackSamples:
                    presentationTimestampFallbackSamples,
                callbackFallbackSamples: callbackFallbackSamples,
                captureSampleAge: captureSampleAgeWindow.summary(),
                lastCaptureTimestampSource: lastCaptureTimestampSource,
                lastCaptureTimestampValid: lastCaptureTimestampValid,
                lastCaptureSampleAgeMs: lastCaptureSampleAgeMs,
                lastDisplayTimeStatus: lastDisplayTimeStatus,
                frameStatusCounts: sckFrameStatusCounts,
                lastFrameStatus: captureFreshnessState.messageContentStatus,
                lastFrameFreshContent: captureFreshnessState.messageFreshContent
            )
        }
    }

    private func startDiagnostics() {
        diagnosticTimer?.cancel()
        diagnosticLock.withLock {
            captureFreshnessState.reset(for: .captureSession)
            capturedFrameCount = 0
            submittedFrameCount = 0
            encodedFrameCount = 0
            acceptedFrameCount = 0
            rejectedFrameCount = 0
            lastEncodedPayloadBytes = 0
            encodedPayloadByteCount = 0
            acceptedPayloadByteCount = 0
            encodedKeyframeCount = 0
            resetCadenceDiagnosticsLocked(at: LiveProtocol.timestampMs())
            conversionTotalMs = 0
            conversionSamples = 0
            conversionMaxMs = 0
            webRTCDirectFrameCount = 0
            webRTCConvertedFrameCount = 0
            h264DirectFrameCount = 0
            h264ConvertedFrameCount = 0
            h264LastInputPixelFormat = 0
        }

        let timer = DispatchSource.makeTimerSource(queue: captureQueue)
        timer.schedule(deadline: .now() + 1, repeating: 1)
        timer.setEventHandler { [weak self] in
            self?.sendDiagnosticHeartbeat()
        }
        diagnosticTimer = timer
        timer.resume()
    }

    private func sendDiagnosticHeartbeat() {
        let encoderState = h264Encoder.diagnosticState()
        let transportState = socket.frameTransportDiagnosticState()
        let routeLabel = socket.state != .connected ? "Waiting for connection" :
            transportState.routeUsesWiFi ? "Wi-Fi" :
            transportState.routeUsesWiredEthernet ? "USB / Ethernet" : "Unverified"
        DispatchQueue.main.async { [weak self] in
            if self?.videoRouteDescription != routeLabel { self?.videoRouteDescription = routeLabel }
        }
        let cadence = cadenceDiagnosticSnapshot()
        let streamIdentity = activeStreamOutputIdentity
        let streamObservation = activeStreamObservation
        let throughput = diagnosticLock.withLock {
            (encodedBytes: encodedPayloadByteCount,
             acceptedBytes: acceptedPayloadByteCount,
             keyframes: encodedKeyframeCount)
        }
        let counters = diagnosticLock.withLock {
            (
                capturedFrameCount,
                submittedFrameCount,
                encodedFrameCount,
                acceptedFrameCount,
                rejectedFrameCount,
                lastEncodedPayloadBytes,
                conversionTotalMs,
                conversionSamples,
                conversionMaxMs,
                webRTCDirectFrameCount,
                webRTCConvertedFrameCount,
                h264DirectFrameCount,
                h264ConvertedFrameCount,
                h264LastInputPixelFormat
            )
        }
        var payload: [String: Any] = [
            "type": "encoder-status",
            "producerSessionId": producerSessionId,
            "captureSource": captureSource,
            "source": "screencapturekit-host",
            "timestampMs": LiveProtocol.timestampMs(),
            "codec": streamCodec.rawValue,
            "captured": counters.0,
            "submitted": counters.1,
            "encoded": counters.2,
            "accepted": counters.3,
            "rejected": counters.4,
            "lastPayloadBytes": counters.5,
            "encoderStatus": encoderState.status,
            "encoderResets": encoderState.resets,
            "encoderInFlight": encoderState.inFlight,
            "encoderBusyDrops": encoderState.busyDrops,
            "encoderProfileSelected": encoderState.selectedProfile,
            "encoderTuningRequested": encoderState.selectedTuning,
            "h264BitstreamFormatSelected": h264Encoder.bitstreamFormatDiagnosticValue(),
            "targetFps": h264TargetFrameRate,
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
            "frameOutstandingCount": transportState.outstandingFrames,
            "frameOutstandingBytes": transportState.outstandingBytes,
            "frameWindowByteLimit": transportState.byteLimit,
            "frameOldestOutstandingAgeMs": transportState.oldestOutstandingAgeMs,
            "frameMaximumAdmissionAgeMs": transportState.maximumAdmissionAgeMs,
            "frameTransportConfigurationSupported": true,
            "captureState": captureState.diagnosticValue,
            "frameSocket": socket.state.rawValue,
            "frameSocketGeneration": transportState.connectionGeneration,
            "frameSocketConnectTimeouts": transportState.connectTimeouts,
            "frameSocketWaitingStates": transportState.waitingStates,
            "frameSocketRoutePreference": transportState.routePreference,
            "frameSocketRouteUsesWiredEthernet": transportState.routeUsesWiredEthernet,
            "frameSocketRouteUsesWiFi": transportState.routeUsesWiFi,
            "frameSocketWiredEthernetFallbacks": transportState.wiredEthernetFallbacks,
            "poseSocket": poseSocket.state.rawValue,
            "webRTC": webRTCState.rawValue,
            "h264PipelineEpoch": currentH264PipelineEpoch,
            "qualitySnapshotSupported": true,
            "encoderAverageBitRate": h264Encoder.averageBitRateDiagnosticValue(),
            "encoderMediaTimeline": "source-timestamps-v1",
            "encodedPayloadBytes": throughput.encodedBytes,
            "acceptedPayloadBytes": throughput.acceptedBytes,
            "encodedKeyframes": throughput.keyframes,
            "thermalState": LiveProtocol.thermalStateValue()
        ]
        payload["cadenceWindowIntervalCapacity"] = cadenceWindowIntervalCapacity
        payload["frameTransportTraceVersion"] = 2
        payload["frameTransportTraceThroughRevision"] = transportState.traceLatestRevision
        payload["frameTransportTraceAcknowledgedRevision"] = transportState.traceAcknowledgedRevision
        payload["frameTransportTraceDiscardedThroughRevision"] = transportState.traceDiscardedThroughRevision
        payload["frameTransportTraceExportGeneration"] = transportState.traceExportGeneration
        payload["appForeground"] = appForegroundForDiagnostics
        payload["benchmarkStimulusVisible"] = visibleBenchmarkStimulusID != nil
        if let visibleBenchmarkStimulusID { payload["benchmarkStimulusID"] = visibleBenchmarkStimulusID }
        if let data = try? JSONEncoder().encode(transportState.traceSamples),
           let samples = try? JSONSerialization.jsonObject(with: data) {
            payload["frameTransportTraceSamples"] = samples
        }
        if let frameTransportConfigurationId {
            payload["frameTransportConfigurationId"] = frameTransportConfigurationId
        }
        payload["cadenceGeneration"] = cadence.generation
        payload["cadenceResetAtMs"] = cadence.resetAtMs
        payload["rawPresentationInvalidSamplesSinceReset"] =
            cadence.rawPresentationInvalidSamples
        payload["gatedPresentationInvalidSamplesSinceReset"] =
            cadence.gatedPresentationInvalidSamples
        payload["displayTimeValidSamplesSinceReset"] =
            cadence.displayTimeValidSamples
        payload["displayTimeMissingOrUnsupportedSamplesSinceReset"] =
            cadence.displayTimeMissingOrUnsupportedSamples
        payload["displayTimeInvalidSamplesSinceReset"] =
            cadence.displayTimeInvalidSamples
        payload["presentationTimestampFallbackSamplesSinceReset"] =
            cadence.presentationTimestampFallbackSamples
        payload["callbackFallbackSamplesSinceReset"] =
            cadence.callbackFallbackSamples
        payload["captureTimestampValidSamplesSinceReset"] =
            cadence.displayTimeValidSamples +
                cadence.presentationTimestampFallbackSamples
        payload["captureTimestampInvalidSamplesSinceReset"] =
            cadence.callbackFallbackSamples
        payload["sckFrameStatusCompleteSinceReset"] =
            cadence.frameStatusCounts.complete
        payload["sckFrameStatusStartedSinceReset"] =
            cadence.frameStatusCounts.started
        payload["sckFrameStatusIdleSinceReset"] =
            cadence.frameStatusCounts.idle
        payload["sckFrameStatusBlankSinceReset"] =
            cadence.frameStatusCounts.blank
        payload["sckFrameStatusSuspendedSinceReset"] =
            cadence.frameStatusCounts.suspended
        payload["sckFrameStatusStoppedSinceReset"] =
            cadence.frameStatusCounts.stopped
        payload["sckFrameStatusMissingSinceReset"] =
            cadence.frameStatusCounts.missing
        payload["sckFrameStatusUnknownSinceReset"] =
            cadence.frameStatusCounts.unknown
        payload["sckFrameStatusRetainedSinceReset"] =
            cadence.frameStatusCounts.retained
        payload["sckFrameStatusDroppedSinceReset"] =
            cadence.frameStatusCounts.dropped
        let contentStatus = cadence.lastFrameStatus
        payload["sckFrameStatusLast"] = contentStatus
        payload["captureContentStatus"] = contentStatus
        payload["freshContent"] = cadence.lastFrameFreshContent
        if let streamIdentity {
            payload["captureStreamGeneration"] = streamIdentity.generation
            payload["captureShortEdgeRequested"] =
                streamIdentity.requestedShortEdge
            payload["captureWidthConfigured"] =
                streamIdentity.configuredDimensions.width
            payload["captureHeightConfigured"] =
                streamIdentity.configuredDimensions.height
        }
        if
            let streamObservation,
            streamObservation.generation == streamIdentity?.generation,
            let dimensions = streamObservation.actualDimensions
        {
            payload["captureShortEdgeActive"] = dimensions.shortEdge
            payload["captureWidthActive"] = dimensions.width
            payload["captureHeightActive"] = dimensions.height
            payload["captureStreamHasVerifiedFreshFrame"] =
                streamObservation.lastVerifiedFreshFrameAtMs != nil
            payload["captureStreamCurrentFrameFresh"] =
                streamObservation.currentFrameFreshContent
        }

        let cadenceSummaries: [(String, CadenceSummary)] = [
            ("rawCallback", cadence.rawCallback),
            ("rawPresentation", cadence.rawPresentation),
            ("freshVisualCallback", cadence.freshVisualCallback),
            ("freshVisualPresentation", cadence.freshVisualPresentation),
            ("gatedCallback", cadence.gatedCallback),
            ("gatedPresentation", cadence.gatedPresentation),
        ]
        for (prefix, summary) in cadenceSummaries {
            payload["\(prefix)WindowFrames"] = summary.frameCount
            payload["\(prefix)WindowIntervals"] = summary.intervalCount
            if let value = summary.averageIntervalMs {
                payload["\(prefix)IntervalAverageMs"] = value
            }
            if let value = summary.p95IntervalMs {
                payload["\(prefix)IntervalP95Ms"] = value
            }
            if let value = summary.maximumIntervalMs {
                payload["\(prefix)IntervalMaxMs"] = value
            }
            if let value = summary.framesPerSecond {
                payload["\(prefix)FramesPerSecond"] = value
            }
        }
        if let value = cadence.gatedPresentation.averageIntervalMs {
            // Backward-compatible keys now deliberately mean the current
            // post-gate rolling window, not the process-lifetime average.
            payload["presentationIntervalAverageMs"] = value
        }
        if let value = cadence.gatedPresentation.maximumIntervalMs {
            payload["presentationIntervalMaxMs"] = value
        }
        payload["captureSampleAgeWindowSamples"] = cadence.captureSampleAge.sampleCount
        if let value = cadence.captureSampleAge.average {
            payload["captureSampleAgeAverageMs"] = value
        }
        if let value = cadence.captureSampleAge.minimum {
            payload["captureSampleAgeMinMs"] = value
        }
        if let value = cadence.captureSampleAge.maximum {
            payload["captureSampleAgeMaxMs"] = value
        }
        if let value = cadence.lastCaptureTimestampSource {
            payload["captureTimestampSourceLast"] = value
        }
        if let value = cadence.lastCaptureTimestampValid {
            payload["captureTimestampValidLast"] = value
        }
        if let value = cadence.lastCaptureSampleAgeMs {
            payload["captureSampleAgeLastMs"] = value
        }
        if let value = cadence.lastDisplayTimeStatus {
            payload["displayTimeStatusLast"] = value
        }
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
        if counters.7 > 0 {
            payload["conversionAverageMs"] = counters.6 / Double(counters.7)
            payload["conversionMaxMs"] = counters.8
        }
        payload["webRTCDirectFrames"] = counters.9
        payload["webRTCConvertedFrames"] = counters.10
        payload["h264DirectFrames"] = counters.11
        payload["h264ConvertedFrames"] = counters.12
        if counters.13 != 0 {
            payload["h264InputPixelFormat"] = counters.13
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

        webRTCStreamer.readOutboundDiagnostics { [weak self] outbound in
            guard let self else { return }
            if !outbound.isEmpty {
                payload["webrtcOutbound"] = outbound
            }
            guard
                let data = try? JSONSerialization.data(withJSONObject: payload),
                let json = String(data: data, encoding: .utf8)
            else { return }
            // Diagnostics must not share the coalescing slot used by 60 Hz pose
            // samples, otherwise the next pose overwrites this heartbeat.
            self.poseSocket.sendControl(text: json)
        }
    }

    var videoTransportConnected: Bool {
        switch streamCodec {
        case .webrtc:
            return webRTCState == .connected
        case .h264, .jpeg:
            return socketState == .connected
        }
    }

    @discardableResult
    private func advanceH264PipelineBoundary(
        captureStreamGeneration: Int64?
    ) -> UInt64 {
        qualitySnapshot.cancel(reason: "capture-pipeline-changed")
        // Called on captureQueue before any operation that can invalidate or
        // replace a VideoToolbox session. A callback already past the encoder's
        // own generation check still has to cross this independent fence.
        nextH264PipelineEpoch &+= 1
        currentH264PipelineEpoch = nextH264PipelineEpoch
        h264DeliveryLock.withLock {
            activeH264DeliveryIdentity = captureStreamGeneration.map {
                H264PipelineIdentity(
                    captureStreamGeneration: $0,
                    pipelineEpoch: currentH264PipelineEpoch
                )
            }
        }
        return currentH264PipelineEpoch
    }

    private func captureOutputDimensions(
        for filter: SCContentFilter,
        requestedShortEdge: Int
    ) -> CaptureOutputDimensions? {
        let pixelScale = Double(filter.pointPixelScale)
        return BenchmarkCaptureConfiguration.outputDimensions(
            sourceWidth: Double(filter.contentRect.width) * pixelScale,
            sourceHeight: Double(filter.contentRect.height) * pixelScale,
            requestedShortEdge: requestedShortEdge
        )
    }

    private func nextCaptureStreamIdentity(
        requestedShortEdge: Int,
        dimensions: CaptureOutputDimensions
    ) -> CaptureStreamIdentity {
        nextStreamGeneration &+= 1
        return CaptureStreamIdentity(
            generation: nextStreamGeneration,
            requestedShortEdge: requestedShortEdge,
            configuredDimensions: dimensions
        )
    }

    private func startStream(with filter: SCContentFilter) {
        finishBenchmark(result: "cancelled")
        guard
            let dimensions = captureOutputDimensions(
                for: filter,
                requestedShortEdge:
                    BenchmarkCaptureConfiguration.defaultShortEdge
            ),
            dimensions.shortEdge ==
                BenchmarkCaptureConfiguration.defaultShortEdge
        else {
            captureState = .failed("Could not resolve capture output dimensions")
            return
        }
        let identity = nextCaptureStreamIdentity(
            requestedShortEdge:
                BenchmarkCaptureConfiguration.defaultShortEdge,
            dimensions: dimensions
        )
        installStream(
            with: filter,
            identity: identity
        )
    }

    private func installStream(
        with filter: SCContentFilter,
        identity: CaptureStreamIdentity
    ) {
        captureState = .starting

        let configuration = SCStreamConfiguration()
        configuration.capturesAudio = false
        // Width/height are the only video-output controls ScreenCaptureKit
        // currently exposes on iOS. Scaling at capture avoids feeding the
        // native 1206 x 2622 surface through our Core Image path first.
        configuration.width = identity.configuredDimensions.width
        configuration.height = identity.configuredDimensions.height
        configuration.captureDynamicRange = .SDR

        let stream = SCStream(
            filter: filter,
            configuration: configuration,
            delegate: self
        )

        do {
            try stream.addStreamOutput(
                self,
                type: .screen,
                sampleHandlerQueue: captureQueue
            )
        } catch {
            captureState = .failed("Could not read screen frames: \(error.localizedDescription)")
            finishBenchmark(result: "cancelled")
            return
        }

        let oldStream = activeStream
        let streamIdentifier = ObjectIdentifier(stream)
        captureQueue.sync {
            // Publish the new identity before capture starts. Any callback
            // queued by an older stream after this barrier has no mapping and
            // cannot touch cadence, VideoToolbox, or benchmark readiness.
            streamOutputIdentities = [streamIdentifier: identity]
            activeStreamOutputIdentity = identity
            activeStreamObservation = CaptureStreamObservation(
                generation: identity.generation
            )
            diagnosticLock.withLock {
                captureFreshnessState.reset(for: .captureSession)
            }
            frameRateGate.reset()
            resetCadenceDiagnostics()
            advanceH264PipelineBoundary(
                captureStreamGeneration: identity.generation
            )
            h264Encoder.invalidate()
            h264PixelBufferPool = nil
            h264PixelBufferDimensions = nil
            if streamCodec == .h264 {
                h264Encoder.setProfile(h264EncoderProfile)
                h264Encoder.setTuning(h264EncoderTuning)
                h264Encoder.setTargetFrameRate(h264TargetFrameRate)
                h264Encoder.requestKeyframe()
            }
        }

        activeFilter = filter
        installedStreamIdentity = identity
        activeStream = stream
        oldStream?.stopCapture(completionHandler: nil)
        stream.startCapture { [weak self, weak stream] error in
            DispatchQueue.main.async {
                guard let self, self.activeStream === stream else { return }
                if let error {
                    self.activeStream = nil
                    self.activeFilter = nil
                    self.installedStreamIdentity = nil
                    self.finishBenchmark(result: "cancelled")
                    self.captureQueue.async { [weak self] in
                        guard
                            let self,
                            self.activeStreamOutputIdentity?.generation ==
                                identity.generation
                        else { return }
                        self.streamOutputIdentities.removeAll(
                            keepingCapacity: true
                        )
                        self.activeStreamOutputIdentity = nil
                        self.activeStreamObservation = nil
                        self.advanceH264PipelineBoundary(
                            captureStreamGeneration: nil
                        )
                        self.h264Encoder.invalidate()
                    }
                    self.captureState = .failed("Capture failed: \(error.localizedDescription)")
                    self.motion.stop()
                    self.socket.disconnect()
                    self.poseSocket.disconnect()
                    self.webRTCStreamer.disconnect()
                } else {
                    self.captureState = .streaming
                }
            }
        }
    }

    private func processScreenFrame(
        _ sampleBuffer: CMSampleBuffer,
        identity: CaptureStreamIdentity
    ) {
        let attachments = frameAttachments(from: sampleBuffer)
        let frameStatus = sckFrameStatus(from: attachments)
        diagnosticLock.withLock {
            sckFrameStatusCounts.record(frameStatus)
            captureFreshnessState.record(
                contentStatus: frameStatus.rawValue,
                freshContent: frameStatus.isFreshVisual
            )
        }
        if activeStreamObservation?.generation == identity.generation {
            activeStreamObservation?.currentFrameFreshContent =
                frameStatus.isFreshVisual
        }
        if !frameStatus.isFreshVisual {
            invalidateBenchmarkCaptureReadiness(identity: identity)
        }
        if frameStatus == .started {
            // A newly started visual sequence is a decoder dependency
            // boundary. Make its first encoded picture independently usable.
            h264Encoder.requestKeyframe()
        }
        if frameStatus == .missing ||
            frameStatus == .unknown ||
            frameStatus == .suspended ||
            frameStatus == .stopped {
            DispatchQueue.main.async { [weak self] in
                self?.finishBenchmark(result: "cancelled")
            }
        }
        guard frameStatus.shouldProcess else { return }
        guard CMSampleBufferIsValid(sampleBuffer) else { return }
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            return
        }
        let actualDimensions = CaptureOutputDimensions(
            width: CVPixelBufferGetWidth(pixelBuffer),
            height: CVPixelBufferGetHeight(pixelBuffer)
        )
        if activeStreamObservation?.generation == identity.generation {
            activeStreamObservation?.actualDimensions = actualDimensions
        }
        if actualDimensions != identity.configuredDimensions {
            invalidateBenchmarkCaptureReadiness(identity: identity)
        }

        let timestamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let timestampSeconds = CMTimeGetSeconds(timestamp)
        let callbackHostTimestamp = CMClockGetTime(CMClockGetHostTimeClock())
        let callbackHostSeconds = CMTimeGetSeconds(callbackHostTimestamp)
        let callbackAtMs = LiveProtocol.timestampMs()
        let captureTimestamp = estimatedCaptureTimestamp(
            presentationTimestamp: timestamp,
            callbackHostTimestamp: callbackHostTimestamp,
            callbackAtMs: callbackAtMs,
            attachments: attachments
        )
        diagnosticLock.withLock {
            _ = rawCallbackCadence.record(
                timestampMs: callbackHostSeconds * 1_000
            )
            if !rawPresentationCadence.record(
                timestampMs: timestampSeconds * 1_000
            ) {
                rawPresentationInvalidSamples += 1
            }
            if frameStatus.isFreshVisual {
                _ = freshVisualCallbackCadence.record(
                    timestampMs: callbackHostSeconds * 1_000
                )
                _ = freshVisualPresentationCadence.record(
                    timestampMs: timestampSeconds * 1_000
                )
            }
            switch captureTimestamp.displayTimeStatus {
            case .valid:
                displayTimeValidSamples += 1
            case .missingOrUnsupported:
                displayTimeMissingOrUnsupportedSamples += 1
            case .invalid:
                displayTimeInvalidSamples += 1
            }
            switch captureTimestamp.source {
            case "screencapturekit-presentation-timestamp":
                presentationTimestampFallbackSamples += 1
            case "callback-fallback":
                callbackFallbackSamples += 1
            default:
                break
            }
            if let sampleAgeMs = captureTimestamp.sampleAgeMs {
                captureSampleAgeWindow.record(sampleAgeMs)
            }
            lastCaptureTimestampSource = captureTimestamp.source
            lastCaptureTimestampValid = captureTimestamp.isValid
            lastCaptureSampleAgeMs = captureTimestamp.sampleAgeMs
            lastDisplayTimeStatus = captureTimestamp.displayTimeStatus.rawValue
        }

        let targetFrameRate: Int
        switch streamCodec {
        case .webrtc:
            targetFrameRate = 30
        case .h264:
            targetFrameRate = h264TargetFrameRate
        case .jpeg:
            targetFrameRate = 15
        }
        let h264TransportReady: Bool
        let h264EncoderReady: Bool
        if streamCodec == .h264 {
            h264TransportReady = socket.canAcceptOrderedFrame()
            h264EncoderReady = h264TransportReady
                ? h264Encoder.canAcceptFrame()
                : false
        } else {
            // JPEG and WebRTC retain their cadence-only admission behavior.
            h264TransportReady = true
            h264EncoderReady = true
        }
        guard frameRateGate.accepts(
            timestampSeconds: timestampSeconds,
            targetFramesPerSecond: targetFrameRate,
            downstreamReady: h264TransportReady && h264EncoderReady
        ) else {
            if streamCodec == .h264 &&
                (!h264TransportReady || !h264EncoderReady) {
                diagnosticLock.withLock {
                    rejectedFrameCount += 1
                }
            }
            return
        }
        diagnosticLock.withLock {
            _ = gatedCallbackCadence.record(
                timestampMs: callbackHostSeconds * 1_000
            )
            if !gatedPresentationCadence.record(
                timestampMs: timestampSeconds * 1_000
            ) {
                gatedPresentationInvalidSamples += 1
            }
        }

        let frameOrientation = imageOrientation(from: attachments)
        nextFrameId += 1
        diagnosticLock.withLock {
            capturedFrameCount += 1
        }
        let encodeStartedAtMs = LiveProtocol.timestampMs()

        if streamCodec == .h264 {
            // Downstream capacity was reserved logically before the cadence
            // deadline above. Skipping an input frame preserves the H.264
            // reference chain; encoding and dropping it afterward would force
            // a large recovery keyframe.
            let rawWidth = CVPixelBufferGetWidth(pixelBuffer)
            let rawHeight = CVPixelBufferGetHeight(pixelBuffer)
            let directOutputDimensions = h264OutputDimensions(
                width: rawWidth,
                height: rawHeight
            )
            let inputPixelFormat = CVPixelBufferGetPixelFormatType(pixelBuffer)
            diagnosticLock.withLock {
                h264LastInputPixelFormat = inputPixelFormat
            }
            let canEncodeCaptureBufferDirectly = (
                frameOrientation == nil || frameOrientation == .up
            ) && rawWidth == directOutputDimensions.width
                && rawHeight == directOutputDimensions.height
                && supportsDirectH264Input(pixelFormat: inputPixelFormat)

            if canEncodeCaptureBufferDirectly {
                let timing = H264FrameTiming(
                    frameId: nextFrameId,
                    captureAtMs: captureTimestamp.timestampMs,
                    callbackAtMs: callbackAtMs,
                    encodeStartedAtMs: encodeStartedAtMs,
                    width: directOutputDimensions.width,
                    height: directOutputDimensions.height,
                    orientation: rawHeight >= rawWidth ? "portrait" : "landscape",
                    captureTimestampSource: captureTimestamp.source,
                    captureTimestampValid: captureTimestamp.isValid,
                    captureSampleAgeMs: captureTimestamp.sampleAgeMs,
                    captureContentStatus: frameStatus.rawValue,
                    freshContent: frameStatus.isFreshVisual,
                    captureStreamGeneration: identity.generation,
                    h264PipelineEpoch: currentH264PipelineEpoch,
                    sourcePresentationSeconds: timestampSeconds
                )
                if qualitySnapshot.observeInput(pixelBuffer, timing: timing) {
                    h264Encoder.requestKeyframe()
                }
                let submitted = h264Encoder.encode(
                    pixelBuffer: pixelBuffer,
                    timing: timing
                )
                diagnosticLock.withLock {
                    if submitted {
                        submittedFrameCount += 1
                        h264DirectFrameCount += 1
                    } else {
                        rejectedFrameCount += 1
                    }
                }
                return
            }

            var image = CIImage(cvPixelBuffer: pixelBuffer)
            if let orientation = frameOrientation {
                image = image.oriented(orientation)
            }
            let extent = image.extent.integral
            guard extent.width > 0, extent.height > 0 else { return }
            let width = Int(extent.width)
            let height = Int(extent.height)
            let orientation = height >= width ? "portrait" : "landscape"
            let outputDimensions = h264OutputDimensions(
                width: width,
                height: height
            )
            let conversionStartedAt = ProcessInfo.processInfo.systemUptime
            let conversionStartedAtMs = LiveProtocol.timestampMs()
            guard let outputPixelBuffer = h264PixelBuffer(
                image: image,
                extent: extent,
                width: outputDimensions.width,
                height: outputDimensions.height
            ) else { return }
            let conversionMs = (
                ProcessInfo.processInfo.systemUptime - conversionStartedAt
            ) * 1_000
            let conversionEndedAtMs = LiveProtocol.timestampMs()
            let timing = H264FrameTiming(
                frameId: nextFrameId,
                captureAtMs: captureTimestamp.timestampMs,
                callbackAtMs: callbackAtMs,
                encodeStartedAtMs: encodeStartedAtMs,
                width: outputDimensions.width,
                height: outputDimensions.height,
                orientation: orientation,
                captureTimestampSource: captureTimestamp.source,
                captureTimestampValid: captureTimestamp.isValid,
                captureSampleAgeMs: captureTimestamp.sampleAgeMs,
                captureContentStatus: frameStatus.rawValue,
                freshContent: frameStatus.isFreshVisual,
                captureStreamGeneration: identity.generation,
                h264PipelineEpoch: currentH264PipelineEpoch,
                conversionStartedAtMs: conversionStartedAtMs,
                conversionEndedAtMs: conversionEndedAtMs,
                sourcePresentationSeconds: timestampSeconds
            )
            if qualitySnapshot.observeInput(outputPixelBuffer, timing: timing) {
                h264Encoder.requestKeyframe()
            }
            let submitted = h264Encoder.encode(
                pixelBuffer: outputPixelBuffer,
                timing: timing
            )
            diagnosticLock.withLock {
                if submitted {
                    submittedFrameCount += 1
                    h264ConvertedFrameCount += 1
                    conversionTotalMs += conversionMs
                    conversionSamples += 1
                    conversionMaxMs = max(conversionMaxMs, conversionMs)
                } else {
                    rejectedFrameCount += 1
                }
            }
            return
        }

        var image = CIImage(cvPixelBuffer: pixelBuffer)
        if let orientation = frameOrientation {
            image = image.oriented(orientation)
        }
        let extent = image.extent.integral
        guard extent.width > 0, extent.height > 0 else { return }
        let width = Int(extent.width)
        let height = Int(extent.height)
        let orientation = height >= width ? "portrait" : "landscape"

        if streamCodec == .webrtc {
            let outputDimensions = h264OutputDimensions(
                width: width,
                height: height
            )
            // iOS 27 ScreenCaptureKit currently returns a surface that the
            // WebRTC H.264 VideoToolbox path silently drops when wrapped
            // directly. Keep the measured, compatible Core Image conversion
            // until iOS can request a supported capture pixel format.
            let conversionStartedAt = ProcessInfo.processInfo.systemUptime
            guard let outputPixelBuffer = h264PixelBuffer(
                image: image,
                extent: extent,
                width: outputDimensions.width,
                height: outputDimensions.height
            ) else { return }
            let conversionMs = (
                ProcessInfo.processInfo.systemUptime - conversionStartedAt
            ) * 1_000
            webRTCStreamer.push(
                pixelBuffer: outputPixelBuffer,
                timestamp: timestamp
            )
            diagnosticLock.withLock {
                submittedFrameCount += 1
                acceptedFrameCount += 1
                conversionTotalMs += conversionMs
                conversionSamples += 1
                conversionMaxMs = max(conversionMaxMs, conversionMs)
                webRTCConvertedFrameCount += 1
            }
            return
        }

        guard
            let jpeg = imageContext.jpegRepresentation(
                of: image,
                colorSpace: colorSpace,
                options: [
                    CIImageRepresentationOption(
                        rawValue: kCGImageDestinationLossyCompressionQuality as String
                    ): 0.72
                ]
            )
        else { return }
        let encodedAtMs = LiveProtocol.timestampMs()

        let clock = poseSocket.clockEstimate()
        let metadata = FrameMetadataMessage(
            producerSessionId: producerSessionId,
            captureSource: captureSource,
            frameId: nextFrameId,
            timestampMs: captureTimestamp.timestampMs,
            captureAtMs: captureTimestamp.timestampMs,
            callbackAtMs: callbackAtMs,
            encodeStartedAtMs: encodeStartedAtMs,
            encodedAtMs: encodedAtMs,
            width: width,
            height: height,
            orientation: orientation,
            jpegBytes: jpeg.count,
            codec: "jpeg",
            isKeyframe: nil,
            decoderCodec: nil,
            h264BitstreamFormat: nil,
            decoderDescriptionBase64: nil,
            clockOffsetMs: clock?.offsetMs,
            clockRttMs: clock?.rttMs,
            captureTimestampSource: captureTimestamp.source,
            captureTimestampValid: captureTimestamp.isValid,
            captureSampleAgeMs: captureTimestamp.sampleAgeMs,
            captureContentStatus: frameStatus.rawValue,
            freshContent: frameStatus.isFreshVisual,
            captureShortEdgeActive: min(width, height),
            captureWidthActive: width,
            captureHeightActive: height,
            captureStreamGeneration: identity.generation,
            h264PipelineEpoch: currentH264PipelineEpoch
        )
        guard let json = LiveProtocol.json(metadata) else { return }
        socket.sendFrame(metadata: json, jpegData: jpeg)
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
        let streamGeneration = timing.captureStreamGeneration
        let deliveryIdentity = H264PipelineIdentity(
            captureStreamGeneration: streamGeneration,
            pipelineEpoch: timing.h264PipelineEpoch
        )
        // The delivery generation changes before an old SCStream/encoder is
        // invalidated. Holding this small lock through transport admission makes
        // the generation check and enqueue one atomic boundary.
        let accepted = h264DeliveryLock.withLock {
            guard activeH264DeliveryIdentity == deliveryIdentity else {
                return false
            }
            return socket.sendOrderedFrame(
                frameId: timing.frameId,
                metadata: json,
                encodedData: data,
                isKeyframe: isKeyframe,
                clock: clock
            )
        }
        diagnosticLock.withLock {
            encodedFrameCount += 1
            lastEncodedPayloadBytes = data.count
            encodedPayloadByteCount += Int64(data.count)
            if isKeyframe { encodedKeyframeCount += 1 }
            if accepted {
                acceptedFrameCount += 1
                acceptedPayloadByteCount += Int64(data.count)
            } else {
                rejectedFrameCount += 1
            }
        }
        qualitySnapshot.observeOutput(data: data, timing: timing, isKeyframe: isKeyframe,
            format: bitstreamFormat.rawValue, description: decoderDescription,
            transportAccepted: accepted)
        if accepted {
            captureQueue.async { [weak self] in
                guard
                    let self,
                    let identity = self.activeStreamOutputIdentity,
                    identity.generation == streamGeneration,
                    self.activeStreamObservation?.generation == streamGeneration,
                    self.currentH264PipelineEpoch == timing.h264PipelineEpoch
                else { return }
                let encodedDimensions = CaptureOutputDimensions(
                    width: timing.width,
                    height: timing.height
                )
                self.activeStreamObservation?.encodedDimensions =
                    encodedDimensions

                let actualDimensions =
                    self.activeStreamObservation?.actualDimensions
                let currentFrameFreshContent =
                    self.activeStreamObservation?.currentFrameFreshContent ?? false
                let encoderState = self.h264Encoder.diagnosticState()
                let activeProfile = encoderState.activeProfile
                let activeTuning = encoderState.activeTuning
                let encoderReady =
                    activeProfile != nil &&
                    activeTuning != nil &&
                    encodedDimensions == identity.configuredDimensions
                guard
                    timing.freshContent,
                    currentFrameFreshContent,
                    actualDimensions == identity.configuredDimensions,
                    encoderReady
                else {
                    self.invalidateBenchmarkCaptureReadiness(identity: identity)
                    return
                }

                if
                    let previousProfile =
                        self.activeStreamObservation?.encodedProfile,
                    let previousTuning =
                        self.activeStreamObservation?.encodedTuning,
                    previousProfile != activeProfile ||
                        previousTuning != activeTuning
                {
                    // A runtime fallback is valid, but it defines a different
                    // measured pipeline. Pin it only after a new full warmup.
                    self.invalidateBenchmarkCaptureReadiness(identity: identity)
                }
                self.activeStreamObservation?.encodedProfile = activeProfile
                self.activeStreamObservation?.encodedTuning = activeTuning
                self.activeStreamObservation?.encodedPipelineEpoch =
                    timing.h264PipelineEpoch

                let verifiedAtMs = self.benchmarkMonotonicTimestampMs()
                if BenchmarkCaptureReadiness.freshnessContinuityIsBroken(
                    previousVerifiedAtMs:
                        self.activeStreamObservation?
                            .lastVerifiedFreshFrameAtMs,
                    nextVerifiedAtMs: verifiedAtMs,
                    maximumFreshFrameAgeMs:
                        self.benchmarkFreshFrameMaximumAgeMs
                ) {
                    // A recovered frame cannot make a prior warmup continuous.
                    // Clear the latch before recording this frame so it becomes
                    // the first observation of a new full warmup interval.
                    self.invalidateBenchmarkCaptureReadiness(identity: identity)
                }
                self.activeStreamObservation?.lastVerifiedFreshFrameAtMs =
                    verifiedAtMs
                self.observeBenchmarkCaptureReadiness(
                    identity: identity,
                    actualDimensions: identity.configuredDimensions,
                    freshContent: true,
                    encoderReady: true
                )
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
        guard shortEdge > 960 else { return (width, height) }
        let scale = 960.0 / Double(shortEdge)

        func evenDimension(_ value: Int) -> Int {
            let rounded = Int((Double(value) * scale).rounded())
            return rounded.isMultiple(of: 2) ? rounded : rounded + 1
        }

        return (evenDimension(width), evenDimension(height))
    }

    private func estimatedCaptureTimestamp(
        presentationTimestamp: CMTime,
        callbackHostTimestamp: CMTime,
        callbackAtMs: Int64,
        attachments: [SCStreamFrameInfo: Any]?
    ) -> CaptureTimestampEstimate {
        let displayTimeStatus: DisplayTimeStatus
        if let displayTime = attachments?[.displayTime] as? NSNumber {
            let rawDisplayTime = displayTime.doubleValue
            if
                rawDisplayTime.isFinite,
                rawDisplayTime > 0,
                rawDisplayTime <= Double(UInt64.max)
            {
                let displayHostTimestamp = CMClockMakeHostTimeFromSystemUnits(
                    displayTime.uint64Value
                )
                if let estimate = validCaptureTimestampEstimate(
                    eventHostTimestamp: displayHostTimestamp,
                    callbackHostTimestamp: callbackHostTimestamp,
                    callbackAtMs: callbackAtMs,
                    source: "screencapturekit-display-time",
                    displayTimeStatus: .valid
                ) {
                    return estimate
                }
            }
            displayTimeStatus = .invalid
        } else {
            displayTimeStatus = .missingOrUnsupported
        }

        if let estimate = validCaptureTimestampEstimate(
            eventHostTimestamp: presentationTimestamp,
            callbackHostTimestamp: callbackHostTimestamp,
            callbackAtMs: callbackAtMs,
            source: "screencapturekit-presentation-timestamp",
            displayTimeStatus: displayTimeStatus
        ) {
            return estimate
        }

        // The wall-clock callback remains useful for transport ordering but is
        // not a capture timestamp. Explicit validity prevents the browser from
        // treating fallback values as zero-age capture samples.
        return CaptureTimestampEstimate(
            timestampMs: callbackAtMs,
            source: "callback-fallback",
            isValid: false,
            sampleAgeMs: nil,
            displayTimeStatus: displayTimeStatus
        )
    }

    private func validCaptureTimestampEstimate(
        eventHostTimestamp: CMTime,
        callbackHostTimestamp: CMTime,
        callbackAtMs: Int64,
        source: String,
        displayTimeStatus: DisplayTimeStatus
    ) -> CaptureTimestampEstimate? {
        guard eventHostTimestamp.isValid, callbackHostTimestamp.isValid else {
            return nil
        }
        let sampleAgeSeconds = CMTimeGetSeconds(
            CMTimeSubtract(callbackHostTimestamp, eventHostTimestamp)
        )
        guard
            sampleAgeSeconds.isFinite,
            sampleAgeSeconds >= 0,
            sampleAgeSeconds <= 1
        else { return nil }

        let sampleAgeMs = sampleAgeSeconds * 1_000
        return CaptureTimestampEstimate(
            timestampMs: callbackAtMs - Int64(sampleAgeMs.rounded()),
            source: source,
            isValid: true,
            sampleAgeMs: sampleAgeMs,
            displayTimeStatus: displayTimeStatus
        )
    }

    private func frameAttachments(
        from sampleBuffer: CMSampleBuffer
    ) -> [SCStreamFrameInfo: Any]? {
        let attachments = CMSampleBufferGetSampleAttachmentsArray(
            sampleBuffer,
            createIfNecessary: false
        ) as? [[SCStreamFrameInfo: Any]]
        return attachments?.first
    }

    private func sckFrameStatus(
        from attachments: [SCStreamFrameInfo: Any]?
    ) -> SCKFrameStatusKind {
        let rawValue = (attachments?[.status] as? NSNumber)?.intValue
        return SCKFrameStatusKind.classify(rawValue: rawValue)
    }

    private func imageOrientation(
        from attachments: [SCStreamFrameInfo: Any]?
    ) -> CGImagePropertyOrientation? {
        guard let value = attachments?[.videoOrientation] as? NSNumber else {
            return nil
        }
        return CGImagePropertyOrientation(rawValue: value.uint32Value)
    }
}

extension ScreenCaptureController: SCContentSharingPickerObserver {
    func contentSharingPicker(
        _ picker: SCContentSharingPicker,
        didCancelFor stream: SCStream?
    ) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if self.activeStream == nil {
                self.motion.stop()
                self.socket.disconnect()
                self.poseSocket.disconnect()
                self.webRTCStreamer.disconnect()
                self.captureState = .idle
            }
        }
    }

    func contentSharingPicker(
        _ picker: SCContentSharingPicker,
        didUpdateWith filter: SCContentFilter,
        for stream: SCStream?
    ) {
        DispatchQueue.main.async { [weak self] in
            self?.startStream(with: filter)
        }
    }

    func contentSharingPickerStartDidFailWithError(_ error: Error) {
        DispatchQueue.main.async { [weak self] in
            self?.motion.stop()
            self?.socket.disconnect()
            self?.poseSocket.disconnect()
            self?.webRTCStreamer.disconnect()
            self?.captureState = .failed("Picker failed: \(error.localizedDescription)")
        }
    }
}

extension ScreenCaptureController: SCStreamOutput {
    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of outputType: SCStreamOutputType
    ) {
        guard outputType == .screen else { return }
        guard
            let identity = streamOutputIdentities[ObjectIdentifier(stream)],
            identity == activeStreamOutputIdentity
        else { return }
        processScreenFrame(sampleBuffer, identity: identity)
    }
}

extension ScreenCaptureController: SCStreamDelegate {
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        DispatchQueue.main.async { [weak self, weak stream] in
            guard let self, self.activeStream === stream else { return }
            let stoppedGeneration = self.installedStreamIdentity?.generation
            self.activeStream = nil
            self.activeFilter = nil
            self.installedStreamIdentity = nil
            self.finishBenchmark(result: "cancelled")
            self.captureQueue.async { [weak self] in
                guard
                    let self,
                    self.activeStreamOutputIdentity?.generation ==
                        stoppedGeneration
                else { return }
                self.streamOutputIdentities.removeAll(keepingCapacity: true)
                self.activeStreamOutputIdentity = nil
                self.activeStreamObservation = nil
                self.advanceH264PipelineBoundary(
                    captureStreamGeneration: nil
                )
                self.h264Encoder.invalidate()
            }
            self.motion.stop()
            self.socket.disconnect()
            self.poseSocket.disconnect()
            self.webRTCStreamer.disconnect()
            self.captureState = .failed("Capture stopped: \(error.localizedDescription)")
        }
    }
}
