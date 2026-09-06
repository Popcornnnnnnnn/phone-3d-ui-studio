import Foundation
import Network

private struct OrderedFrame {
    let frameId: Int64
    let messages: [URLSessionWebSocketTask.Message]
}

private struct FrameAckReservation {
    let generation: Int64
    var startedAtUptime: TimeInterval
}

private struct PendingClockRequest {
    let sentAtWallMs: Double
    let sentAtUptimeMs: Double
    let roundId: Int64
}

/// Callback values are copied while holding their owning socket queue, then
/// transferred exactly once to the main queue for UI delivery. Keeping this
/// wrapper private preserves the existing callback API while making the
/// intentional cross-queue handoff explicit to strict-concurrency checking.
private struct MainQueueCallback<Value>: @unchecked Sendable {
    let value: Value
}

/// RFC 6298-style estimator tuned for a single-frame, freshness-first stream.
/// The soft timeout adapts to normal ACK jitter, while the separate hard
/// deadline remains an absolute bound on a stuck frame.
struct BoundedFrameAckRTO {
    let minimumSeconds: TimeInterval
    let initialSeconds: TimeInterval
    let maximumSeconds: TimeInterval
    let hardMaximumSeconds: TimeInterval

    private(set) var smoothedSeconds: TimeInterval?
    private(set) var variationSeconds: TimeInterval?
    private(set) var backoffExponent = 0

    init(
        minimumSeconds: TimeInterval = 0.2,
        initialSeconds: TimeInterval = 0.3,
        maximumSeconds: TimeInterval = 0.5,
        hardMaximumSeconds: TimeInterval = 0.75
    ) {
        self.minimumSeconds = minimumSeconds
        self.initialSeconds = initialSeconds
        self.maximumSeconds = maximumSeconds
        self.hardMaximumSeconds = hardMaximumSeconds
    }

    var timeoutSeconds: TimeInterval {
        let estimated: TimeInterval
        if let smoothedSeconds, let variationSeconds {
            estimated = smoothedSeconds + max(0.01, 4 * variationSeconds)
        } else {
            estimated = initialSeconds
        }
        let base = min(maximumSeconds, max(minimumSeconds, estimated))
        let backedOff = base * Double(1 << backoffExponent)
        return min(maximumSeconds, backedOff)
    }

    var hardDeadlineSeconds: TimeInterval {
        let soft = timeoutSeconds
        return min(
            hardMaximumSeconds,
            max(soft + 0.25, soft * 1.5)
        )
    }

    mutating func recordAcknowledgement(seconds sample: TimeInterval) {
        guard sample.isFinite, sample > 0 else { return }
        if
            let previousSmoothed = smoothedSeconds,
            let previousVariation = variationSeconds
        {
            variationSeconds =
                (0.75 * previousVariation) +
                (0.25 * abs(previousSmoothed - sample))
            smoothedSeconds =
                (0.875 * previousSmoothed) + (0.125 * sample)
        } else {
            smoothedSeconds = sample
            variationSeconds = sample / 2
        }
        backoffExponent = max(0, backoffExponent - 1)
    }

    mutating func recordTimeout() {
        backoffExponent = min(2, backoffExponent + 1)
    }
}

struct LowLatencyFrameTransportDiagnostics {
    let awaitingAck: Bool
    let lastAckMs: Double?
    let maxAckMs: Double
    let ackCount: Int64
    let ackTimeouts: Int64
    let ackSoftTimeouts: Int64
    let ackRtoMs: Double
    let ackArmedRtoMs: Double
    let ackHardDeadlineMs: Double
    let ackRtoMinMs: Double
    let ackRtoMaxMs: Double
    let ackHardMaxMs: Double
    let ackSmoothedMs: Double?
    let ackVariationMs: Double?
    let ackRtoBackoff: Int
    let lastFrameWasKeyframe: Bool
    let lastFramePayloadBytes: Int
    let lastSendCompletionMs: Double?
    let maxSendCompletionMs: Double
    let connectionGeneration: Int64
    let connectTimeouts: Int64
    let waitingStates: Int64
    let lastFailureReason: String?
    let routePreference: String
    let routeUsesWiredEthernet: Bool
    let routeUsesWiFi: Bool
    let routeInterfaces: String?
    let wiredEthernetFallbacks: Int64
    let window: Int
    let outstandingFrames: Int
    let outstandingBytes: Int
    let byteLimit: Int
    let oldestOutstandingAgeMs: Double
    let maximumAdmissionAgeMs: Double
    let traceSamples: [FrameTransportTrace.Sample]
    let traceLatestRevision: Int64
    let traceAcknowledgedRevision: Int64
    let traceDiscardedThroughRevision: Int64
    let traceExportGeneration: Int64
}

final class LiveSocket: NSObject, URLSessionWebSocketDelegate, @unchecked Sendable {
    enum State: String {
        case idle
        case connecting
        case connected
        case failed
    }

    private let outboundQueue = DispatchQueue(label: "Phone3D.LiveSocket.outbound")
    private let outboundQueueKey = DispatchSpecificKey<UInt8>()
    private var stateChangeHandler: ((State) -> Void)?
    private var keyframeRequestHandler: (() -> Void)?
    private var textMessageHandler: ((String) -> Void)?
    private var controlMessages: [URLSessionWebSocketTask.Message] = []
    private var latestTextMessage: URLSessionWebSocketTask.Message?
    private var latestFrameMessages: [URLSessionWebSocketTask.Message]?
    private var orderedFrameMessages: [OrderedFrame] = []
    private var activeFrameMessages: [URLSessionWebSocketTask.Message] = []
    private var activeFrameId: Int64?
    private var frameAckReservations: [Int64: FrameAckReservation] = [:]
    private var lastFrameAckMs: Double?
    private var maxFrameAckMs = 0.0
    private var frameAckCount: Int64 = 0
    private var frameAckTimeoutCount: Int64 = 0
    private var nextFrameAckGeneration: Int64 = 0
    // Keep the legacy WebSocket fallback freshness-first. The main app uses
    // LowLatencyFrameSocket below for its dedicated TCP_NODELAY video path.
    private let maxInFlightOrderedFrames = 1
    private let frameAckTimeoutSeconds: TimeInterval = 0.15
    private var isSending = false
    private var sendGeneration: Int64 = 0
    private var session: URLSession?
    private var task: URLSessionWebSocketTask?
    private var connectionGeneration: Int64 = 0
    private var pendingClockRequests: [Int64: PendingClockRequest] = [:]
    private var clockEstimateWindow = ClockEstimateWindow()
    private var lastClockEstimatePublishedAtUptimeMs: Double?
    private var clockSyncRoundId: Int64 = 0
    private var nextClockRequestId: Int64 = 0

    private let clockRefreshIntervalSeconds: TimeInterval = 15
    private let clockReplyGraceSeconds: TimeInterval = 1
    private let maximumClockEstimateAgeMs = 60_000.0

    private var internalState: State = .idle

    override init() {
        super.init()
        outboundQueue.setSpecific(key: outboundQueueKey, value: 1)
    }

    var onStateChange: ((State) -> Void)? {
        get { withOutboundQueue { stateChangeHandler } }
        set { withOutboundQueue { stateChangeHandler = newValue } }
    }

    var onKeyframeRequest: (() -> Void)? {
        get { withOutboundQueue { keyframeRequestHandler } }
        set { withOutboundQueue { keyframeRequestHandler = newValue } }
    }

    var onTextMessage: ((String) -> Void)? {
        get { withOutboundQueue { textMessageHandler } }
        set { withOutboundQueue { textMessageHandler = newValue } }
    }

    private(set) var state: State {
        get { withOutboundQueue { internalState } }
        set { withOutboundQueue { transitionLocked(to: newValue) } }
    }

    func connect(to url: URL) {
        withOutboundQueue {
            disconnectLocked()
            connectionGeneration &+= 1
            transitionLocked(to: .connecting)

            let configuration = URLSessionConfiguration.default
            configuration.timeoutIntervalForRequest = 8
            let session = URLSession(
                configuration: configuration,
                delegate: self,
                delegateQueue: nil
            )
            let task = session.webSocketTask(with: url)
            self.session = session
            self.task = task
            task.resume()
        }
    }

    func disconnect() {
        withOutboundQueue {
            disconnectLocked()
        }
    }

    private func withOutboundQueue<T>(_ body: () -> T) -> T {
        if DispatchQueue.getSpecific(key: outboundQueueKey) != nil {
            return body()
        }
        return outboundQueue.sync(execute: body)
    }

    private func transitionLocked(to nextState: State) {
        guard internalState != nextState else { return }
        internalState = nextState
        let notificationGeneration = connectionGeneration
        let handler = MainQueueCallback(value: stateChangeHandler)
        DispatchQueue.main.async { [weak self] in
            guard
                let self,
                self.withOutboundQueue({
                    self.connectionGeneration == notificationGeneration &&
                        self.internalState == nextState
                })
            else { return }
            handler.value?(nextState)
        }
    }

    private func clearTransportStateLocked() {
        controlMessages.removeAll(keepingCapacity: true)
        latestTextMessage = nil
        latestFrameMessages = nil
        orderedFrameMessages.removeAll(keepingCapacity: true)
        activeFrameMessages.removeAll(keepingCapacity: true)
        activeFrameId = nil
        frameAckReservations.removeAll(keepingCapacity: true)
        pendingClockRequests.removeAll(keepingCapacity: true)
        clockEstimateWindow.reset()
        lastClockEstimatePublishedAtUptimeMs = nil
        clockSyncRoundId = 0
        isSending = false
        sendGeneration &+= 1
    }

    private func disconnectLocked() {
        connectionGeneration &+= 1
        let oldTask = task
        let oldSession = session
        task = nil
        session = nil
        clearTransportStateLocked()
        oldTask?.cancel(with: .goingAway, reason: nil)
        oldSession?.invalidateAndCancel()
        transitionLocked(to: .idle)
    }

    private func failLocked(
        session expectedSession: URLSession,
        task expectedTask: URLSessionWebSocketTask,
        generation expectedGeneration: Int64
    ) {
        guard
            connectionGeneration == expectedGeneration,
            session === expectedSession,
            task === expectedTask
        else { return }

        connectionGeneration &+= 1
        task = nil
        session = nil
        clearTransportStateLocked()
        expectedTask.cancel(with: .goingAway, reason: nil)
        expectedSession.invalidateAndCancel()
        transitionLocked(to: .failed)
    }

    func send(text: String) {
        outboundQueue.async { [weak self] in
            guard let self, self.internalState == .connected else { return }
            self.latestTextMessage = .string(text)
            self.sendNextIfNeeded()
        }
    }

    /// Sends signaling/control JSON without coalescing. Unlike pose samples,
    /// WebRTC SDP and ICE candidates must stay ordered and may not be dropped.
    func sendControl(text: String) {
        outboundQueue.async { [weak self] in
            guard let self, self.internalState == .connected else { return }
            self.controlMessages.append(.string(text))
            self.sendNextIfNeeded()
        }
    }

    func sendFrame(metadata: String, jpegData: Data) {
        outboundQueue.async { [weak self] in
            guard let self, self.internalState == .connected else { return }
            self.latestFrameMessages = [.string(metadata), .data(jpegData)]
            self.sendNextIfNeeded()
        }
    }

    @discardableResult
    func sendOrderedFrame(
        frameId: Int64,
        metadata: String,
        encodedData: Data
    ) -> Bool {
        withOutboundQueue {
            guard internalState == .connected else { return false }

            // URLSession reports send completion when bytes enter its local
            // transport buffer, not when the Mac has received them. Bound the
            // complete set of queued and unacknowledged H.264 frames so an
            // opaque TCP queue can never accumulate seconds of stale UI.
            guard
                frameAckReservations.count + orderedFrameMessages.count <
                    maxInFlightOrderedFrames,
                frameAckReservations[frameId] == nil,
                !orderedFrameMessages.contains(where: { $0.frameId == frameId })
            else { return false }
            let metadataData = Data(metadata.utf8)
            guard metadataData.count <= Int(UInt32.max) else { return false }
            var metadataLength = UInt32(metadataData.count).bigEndian
            var envelope = Data(
                capacity: 8 + metadataData.count + encodedData.count
            )
            envelope.append(contentsOf: [0x50, 0x33, 0x44, 0x31])
            withUnsafeBytes(of: &metadataLength) { bytes in
                envelope.append(contentsOf: bytes)
            }
            envelope.append(metadataData)
            envelope.append(encodedData)
            orderedFrameMessages.append(
                OrderedFrame(
                    frameId: frameId,
                    messages: [.data(envelope)]
                )
            )
            sendNextIfNeeded()
            return true
        }
    }

    func canAcceptOrderedFrame() -> Bool {
        withOutboundQueue {
            internalState == .connected &&
                frameAckReservations.count + orderedFrameMessages.count <
                    maxInFlightOrderedFrames
        }
    }

    func frameTransportDiagnosticState() -> (
        awaitingAck: Bool,
        lastAckMs: Double?,
        maxAckMs: Double,
        ackCount: Int64,
        ackTimeouts: Int64,
        window: Int
    ) {
        withOutboundQueue {
            (
                !frameAckReservations.isEmpty,
                lastFrameAckMs,
                maxFrameAckMs,
                frameAckCount,
                frameAckTimeoutCount,
                maxInFlightOrderedFrames
            )
        }
    }

    func clockEstimate() -> ClockEstimate? {
        withOutboundQueue {
            guard
                let publishedAt = lastClockEstimatePublishedAtUptimeMs,
                ProcessInfo.processInfo.systemUptime * 1_000 - publishedAt <=
                    maximumClockEstimateAgeMs
            else { return nil }
            return clockEstimateWindow.estimate
        }
    }

    private func sendNextIfNeeded() {
        guard
            !isSending,
            let session,
            let task
        else { return }

        let message: URLSessionWebSocketTask.Message
        if !activeFrameMessages.isEmpty {
            message = activeFrameMessages.removeFirst()
        } else if !controlMessages.isEmpty {
            message = controlMessages.removeFirst()
        } else if let latestTextMessage {
            message = latestTextMessage
            self.latestTextMessage = nil
        } else if !orderedFrameMessages.isEmpty {
            let frame = orderedFrameMessages.removeFirst()
            activeFrameMessages = frame.messages
            activeFrameId = frame.frameId
            reserveFrameAck(frameId: frame.frameId)
            message = activeFrameMessages.removeFirst()
        } else if let latestFrameMessages {
            activeFrameMessages = latestFrameMessages
            self.latestFrameMessages = nil
            message = activeFrameMessages.removeFirst()
        } else {
            return
        }

        isSending = true
        sendGeneration &+= 1
        let activeSendGeneration = sendGeneration
        let activeConnectionGeneration = connectionGeneration
        task.send(message) { [weak self, weak session, weak task] error in
            guard let self, let session, let task else { return }
            self.outboundQueue.async {
                guard
                    self.connectionGeneration == activeConnectionGeneration,
                    self.session === session,
                    self.task === task,
                    self.sendGeneration == activeSendGeneration
                else { return }
                self.isSending = false
                if error != nil {
                    self.failLocked(
                        session: session,
                        task: task,
                        generation: activeConnectionGeneration
                    )
                    return
                }
                if self.activeFrameMessages.isEmpty,
                   let frameId = self.activeFrameId {
                    self.activeFrameId = nil
                    self.beginFrameAckTimeout(
                        frameId: frameId,
                        session: session,
                        task: task,
                        connectionGeneration: activeConnectionGeneration
                    )
                }
                self.sendNextIfNeeded()
            }
        }

        outboundQueue.asyncAfter(deadline: .now() + 2) {
            [weak self, weak session, weak task] in
            guard
                let self,
                let session,
                let task,
                self.connectionGeneration == activeConnectionGeneration,
                self.session === session,
                self.task === task,
                self.isSending,
                self.sendGeneration == activeSendGeneration
            else { return }

            // URLSession can leave a WebSocket send pending even after the
            // Wi-Fi path has silently gone stale. Fail fast so the owner can
            // reconnect instead of accumulating seconds of invisible delay.
            self.failLocked(
                session: session,
                task: task,
                generation: activeConnectionGeneration
            )
        }
    }

    private func reserveFrameAck(frameId: Int64) {
        nextFrameAckGeneration += 1
        frameAckReservations[frameId] = FrameAckReservation(
            generation: nextFrameAckGeneration,
            startedAtUptime: 0
        )
    }

    private func beginFrameAckTimeout(
        frameId: Int64,
        session: URLSession,
        task: URLSessionWebSocketTask,
        connectionGeneration expectedConnectionGeneration: Int64
    ) {
        // The bridge can theoretically ACK before URLSession invokes its send
        // completion. In that case acknowledgeFrame has already cleared this
        // reservation and no timeout should be installed.
        guard var reservation = frameAckReservations[frameId] else { return }
        reservation.startedAtUptime = ProcessInfo.processInfo.systemUptime
        frameAckReservations[frameId] = reservation
        let generation = reservation.generation

        outboundQueue.asyncAfter(
            deadline: .now() + frameAckTimeoutSeconds
        ) { [weak self, weak session, weak task] in
            guard
                let self,
                let session,
                let task,
                self.connectionGeneration == expectedConnectionGeneration,
                self.session === session,
                self.task === task,
                self.frameAckReservations[frameId]?.generation == generation
            else { return }

            self.frameAckTimeoutCount += 1
            self.failLocked(
                session: session,
                task: task,
                generation: expectedConnectionGeneration
            )
        }
    }

    func acknowledgeFrame(frameId: Int64) {
        outboundQueue.async { [weak self] in
            self?.acknowledgeFrameLocked(frameId: frameId)
        }
    }

    private func acknowledgeFrameLocked(frameId: Int64) {
        guard let reservation = frameAckReservations.removeValue(
            forKey: frameId
        ) else { return }

        let ackMs = max(
            0,
            reservation.startedAtUptime == 0
                ? 0
                : (
                    ProcessInfo.processInfo.systemUptime -
                        reservation.startedAtUptime
                ) * 1_000
        )
        lastFrameAckMs = ackMs
        maxFrameAckMs = max(maxFrameAckMs, ackMs)
        frameAckCount += 1
        sendNextIfNeeded()
    }

    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        outboundQueue.async { [weak self, weak session, weak webSocketTask] in
            guard
                let self,
                let session,
                let webSocketTask,
                self.session === session,
                self.task === webSocketTask,
                self.internalState == .connecting
            else { return }

            let generation = self.connectionGeneration
            self.transitionLocked(to: .connected)
            self.receiveNext(
                on: webSocketTask,
                session: session,
                generation: generation
            )
            self.beginClockSync(
                session: session,
                task: webSocketTask,
                generation: generation
            )
        }
    }

    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        // Ignore the close callback produced by an explicit disconnect(). If
        // the active server closes normally (for example during a local
        // service restart), surface it as a failure so the capture owner can
        // reconnect instead of remaining silently idle.
        outboundQueue.async { [weak self, weak session, weak webSocketTask] in
            guard
                let self,
                let session,
                let webSocketTask,
                self.session === session,
                self.task === webSocketTask
            else { return }
            self.failLocked(
                session: session,
                task: webSocketTask,
                generation: self.connectionGeneration
            )
        }
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        guard let webSocketTask = task as? URLSessionWebSocketTask else { return }
        outboundQueue.async { [weak self, weak session, weak webSocketTask] in
            guard
                let self,
                let session,
                let webSocketTask,
                self.session === session,
                self.task === webSocketTask
            else { return }
            self.failLocked(
                session: session,
                task: webSocketTask,
                generation: self.connectionGeneration
            )
        }
    }

    private func beginClockSync(
        session: URLSession,
        task: URLSessionWebSocketTask,
        generation: Int64
    ) {
        pendingClockRequests.removeAll(keepingCapacity: true)
        clockEstimateWindow.reset()
        clockSyncRoundId = 0
        startClockSyncRound(
            session: session,
            task: task,
            generation: generation,
            sampleCount: 8,
            spacingSeconds: 0.2
        )
    }

    private func startClockSyncRound(
        session: URLSession,
        task: URLSessionWebSocketTask,
        generation: Int64,
        sampleCount: Int,
        spacingSeconds: TimeInterval
    ) {
        guard
            internalState == .connected,
            connectionGeneration == generation,
            self.session === session,
            self.task === task
        else { return }

        clockSyncRoundId &+= 1
        let roundId = clockSyncRoundId
        clockEstimateWindow.beginRound(roundId)

        for index in 0..<sampleCount {
            outboundQueue.asyncAfter(
                deadline: .now() + (Double(index) * spacingSeconds)
            ) { [weak self, weak session, weak task] in
                guard
                    let self,
                    let session,
                    let task,
                    self.connectionGeneration == generation,
                    self.session === session,
                    self.task === task
                else { return }
                self.sendClockSyncRequest(inRound: roundId)
            }
        }

        let lastRequestDelay = Double(max(0, sampleCount - 1)) * spacingSeconds
        outboundQueue.asyncAfter(
            deadline: .now() + lastRequestDelay + clockReplyGraceSeconds
        ) { [weak self, weak session, weak task] in
            guard
                let self,
                let session,
                let task,
                self.connectionGeneration == generation,
                self.session === session,
                self.task === task
            else { return }

            if self.clockEstimateWindow.completeRound(roundId) {
                self.lastClockEstimatePublishedAtUptimeMs =
                    ProcessInfo.processInfo.systemUptime * 1_000
            }
            self.pendingClockRequests = self.pendingClockRequests.filter {
                $0.value.roundId != roundId
            }
            self.outboundQueue.asyncAfter(
                deadline: .now() + self.clockRefreshIntervalSeconds
            ) { [weak self, weak session, weak task] in
                guard
                    let self,
                    let session,
                    let task,
                    self.connectionGeneration == generation,
                    self.session === session,
                    self.task === task
                else { return }
                self.startClockSyncRound(
                    session: session,
                    task: task,
                    generation: generation,
                    sampleCount: 4,
                    spacingSeconds: 0.15
                )
            }
        }
    }

    private func sendClockSyncRequest(inRound roundId: Int64) {
        guard internalState == .connected else { return }
        nextClockRequestId &+= 1
        let requestId = nextClockRequestId
        let sentAtWallMs = LiveProtocol.preciseTimestampMs()
        let sentAtUptimeMs = ProcessInfo.processInfo.systemUptime * 1_000
        let request = ClockSyncRequest(
            requestId: requestId,
            phoneSendAtPreciseMs: sentAtWallMs
        )
        guard let json = LiveProtocol.json(request) else { return }

        pendingClockRequests[requestId] = PendingClockRequest(
            sentAtWallMs: sentAtWallMs,
            sentAtUptimeMs: sentAtUptimeMs,
            roundId: roundId
        )
        controlMessages.append(.string(json))
        sendNextIfNeeded()
    }

    private func receiveNext(
        on receivingTask: URLSessionWebSocketTask,
        session: URLSession,
        generation: Int64
    ) {
        receivingTask.receive {
            [weak self, weak session, weak receivingTask] result in
            let receivedAtWallMs = LiveProtocol.preciseTimestampMs()
            let receivedAtUptimeMs = ProcessInfo.processInfo.systemUptime * 1_000
            guard let self, let session, let receivingTask else { return }
            self.outboundQueue.async {
                guard
                    self.connectionGeneration == generation,
                    self.session === session,
                    self.task === receivingTask
                else { return }

                switch result {
                case let .success(message):
                    if case let .string(text) = message {
                        self.handleIncomingText(
                            text,
                            receivedAtWallMs: receivedAtWallMs,
                            receivedAtUptimeMs: receivedAtUptimeMs
                        )
                    }
                    self.receiveNext(
                        on: receivingTask,
                        session: session,
                        generation: generation
                    )
                case .failure:
                    self.failLocked(
                        session: session,
                        task: receivingTask,
                        generation: generation
                    )
                }
            }
        }
    }

    private func handleIncomingText(
        _ text: String,
        receivedAtWallMs: Double,
        receivedAtUptimeMs: Double
    ) {
        if
            let data = text.data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            object["type"] as? String == "frame-ack",
            let frameNumber = object["frameId"] as? NSNumber
        {
            acknowledgeFrameLocked(frameId: frameNumber.int64Value)
            // The bridge mirrors frame ACKs onto the independent pose socket
            // so upload-heavy frame traffic cannot delay reverse-path flow
            // control. A pose LiveSocket has no local frame pending, therefore
            // forward the same control message to its owner as well.
            let handler = MainQueueCallback(value: textMessageHandler)
            DispatchQueue.main.async {
                handler.value?(text)
            }
            return
        }

        if
            let data = text.data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            object["type"] as? String == "request-keyframe"
        {
            let handler = MainQueueCallback(value: keyframeRequestHandler)
            DispatchQueue.main.async {
                handler.value?()
            }
            return
        }

        guard
            let data = text.data(using: .utf8),
            let reply = try? JSONDecoder().decode(ClockSyncReply.self, from: data),
            reply.type == "clock-sync-reply"
        else {
            let handler = MainQueueCallback(value: textMessageHandler)
            DispatchQueue.main.async {
                handler.value?(text)
            }
            return
        }

        guard let pendingRequest = pendingClockRequests.removeValue(
            forKey: reply.requestId
        ) else { return }
        guard let estimate = ClockEstimate.fromExchange(
            phoneSendAtWallMs: pendingRequest.sentAtWallMs,
            phoneReceiveAtWallMs: receivedAtWallMs,
            phoneRoundTripElapsedMs:
                receivedAtUptimeMs - pendingRequest.sentAtUptimeMs,
            bridgeReceiveAtMs: reply.bridgeReceiveAtMs,
            bridgeSendAtMs: reply.bridgeSendAtMs
        ) else { return }
        clockEstimateWindow.record(
            estimate,
            inRound: pendingRequest.roundId
        )
    }
}

/// Dedicated length-prefixed TCP transport for latency-sensitive screen
/// frames. URLSessionWebSocketTask remains in use for low-volume pose and
/// control traffic, while video uses TCP_NODELAY and a bounded ACK window.
final class LowLatencyFrameSocket: @unchecked Sendable {
    enum State: String {
        case idle
        case connecting
        case connected
        case failed
    }

    private let queue = DispatchQueue(
        label: "Phone3D.LowLatencyFrameSocket",
        qos: .userInteractive
    )
    private let queueKey = DispatchSpecificKey<UInt8>()
    private var stateChangeHandler: ((State) -> Void)?
    private var keyframeRequestHandler: (() -> Void)?
    private var connection: NWConnection?
    private var connectionGeneration: Int64 = 0
    private var receiveBuffer = Data()
    private var isSending = false
    private var activeFrameId: Int64?
    private var frameWindow = BoundedFrameWindow()
    private var frameTrace = FrameTransportTrace()
    private var requestedRoute: FrameRoutePolicy = .wifiOnly
    private var lastFrameAckMs: Double?
    private var maxFrameAckMs = 0.0
    private var frameAckCount: Int64 = 0
    private var frameAckTimeoutCount: Int64 = 0
    private var frameAckSoftTimeoutCount: Int64 = 0
    private var sendGeneration: Int64 = 0
    private var frameAckRTO = BoundedFrameAckRTO()
    private var lastArmedFrameAckRTOSeconds: TimeInterval = 0.3
    private var lastArmedFrameAckHardDeadlineSeconds: TimeInterval = 0.55
    private var lastArmedFrameWasKeyframe = false
    private var lastArmedFramePayloadBytes = 0
    private var lastFrameSendCompletionMs: Double?
    private var maxFrameSendCompletionMs = 0.0
    private var connectWatchdogTimeoutCount: Int64 = 0
    private var waitingStateCount: Int64 = 0
    private var lastFailureReason: String?
    private var activeHost: NWEndpoint.Host?
    private var activePort: NWEndpoint.Port?
    private var prefersWiredEthernet = false
    private var routeUsesWiredEthernet = false
    private var routeUsesWiFi = false
    private var routeInterfaces: String?
    private var wiredEthernetFallbackCount: Int64 = 0
    private let keyframeMinimumAckRTOSeconds: TimeInterval = 0.35
    private let keyframeMinimumHardDeadlineSeconds: TimeInterval = 0.6
    private let connectWatchdogSeconds: TimeInterval = 1
    private let sendWatchdogSeconds: TimeInterval = 0.5

    private var internalState: State = .idle

    init() {
        queue.setSpecific(key: queueKey, value: 1)
    }

    var onStateChange: ((State) -> Void)? {
        get { withQueue { stateChangeHandler } }
        set { withQueue { stateChangeHandler = newValue } }
    }

    var onKeyframeRequest: (() -> Void)? {
        get { withQueue { keyframeRequestHandler } }
        set { withQueue { keyframeRequestHandler = newValue } }
    }

    /// Called at an encoder-generation boundary; retire any old dependent
    /// frames before applying a different route/window. Reconnect uses this
    /// requested route again, so Wi-Fi mode never silently falls back to USB.
    func configure(route: FrameRoutePolicy, window: Int) -> Bool {
        guard (1...3).contains(window) else { return false }
        return withQueue {
            if requestedRoute == route && frameWindow.capacity == window { return true }
            disconnectLocked()
            requestedRoute = route
            frameWindow = BoundedFrameWindow(capacity: window)
            frameAckRTO = BoundedFrameAckRTO()
            return true
        }
    }

    private(set) var state: State {
        get { withQueue { internalState } }
        set { withQueue { transitionLocked(to: newValue) } }
    }

    func connect(to url: URL) {
        withQueue {
            disconnectLocked()
            guard
                let host = url.host,
                let webSocketPort = url.port,
                (1..<65_535).contains(webSocketPort),
                let port = NWEndpoint.Port(
                    rawValue: UInt16(webSocketPort + 1)
                )
            else {
                transitionLocked(to: .failed)
                return
            }

            activeHost = NWEndpoint.Host(host)
            activePort = port
            transitionLocked(to: .connecting)
            startConnectionLocked(
                host: NWEndpoint.Host(host),
                port: port,
                requireWiredEthernet: requestedRoute == .wiredPreferred
            )
        }
    }

    private func startConnectionLocked(
        host: NWEndpoint.Host,
        port: NWEndpoint.Port,
        requireWiredEthernet: Bool
    ) {
        connectionGeneration &+= 1
        let generation = connectionGeneration
        prefersWiredEthernet = requireWiredEthernet
        routeUsesWiredEthernet = false
        routeUsesWiFi = false
        routeInterfaces = nil

        let tcp = NWProtocolTCP.Options()
        tcp.noDelay = true
        let parameters = NWParameters(tls: nil, tcp: tcp)
        if requestedRoute == .wifiOnly {
            parameters.requiredInterfaceType = .wifi
        } else if requireWiredEthernet {
            // A directly attached iPhone exposes its USB networking path to
            // Network.framework as wiredEthernet (anpi* on iOS). Prefer it so
            // Wi-Fi jitter cannot silently contaminate the video transport.
            parameters.requiredInterfaceType = .wiredEthernet
        }
        let connection = NWConnection(host: host, port: port, using: parameters)
        self.connection = connection
        connection.stateUpdateHandler = {
            [weak self, weak connection] newState in
            guard let self, let connection else { return }
            self.queue.async {
                guard
                    self.connectionGeneration == generation,
                    self.connection === connection
                else { return }
                switch newState {
                case .ready:
                    guard self.internalState == .connecting else { return }
                    let path = connection.currentPath
                    self.routeUsesWiredEthernet =
                        path?.usesInterfaceType(.wiredEthernet) ?? false
                    self.routeUsesWiFi = path?.usesInterfaceType(.wifi) ?? false
                    if self.requestedRoute == .wifiOnly && !self.routeUsesWiFi {
                        self.failLocked(connection, generation: generation, reason: "wifi-route-not-verified")
                        return
                    }
                    self.routeInterfaces = path?.availableInterfaces
                        .map { "\($0.name):\($0.type)" }
                        .joined(separator: ",")
                    self.transitionLocked(to: .connected)
                    self.receiveNext(on: connection, generation: generation)
                case let .waiting(error):
                    self.waitingStateCount += 1
                    self.handleConnectionFailureLocked(
                        connection,
                        generation: generation,
                        reason: "waiting: \(error)"
                    )
                case let .failed(error):
                    self.handleConnectionFailureLocked(
                        connection,
                        generation: generation,
                        reason: "failed: \(error)"
                    )
                case .cancelled:
                    self.handleConnectionFailureLocked(
                        connection,
                        generation: generation,
                        reason: "cancelled"
                    )
                default:
                    break
                }
            }
        }
        connection.start(queue: queue)
        beginConnectWatchdog(on: connection, generation: generation)
    }

    func disconnect() {
        withQueue {
            disconnectLocked()
        }
    }

    private func withQueue<T>(_ body: () -> T) -> T {
        if DispatchQueue.getSpecific(key: queueKey) != nil {
            return body()
        }
        return queue.sync(execute: body)
    }

    private func transitionLocked(to nextState: State) {
        guard internalState != nextState else { return }
        internalState = nextState
        let notificationGeneration = connectionGeneration
        let handler = MainQueueCallback(value: stateChangeHandler)
        DispatchQueue.main.async { [weak self] in
            guard
                let self,
                self.withQueue({
                    self.connectionGeneration == notificationGeneration &&
                        self.internalState == nextState
                })
            else { return }
            handler.value?(nextState)
        }
    }

    private func clearConnectionStateLocked() {
        frameTrace.finishAll(reason: "connection-cleared",
            uptime: ProcessInfo.processInfo.systemUptime,
            wallMs: Date().timeIntervalSince1970 * 1_000)
        receiveBuffer.removeAll(keepingCapacity: true)
        isSending = false
        activeFrameId = nil
        frameWindow.clear()
        sendGeneration &+= 1
    }

    private func disconnectLocked() {
        connectionGeneration &+= 1
        let previous = connection
        connection = nil
        previous?.stateUpdateHandler = nil
        clearConnectionStateLocked()
        previous?.cancel()
        activeHost = nil
        activePort = nil
        prefersWiredEthernet = false
        routeUsesWiredEthernet = false
        routeUsesWiFi = false
        routeInterfaces = nil
        transitionLocked(to: .idle)
    }

    private func beginConnectWatchdog(
        on watchedConnection: NWConnection,
        generation: Int64
    ) {
        queue.asyncAfter(
            deadline: .now() + connectWatchdogSeconds
        ) { [weak self, weak watchedConnection] in
            guard
                let self,
                let watchedConnection,
                self.connectionGeneration == generation,
                self.connection === watchedConnection,
                self.internalState == .connecting
            else { return }
            self.connectWatchdogTimeoutCount += 1
            self.handleConnectionFailureLocked(
                watchedConnection,
                generation: generation,
                reason: "connect-watchdog"
            )
        }
    }

    private func handleConnectionFailureLocked(
        _ failedConnection: NWConnection,
        generation expectedGeneration: Int64,
        reason: String
    ) {
        guard
            connectionGeneration == expectedGeneration,
            connection === failedConnection
        else { return }

        if prefersWiredEthernet, let activeHost, let activePort {
            wiredEthernetFallbackCount += 1
            lastFailureReason = "wired-primary-\(reason)"
            connection = nil
            failedConnection.stateUpdateHandler = nil
            clearConnectionStateLocked()
            failedConnection.cancel()
            startConnectionLocked(
                host: activeHost,
                port: activePort,
                requireWiredEthernet: false
            )
            return
        }

        failLocked(
            failedConnection,
            generation: expectedGeneration,
            reason: reason
        )
    }

    private func failLocked(
        _ failedConnection: NWConnection,
        generation expectedGeneration: Int64,
        reason: String
    ) {
        guard
            connectionGeneration == expectedGeneration,
            connection === failedConnection
        else { return }

        connectionGeneration &+= 1
        lastFailureReason = reason
        frameTrace.finishAll(reason: reason, uptime: ProcessInfo.processInfo.systemUptime,
            wallMs: Date().timeIntervalSince1970 * 1_000)
        connection = nil
        failedConnection.stateUpdateHandler = nil
        clearConnectionStateLocked()
        failedConnection.cancel()
        transitionLocked(to: .failed)
    }

    @discardableResult
    func sendOrderedFrame(
        frameId: Int64,
        metadata: String,
        encodedData: Data,
        isKeyframe: Bool = false,
        clock: ClockEstimate? = nil
    ) -> Bool {
        withQueue {
            guard
                internalState == .connected,
                let connection,
                !isSending,
                activeFrameId == nil,
                let record = frameRecord(
                    metadata: metadata,
                    encodedData: encodedData
                ),
                let reservation = frameWindow.insert(
                    frameId: frameId, bytes: record.count,
                    at: ProcessInfo.processInfo.systemUptime
                )
            else { return false }

            isSending = true
            activeFrameId = frameId
            let sendStartedAtUptime = reservation.sentAt
            sendGeneration &+= 1
            let activeSendGeneration = sendGeneration
            let activeConnectionGeneration = connectionGeneration
            frameTrace.begin(frameId: frameId, generation: activeConnectionGeneration,
                bytes: record.count, keyframe: isKeyframe, uptime: sendStartedAtUptime,
                wallMs: Date().timeIntervalSince1970 * 1_000, clock: clock)
            beginFrameAckTimeouts(
                frameId: frameId,
                isKeyframe: isKeyframe,
                payloadBytes: encodedData.count,
                connection: connection,
                connectionGeneration: activeConnectionGeneration
            )
            connection.send(
                content: record,
                completion: .contentProcessed { [weak self, weak connection] error in
                    guard let self, let connection else { return }
                    self.queue.async {
                        guard
                            self.connectionGeneration == activeConnectionGeneration,
                            self.connection === connection,
                            self.sendGeneration == activeSendGeneration
                        else { return }
                        self.isSending = false
                        self.activeFrameId = nil
                        let sendCompletionMs = max(
                            0,
                            (
                                ProcessInfo.processInfo.systemUptime -
                                    sendStartedAtUptime
                            ) * 1_000
                        )
                        self.lastFrameSendCompletionMs = sendCompletionMs
                        self.frameTrace.sent(frameId: frameId, generation: activeConnectionGeneration,
                            elapsedMs: sendCompletionMs)
                        self.maxFrameSendCompletionMs = max(
                            self.maxFrameSendCompletionMs,
                            sendCompletionMs
                        )
                        if let error {
                            self.failLocked(
                                connection,
                                generation: activeConnectionGeneration,
                                reason: "send-error: \(error)"
                            )
                            return
                        }
                    }
                }
            )
            queue.asyncAfter(
                deadline: .now() + sendWatchdogSeconds
            ) { [weak self, weak connection] in
                guard
                    let self,
                    let connection,
                    self.connectionGeneration == activeConnectionGeneration,
                    self.connection === connection,
                    self.isSending,
                    self.sendGeneration == activeSendGeneration
                else { return }
                self.failLocked(
                    connection,
                    generation: activeConnectionGeneration,
                    reason: "send-watchdog"
                )
            }
            return true
        }
    }

    func sendFrame(metadata: String, jpegData: Data) {
        guard
            let data = metadata.data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data)
                as? [String: Any],
            let frameNumber = object["frameId"] as? NSNumber
        else { return }
        _ = sendOrderedFrame(
            frameId: frameNumber.int64Value,
            metadata: metadata,
            encodedData: jpegData
        )
    }

    func canAcceptOrderedFrame() -> Bool {
        withQueue {
            internalState == .connected &&
                !isSending &&
                frameWindow.canAdmit(at: ProcessInfo.processInfo.systemUptime) &&
                activeFrameId == nil
        }
    }

    func frameTransportDiagnosticState() -> LowLatencyFrameTransportDiagnostics {
        withQueue {
            LowLatencyFrameTransportDiagnostics(
                awaitingAck: !frameWindow.entries.isEmpty,
                lastAckMs: lastFrameAckMs,
                maxAckMs: maxFrameAckMs,
                ackCount: frameAckCount,
                ackTimeouts: frameAckTimeoutCount,
                ackSoftTimeouts: frameAckSoftTimeoutCount,
                ackRtoMs: frameAckRTO.timeoutSeconds * 1_000,
                ackArmedRtoMs: lastArmedFrameAckRTOSeconds * 1_000,
                ackHardDeadlineMs:
                    lastArmedFrameAckHardDeadlineSeconds * 1_000,
                ackRtoMinMs: frameAckRTO.minimumSeconds * 1_000,
                ackRtoMaxMs: frameAckRTO.maximumSeconds * 1_000,
                ackHardMaxMs: frameAckRTO.hardMaximumSeconds * 1_000,
                ackSmoothedMs: frameAckRTO.smoothedSeconds.map { $0 * 1_000 },
                ackVariationMs: frameAckRTO.variationSeconds.map { $0 * 1_000 },
                ackRtoBackoff: frameAckRTO.backoffExponent,
                lastFrameWasKeyframe: lastArmedFrameWasKeyframe,
                lastFramePayloadBytes: lastArmedFramePayloadBytes,
                lastSendCompletionMs: lastFrameSendCompletionMs,
                maxSendCompletionMs: maxFrameSendCompletionMs,
                connectionGeneration: connectionGeneration,
                connectTimeouts: connectWatchdogTimeoutCount,
                waitingStates: waitingStateCount,
                lastFailureReason: lastFailureReason,
                routePreference:
                    requestedRoute == .wifiOnly ? "wifi-only" :
                        (prefersWiredEthernet ? "wiredEthernet" : "automatic-fallback"),
                routeUsesWiredEthernet: routeUsesWiredEthernet,
                routeUsesWiFi: routeUsesWiFi,
                routeInterfaces: routeInterfaces,
                wiredEthernetFallbacks: wiredEthernetFallbackCount,
                window: frameWindow.capacity,
                outstandingFrames: frameWindow.entries.count,
                outstandingBytes: frameWindow.outstandingBytes,
                byteLimit: frameWindow.byteLimit,
                oldestOutstandingAgeMs: frameWindow.oldestAge(at: ProcessInfo.processInfo.systemUptime) * 1_000,
                maximumAdmissionAgeMs: frameWindow.maximumAdmissionAge * 1_000,
                traceSamples: frameTrace.unacknowledgedSamples,
                traceLatestRevision: frameTrace.latestRevision,
                traceAcknowledgedRevision: frameTrace.acknowledgedRevision,
                traceDiscardedThroughRevision: frameTrace.discardedThroughRevision,
                traceExportGeneration: frameTrace.exportGeneration
            )
        }
    }

    func resetTraceDelivery() {
        withQueue { frameTrace.resetDelivery() }
    }

    func acknowledgeTraceDelivery(through revision: Int64, generation: Int64) {
        withQueue { frameTrace.acknowledgeDelivery(through: revision, generation: generation) }
    }

    func acknowledgeFrame(frameId: Int64, bridge: [String: Double] = [:]) {
        queue.async { [weak self] in
            self?.acknowledgeFrameLocked(frameId: frameId, path: "pose-fallback", bridge: bridge)
        }
    }

    private func acknowledgeFrameLocked(frameId: Int64, path: String,
                                       bridge: [String: Double], receiveQueueMs: Double? = nil) {
        guard let entry = frameWindow.acknowledge(frameId: frameId) else { return }
        frameTrace.acknowledge(frameId: frameId, uptime: ProcessInfo.processInfo.systemUptime,
            wallMs: Date().timeIntervalSince1970 * 1_000,
            path: path, bridge: bridge, receiveQueueMs: receiveQueueMs)
        let ackSeconds = max(
            0,
            ProcessInfo.processInfo.systemUptime - entry.sentAt
        )
        let ackMs = ackSeconds * 1_000
        lastFrameAckMs = ackMs
        maxFrameAckMs = max(maxFrameAckMs, ackMs)
        frameAckCount += 1
        frameAckRTO.recordAcknowledgement(seconds: ackSeconds)
    }

    private func frameRecord(
        metadata: String,
        encodedData: Data
    ) -> Data? {
        let metadataData = Data(metadata.utf8)
        guard metadataData.count <= Int(UInt32.max) else { return nil }
        let envelopeLength = 8 + metadataData.count + encodedData.count
        guard envelopeLength <= Int(UInt32.max) else { return nil }

        var recordLength = UInt32(envelopeLength).bigEndian
        var metadataLength = UInt32(metadataData.count).bigEndian
        var record = Data(capacity: 4 + envelopeLength)
        withUnsafeBytes(of: &recordLength) { record.append(contentsOf: $0) }
        record.append(contentsOf: [0x50, 0x33, 0x44, 0x31])
        withUnsafeBytes(of: &metadataLength) { record.append(contentsOf: $0) }
        record.append(metadataData)
        record.append(encodedData)
        return record
    }

    private func beginFrameAckTimeouts(
        frameId: Int64,
        isKeyframe: Bool,
        payloadBytes: Int,
        connection: NWConnection,
        connectionGeneration expectedConnectionGeneration: Int64
    ) {
        // Start both deadlines before connection.send(). This measures the
        // complete phone-send-to-bridge-ACK interval and avoids unobservable
        // zero-ms samples when the ACK beats Network.framework's completion.
        guard let reservation = frameWindow.entries[frameId] else { return }
        let generation = reservation.token
        let estimatedRTO = frameAckRTO.timeoutSeconds
        let softTimeout = isKeyframe
            ? max(keyframeMinimumAckRTOSeconds, estimatedRTO)
            : estimatedRTO
        let hardFloor = isKeyframe
            ? keyframeMinimumHardDeadlineSeconds
            : 0
        let hardDeadline = min(
            frameAckRTO.hardMaximumSeconds,
            max(hardFloor, max(softTimeout + 0.25, softTimeout * 1.5))
        )
        lastArmedFrameAckRTOSeconds = softTimeout
        lastArmedFrameAckHardDeadlineSeconds = hardDeadline
        lastArmedFrameWasKeyframe = isKeyframe
        lastArmedFramePayloadBytes = payloadBytes

        queue.asyncAfter(
            deadline: .now() + softTimeout
        ) { [weak self, weak connection] in
            guard
                let self,
                let connection,
                self.connectionGeneration == expectedConnectionGeneration,
                self.connection === connection,
                self.frameWindow.entries[frameId]?.token == generation
            else { return }
            self.frameAckSoftTimeoutCount += 1
            self.frameAckRTO.recordTimeout()
        }

        queue.asyncAfter(
            deadline: .now() + hardDeadline
        ) { [weak self, weak connection] in
            guard
                let self,
                let connection,
                self.connectionGeneration == expectedConnectionGeneration,
                self.connection === connection,
                self.frameWindow.entries[frameId]?.token == generation
            else { return }
            self.frameAckTimeoutCount += 1
            self.frameAckRTO.recordTimeout()
            self.failLocked(
                connection,
                generation: expectedConnectionGeneration,
                reason: "frame-ack-hard-timeout"
            )
        }
    }

    private func receiveNext(
        on connection: NWConnection,
        generation: Int64
    ) {
        connection.receive(
            minimumIncompleteLength: 1,
            maximumLength: 64 * 1024
        ) { [weak self, weak connection] data, _, isComplete, error in
            let callbackUptime = ProcessInfo.processInfo.systemUptime
            guard let self, let connection else { return }
            self.queue.async {
                guard
                    self.connectionGeneration == generation,
                    self.connection === connection
                else { return }
                if let data, !data.isEmpty {
                    self.receiveBuffer.append(data)
                    self.consumeControlRecords(
                        connection: connection,
                        generation: generation,
                        callbackUptime: callbackUptime
                    )
                    // A malformed control record fails and clears the active
                    // connection synchronously. Do not arm another receive on
                    // the now-stale connection from this callback.
                    guard
                        self.connectionGeneration == generation,
                        self.connection === connection
                    else { return }
                }
                if error != nil || isComplete {
                    let reason = error.map { "receive-error: \($0)" }
                        ?? "receive-complete"
                    self.failLocked(
                        connection,
                        generation: generation,
                        reason: reason
                    )
                } else {
                    self.receiveNext(on: connection, generation: generation)
                }
            }
        }
    }

    private func consumeControlRecords(
        connection: NWConnection,
        generation: Int64,
        callbackUptime: Double
    ) {
        while receiveBuffer.count >= 4 {
            // Data is a Collection whose startIndex is not guaranteed to be
            // zero after removeFirst/removeSubrange. Index every header and
            // payload relative to the buffer's current startIndex.
            let headerStart = receiveBuffer.startIndex
            let byte0 = receiveBuffer[headerStart]
            let byte1 = receiveBuffer[
                receiveBuffer.index(headerStart, offsetBy: 1)
            ]
            let byte2 = receiveBuffer[
                receiveBuffer.index(headerStart, offsetBy: 2)
            ]
            let byte3 = receiveBuffer[
                receiveBuffer.index(headerStart, offsetBy: 3)
            ]
            let length =
                (Int(byte0) << 24) |
                (Int(byte1) << 16) |
                (Int(byte2) << 8) |
                Int(byte3)
            guard length > 0, length <= 64 * 1024 else {
                failLocked(
                    connection,
                    generation: generation,
                    reason: "invalid-control-record-length"
                )
                return
            }
            guard receiveBuffer.count >= 4 + length else { return }
            let payloadStart = receiveBuffer.index(
                headerStart,
                offsetBy: 4
            )
            let payloadEnd = receiveBuffer.index(
                payloadStart,
                offsetBy: length
            )
            let payload = Data(receiveBuffer[payloadStart..<payloadEnd])
            receiveBuffer.removeSubrange(headerStart..<payloadEnd)
            handleControl(payload, callbackUptime: callbackUptime)
        }
    }

    private func handleControl(_ data: Data, callbackUptime: Double) {
        guard
            let object = try? JSONSerialization.jsonObject(with: data)
                as? [String: Any],
            let type = object["type"] as? String
        else { return }

        if type == "frame-ack",
           let frameNumber = object["frameId"] as? NSNumber {
            acknowledgeFrameLocked(frameId: frameNumber.int64Value, path: "raw",
                bridge: object.compactMapValues { $0 as? Double },
                receiveQueueMs: (ProcessInfo.processInfo.systemUptime - callbackUptime) * 1_000)
        } else if type == "request-keyframe" {
            let handler = MainQueueCallback(value: keyframeRequestHandler)
            DispatchQueue.main.async {
                handler.value?()
            }
        }
    }
}
