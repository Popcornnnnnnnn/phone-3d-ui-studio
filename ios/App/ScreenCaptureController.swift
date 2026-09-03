import Combine
import CoreImage
import ImageIO
import ScreenCaptureKit

final class ScreenCaptureController: NSObject, ObservableObject {
    struct BenchmarkRun: Identifiable, Equatable {
        let id: String
        let startedAt: Date
        let endsAt: Date
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
    }

    @Published private(set) var captureState: CaptureState = .idle
    @Published private(set) var socketState: LiveSocket.State = .idle
    @Published private(set) var webRTCState: WebRTCStreamer.State = .idle
    @Published private(set) var benchmarkRun: BenchmarkRun?
    @Published var streamCodec: ScreenCodec = .webrtc

    private let picker = SCContentSharingPicker.shared
    private let socket = LiveSocket()
    private let poseSocket = LiveSocket()
    private let webRTCStreamer = WebRTCStreamer()
    private lazy var motion = MotionStreamer(socket: poseSocket)
    private let captureQueue = DispatchQueue(
        label: "Phone3D.ScreenCapture",
        qos: .userInteractive
    )
    private let imageContext = CIContext(options: [.cacheIntermediates: false])
    private let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
    // ScreenCaptureKit on iOS does not expose minimumFrameInterval. Gate before
    // Core Image conversion so the 60 Hz capture callback cannot make us
    // convert frames that WebRTC will immediately discard. A 1/32 s threshold
    // tolerates 30 fps timestamp rounding; RTCVideoSource remains the final
    // 30 fps limiter.
    private let legacyMinimumFrameInterval = CMTime(value: 1, timescale: 16)
    private let webRTCMinimumFrameInterval = CMTime(value: 1, timescale: 32)
    private lazy var h264Encoder = H264Encoder { [weak self] data, timing, isKeyframe in
        self?.sendH264Frame(
            data: data,
            timing: timing,
            isKeyframe: isKeyframe
        ) ?? false
    }

    private var activeStream: SCStream?
    private var frameReconnectWorkItem: DispatchWorkItem?
    private var diagnosticTimer: DispatchSourceTimer?
    private var benchmarkEndWorkItem: DispatchWorkItem?
    private var lastFrameTimestamp = CMTime.invalid
    private var nextFrameId: Int64 = 0
    private var h264PixelBufferPool: CVPixelBufferPool?
    private var h264PixelBufferDimensions: (width: Int, height: Int)?
    private let diagnosticLock = NSLock()
    private var capturedFrameCount: Int64 = 0
    private var submittedFrameCount: Int64 = 0
    private var encodedFrameCount: Int64 = 0
    private var acceptedFrameCount: Int64 = 0
    private var rejectedFrameCount: Int64 = 0
    private var lastEncodedPayloadBytes = 0
    private var lastPresentationTimestamp = CMTime.invalid
    private var presentationIntervalTotalMs = 0.0
    private var presentationIntervalSamples: Int64 = 0
    private var presentationIntervalMaxMs = 0.0
    private var conversionTotalMs = 0.0
    private var conversionSamples: Int64 = 0
    private var conversionMaxMs = 0.0
    private var webRTCDirectFrameCount: Int64 = 0
    private var webRTCConvertedFrameCount: Int64 = 0

    override init() {
        super.init()
        picker.add(self)

        var pickerConfiguration = picker.defaultConfiguration
        pickerConfiguration.showsMicrophoneControl = false
        picker.defaultConfiguration = pickerConfiguration

        socket.onStateChange = { [weak self] state in
            guard let self else { return }
            self.socketState = state
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
            self.webRTCState = state
            if state == .failed, self.captureState.isActive {
                self.scheduleFrameSocketReconnect()
            }
        }
        poseSocket.onStateChange = { [weak self] state in
            guard let self else { return }
            if state == .failed, self.captureState.isActive {
                self.scheduleFrameSocketReconnect()
            }
        }
    }

    deinit {
        picker.remove(self)
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
        picker.present()
    }

    func stop() {
        finishBenchmark(result: "cancelled")
        frameReconnectWorkItem?.cancel()
        frameReconnectWorkItem = nil
        diagnosticTimer?.cancel()
        diagnosticTimer = nil
        picker.isActive = false
        motion.stop()
        socket.disconnect()
        poseSocket.disconnect()
        webRTCStreamer.disconnect()
        lastFrameTimestamp = .invalid
        nextFrameId = 0
        captureQueue.async { [weak self] in
            self?.h264Encoder.invalidate()
            self?.h264PixelBufferPool = nil
            self?.h264PixelBufferDimensions = nil
        }

        guard let stream = activeStream else {
            captureState = .idle
            return
        }
        activeStream = nil
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

    func startBenchmark() {
        guard
            captureState == .streaming,
            webRTCState == .connected,
            benchmarkRun == nil
        else { return }

        let startedAt = Date()
        let run = BenchmarkRun(
            id: UUID().uuidString,
            startedAt: startedAt,
            endsAt: startedAt.addingTimeInterval(15)
        )
        benchmarkRun = run
        sendBenchmarkEvent(run: run, phase: "started")

        let workItem = DispatchWorkItem { [weak self] in
            self?.finishBenchmark(result: "completed")
        }
        benchmarkEndWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: workItem)
    }

    func cancelBenchmark() {
        finishBenchmark(result: "cancelled")
    }

    private func finishBenchmark(result: String) {
        benchmarkEndWorkItem?.cancel()
        benchmarkEndWorkItem = nil
        guard let run = benchmarkRun else { return }
        benchmarkRun = nil
        sendBenchmarkEvent(run: run, phase: result)
    }

    private func sendBenchmarkEvent(run: BenchmarkRun, phase: String) {
        let payload: [String: Any] = [
            "type": "benchmark-status",
            "runId": run.id,
            "phase": phase,
            "timestampMs": LiveProtocol.timestampMs(),
            "durationMs": 15_000
        ]
        guard
            let data = try? JSONSerialization.data(withJSONObject: payload),
            let json = String(data: data, encoding: .utf8)
        else { return }
        poseSocket.sendControl(text: json)
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
            self.connectBridgeServices(to: bridgeURL)
        }
        frameReconnectWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: workItem)
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

    private func startDiagnostics() {
        diagnosticTimer?.cancel()
        diagnosticLock.withLock {
            capturedFrameCount = 0
            submittedFrameCount = 0
            encodedFrameCount = 0
            acceptedFrameCount = 0
            rejectedFrameCount = 0
            lastEncodedPayloadBytes = 0
            lastPresentationTimestamp = .invalid
            presentationIntervalTotalMs = 0
            presentationIntervalSamples = 0
            presentationIntervalMaxMs = 0
            conversionTotalMs = 0
            conversionSamples = 0
            conversionMaxMs = 0
            webRTCDirectFrameCount = 0
            webRTCConvertedFrameCount = 0
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
        let counters = diagnosticLock.withLock {
            (
                capturedFrameCount,
                submittedFrameCount,
                encodedFrameCount,
                acceptedFrameCount,
                rejectedFrameCount,
                lastEncodedPayloadBytes,
                presentationIntervalTotalMs,
                presentationIntervalSamples,
                presentationIntervalMaxMs,
                conversionTotalMs,
                conversionSamples,
                conversionMaxMs,
                webRTCDirectFrameCount,
                webRTCConvertedFrameCount
            )
        }
        var payload: [String: Any] = [
            "type": "encoder-status",
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
            "frameSocket": socket.state.rawValue,
            "poseSocket": poseSocket.state.rawValue,
            "webRTC": webRTCState.rawValue
        ]
        if counters.7 > 0 {
            payload["presentationIntervalAverageMs"] = counters.6 / Double(counters.7)
            payload["presentationIntervalMaxMs"] = counters.8
        }
        if counters.10 > 0 {
            payload["conversionAverageMs"] = counters.9 / Double(counters.10)
            payload["conversionMaxMs"] = counters.11
        }
        payload["webRTCDirectFrames"] = counters.12
        payload["webRTCConvertedFrames"] = counters.13

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

    private func startStream(with filter: SCContentFilter) {
        captureState = .starting

        if let oldStream = activeStream {
            oldStream.stopCapture(completionHandler: nil)
        }

        let configuration = SCStreamConfiguration()
        configuration.capturesAudio = false
        // Width/height are the only video-output controls ScreenCaptureKit
        // currently exposes on iOS. Scaling at capture avoids feeding the
        // native 1206 x 2622 surface through our Core Image path first.
        configuration.width = 960
        configuration.height = 2_088

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
            return
        }

        activeStream = stream
        lastFrameTimestamp = .invalid
        stream.startCapture { [weak self, weak stream] error in
            DispatchQueue.main.async {
                guard let self, self.activeStream === stream else { return }
                if let error {
                    self.activeStream = nil
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

    private func processScreenFrame(_ sampleBuffer: CMSampleBuffer) {
        guard CMSampleBufferIsValid(sampleBuffer) else { return }

        let timestamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let frameGateInterval = streamCodec == .webrtc
            ? webRTCMinimumFrameInterval
            : legacyMinimumFrameInterval
        if lastFrameTimestamp.isValid,
           CMTimeCompare(
               CMTimeSubtract(timestamp, lastFrameTimestamp),
               frameGateInterval
           ) < 0 {
            return
        }
        lastFrameTimestamp = timestamp
        diagnosticLock.withLock {
            if lastPresentationTimestamp.isValid {
                let intervalMs = CMTimeGetSeconds(
                    CMTimeSubtract(timestamp, lastPresentationTimestamp)
                ) * 1_000
                if intervalMs.isFinite, intervalMs >= 0 {
                    presentationIntervalTotalMs += intervalMs
                    presentationIntervalSamples += 1
                    presentationIntervalMaxMs = max(
                        presentationIntervalMaxMs,
                        intervalMs
                    )
                }
            }
            lastPresentationTimestamp = timestamp
        }
        let callbackAtMs = LiveProtocol.timestampMs()
        let captureAtMs = estimatedCaptureTimestampMs(
            presentationTimestamp: timestamp,
            callbackAtMs: callbackAtMs
        )

        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        var image = CIImage(cvPixelBuffer: pixelBuffer)
        let frameOrientation = imageOrientation(from: sampleBuffer)

        if let orientation = frameOrientation {
            image = image.oriented(orientation)
        }

        let extent = image.extent.integral
        guard extent.width > 0, extent.height > 0 else { return }
        let width = Int(extent.width)
        let height = Int(extent.height)
        let orientation = height >= width ? "portrait" : "landscape"
        nextFrameId += 1
        diagnosticLock.withLock {
            capturedFrameCount += 1
        }
        let encodeStartedAtMs = LiveProtocol.timestampMs()

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

        if streamCodec == .h264 {
            let outputDimensions = h264OutputDimensions(
                width: width,
                height: height
            )
            guard let outputPixelBuffer = h264PixelBuffer(
                image: image,
                extent: extent,
                width: outputDimensions.width,
                height: outputDimensions.height
            ) else { return }
            let submitted = h264Encoder.encode(
                pixelBuffer: outputPixelBuffer,
                timing: H264FrameTiming(
                    frameId: nextFrameId,
                    captureAtMs: captureAtMs,
                    callbackAtMs: callbackAtMs,
                    encodeStartedAtMs: encodeStartedAtMs,
                    width: outputDimensions.width,
                    height: outputDimensions.height,
                    orientation: orientation
                )
            )
            if submitted {
                diagnosticLock.withLock {
                    submittedFrameCount += 1
                }
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

        let clock = socket.clockEstimate()
        let metadata = FrameMetadataMessage(
            frameId: nextFrameId,
            timestampMs: captureAtMs,
            captureAtMs: captureAtMs,
            callbackAtMs: callbackAtMs,
            encodeStartedAtMs: encodeStartedAtMs,
            encodedAtMs: encodedAtMs,
            width: width,
            height: height,
            orientation: orientation,
            jpegBytes: jpeg.count,
            codec: "jpeg",
            isKeyframe: nil,
            clockOffsetMs: clock?.offsetMs,
            clockRttMs: clock?.rttMs
        )
        guard let json = LiveProtocol.json(metadata) else { return }
        socket.sendFrame(metadata: json, jpegData: jpeg)
    }

    private func sendH264Frame(
        data: Data,
        timing: H264FrameTiming,
        isKeyframe: Bool
    ) -> Bool {
        let encodedAtMs = LiveProtocol.timestampMs()
        let clock = socket.clockEstimate()
        let metadata = FrameMetadataMessage(
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
            clockOffsetMs: clock?.offsetMs,
            clockRttMs: clock?.rttMs
        )
        guard let json = LiveProtocol.json(metadata) else { return false }
        let accepted = socket.sendOrderedFrame(metadata: json, encodedData: data)
        diagnosticLock.withLock {
            encodedFrameCount += 1
            lastEncodedPayloadBytes = data.count
            if accepted {
                acceptedFrameCount += 1
            } else {
                rejectedFrameCount += 1
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

    private func estimatedCaptureTimestampMs(
        presentationTimestamp: CMTime,
        callbackAtMs: Int64
    ) -> Int64 {
        let hostTimestamp = CMClockGetTime(CMClockGetHostTimeClock())
        guard presentationTimestamp.isValid, hostTimestamp.isValid else {
            return callbackAtMs
        }

        let sampleAgeSeconds = CMTimeGetSeconds(
            CMTimeSubtract(hostTimestamp, presentationTimestamp)
        )
        guard
            sampleAgeSeconds.isFinite,
            sampleAgeSeconds >= 0,
            sampleAgeSeconds <= 1
        else { return callbackAtMs }

        return callbackAtMs - Int64((sampleAgeSeconds * 1_000).rounded())
    }

    private func imageOrientation(
        from sampleBuffer: CMSampleBuffer
    ) -> CGImagePropertyOrientation? {
        guard
            let attachments = CMSampleBufferGetSampleAttachmentsArray(
                sampleBuffer,
                createIfNecessary: false
            ) as? [[SCStreamFrameInfo: Any]],
            let value = attachments.first?[.videoOrientation] as? NSNumber
        else { return nil }

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
        processScreenFrame(sampleBuffer)
    }
}

extension ScreenCaptureController: SCStreamDelegate {
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        DispatchQueue.main.async { [weak self, weak stream] in
            guard let self, self.activeStream === stream else { return }
            self.activeStream = nil
            self.motion.stop()
            self.socket.disconnect()
            self.poseSocket.disconnect()
            self.webRTCStreamer.disconnect()
            self.captureState = .failed("Capture stopped: \(error.localizedDescription)")
        }
    }
}
