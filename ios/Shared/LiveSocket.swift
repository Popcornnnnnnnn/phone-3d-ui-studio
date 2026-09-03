import Foundation

final class LiveSocket: NSObject, URLSessionWebSocketDelegate {
    enum State: String {
        case idle
        case connecting
        case connected
        case failed
    }

    var onStateChange: ((State) -> Void)?
    var onKeyframeRequest: (() -> Void)?
    var onTextMessage: ((String) -> Void)?

    private let outboundQueue = DispatchQueue(label: "Phone3D.LiveSocket.outbound")
    private var controlMessages: [URLSessionWebSocketTask.Message] = []
    private var latestTextMessage: URLSessionWebSocketTask.Message?
    private var latestFrameMessages: [URLSessionWebSocketTask.Message]?
    private var orderedFrameMessages: [[URLSessionWebSocketTask.Message]] = []
    private var activeFrameMessages: [URLSessionWebSocketTask.Message] = []
    private var isSending = false
    private var sendGeneration: Int64 = 0
    private var session: URLSession?
    private var task: URLSessionWebSocketTask?
    private var pendingClockRequests: [Int64: Int64] = [:]
    private var bestClockEstimate: ClockEstimate?
    private var nextClockRequestId: Int64 = 0

    private(set) var state: State = .idle {
        didSet {
            guard state != oldValue else { return }
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.onStateChange?(self.state)
            }
        }
    }

    func connect(to url: URL) {
        disconnect()
        state = .connecting

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

    func disconnect() {
        task?.cancel(with: .goingAway, reason: nil)
        session?.invalidateAndCancel()
        task = nil
        session = nil
        outboundQueue.sync {
            controlMessages.removeAll(keepingCapacity: true)
            latestTextMessage = nil
            latestFrameMessages = nil
            orderedFrameMessages.removeAll(keepingCapacity: true)
            activeFrameMessages.removeAll(keepingCapacity: true)
            pendingClockRequests.removeAll(keepingCapacity: true)
            bestClockEstimate = nil
            isSending = false
            sendGeneration += 1
        }
        state = .idle
    }

    func send(text: String) {
        outboundQueue.async { [weak self] in
            guard let self, self.state == .connected else { return }
            self.latestTextMessage = .string(text)
            self.sendNextIfNeeded()
        }
    }

    /// Sends signaling/control JSON without coalescing. Unlike pose samples,
    /// WebRTC SDP and ICE candidates must stay ordered and may not be dropped.
    func sendControl(text: String) {
        outboundQueue.async { [weak self] in
            guard let self, self.state == .connected else { return }
            self.controlMessages.append(.string(text))
            self.sendNextIfNeeded()
        }
    }

    func sendFrame(metadata: String, jpegData: Data) {
        outboundQueue.async { [weak self] in
            guard let self, self.state == .connected else { return }
            self.latestFrameMessages = [.string(metadata), .data(jpegData)]
            self.sendNextIfNeeded()
        }
    }

    @discardableResult
    func sendOrderedFrame(metadata: String, encodedData: Data) -> Bool {
        outboundQueue.sync {
            guard state == .connected else { return false }

            // H.264 frames depend on earlier frames. Keep at most one complete
            // frame waiting behind the frame currently being sent; a deeper
            // queue only turns temporary Wi-Fi congestion into visible delay.
            guard orderedFrameMessages.count < 1 else { return false }
            orderedFrameMessages.append([
                .string(metadata),
                .data(encodedData)
            ])
            sendNextIfNeeded()
            return true
        }
    }

    func clockEstimate() -> ClockEstimate? {
        outboundQueue.sync { bestClockEstimate }
    }

    private func sendNextIfNeeded() {
        guard !isSending, let task else { return }

        let message: URLSessionWebSocketTask.Message
        if !activeFrameMessages.isEmpty {
            message = activeFrameMessages.removeFirst()
        } else if !controlMessages.isEmpty {
            message = controlMessages.removeFirst()
        } else if let latestTextMessage {
            message = latestTextMessage
            self.latestTextMessage = nil
        } else if !orderedFrameMessages.isEmpty {
            activeFrameMessages = orderedFrameMessages.removeFirst()
            message = activeFrameMessages.removeFirst()
        } else if let latestFrameMessages {
            activeFrameMessages = latestFrameMessages
            self.latestFrameMessages = nil
            message = activeFrameMessages.removeFirst()
        } else {
            return
        }

        isSending = true
        sendGeneration += 1
        let generation = sendGeneration
        task.send(message) { [weak self] error in
            guard let self else { return }
            self.outboundQueue.async {
                guard self.sendGeneration == generation else { return }
                self.isSending = false
                if error != nil {
                    self.controlMessages.removeAll(keepingCapacity: true)
                    self.latestTextMessage = nil
                    self.latestFrameMessages = nil
                    self.orderedFrameMessages.removeAll(keepingCapacity: true)
                    self.activeFrameMessages.removeAll(keepingCapacity: true)
                    self.state = .failed
                    return
                }
                self.sendNextIfNeeded()
            }
        }

        outboundQueue.asyncAfter(deadline: .now() + 2) { [weak self, weak task] in
            guard
                let self,
                let task,
                self.task === task,
                self.isSending,
                self.sendGeneration == generation
            else { return }

            // URLSession can leave a WebSocket send pending even after the
            // Wi-Fi path has silently gone stale. Fail fast so the owner can
            // reconnect instead of accumulating seconds of invisible delay.
            self.sendGeneration += 1
            self.isSending = false
            self.controlMessages.removeAll(keepingCapacity: true)
            self.latestTextMessage = nil
            self.latestFrameMessages = nil
            self.orderedFrameMessages.removeAll(keepingCapacity: true)
            self.activeFrameMessages.removeAll(keepingCapacity: true)
            task.cancel(with: .goingAway, reason: nil)
            self.state = .failed
        }
    }

    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        state = .connected
        receiveNext(on: webSocketTask)
        beginClockSync()
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
        guard task === webSocketTask else { return }
        state = .failed
    }

    private func beginClockSync() {
        outboundQueue.async { [weak self] in
            guard let self else { return }
            self.pendingClockRequests.removeAll(keepingCapacity: true)
            self.bestClockEstimate = nil

            for index in 0..<8 {
                self.outboundQueue.asyncAfter(
                    deadline: .now() + (Double(index) * 0.2)
                ) { [weak self] in
                    self?.sendClockSyncRequest()
                }
            }
        }
    }

    private func sendClockSyncRequest() {
        guard state == .connected else { return }
        nextClockRequestId += 1
        let requestId = nextClockRequestId
        let sentAtMs = LiveProtocol.timestampMs()
        let request = ClockSyncRequest(
            requestId: requestId,
            phoneSendAtMs: sentAtMs
        )
        guard let json = LiveProtocol.json(request) else { return }

        pendingClockRequests[requestId] = sentAtMs
        controlMessages.append(.string(json))
        sendNextIfNeeded()
    }

    private func receiveNext(on receivingTask: URLSessionWebSocketTask) {
        receivingTask.receive { [weak self, weak receivingTask] result in
            guard let self, let receivingTask, self.task === receivingTask else { return }

            switch result {
            case let .success(message):
                if case let .string(text) = message {
                    self.handleIncomingText(text)
                }
                self.receiveNext(on: receivingTask)
            case .failure:
                self.state = .failed
            }
        }
    }

    private func handleIncomingText(_ text: String) {
        if
            let data = text.data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            object["type"] as? String == "request-keyframe"
        {
            DispatchQueue.main.async { [weak self] in
                self?.onKeyframeRequest?()
            }
            return
        }

        guard
            let data = text.data(using: .utf8),
            let reply = try? JSONDecoder().decode(ClockSyncReply.self, from: data),
            reply.type == "clock-sync-reply"
        else {
            DispatchQueue.main.async { [weak self] in
                self?.onTextMessage?(text)
            }
            return
        }

        let receivedAtMs = LiveProtocol.timestampMs()
        outboundQueue.async { [weak self] in
            guard let self else { return }
            let sentAtMs = self.pendingClockRequests.removeValue(
                forKey: reply.requestId
            ) ?? reply.phoneSendAtMs
            let bridgeProcessingMs = max(
                0,
                reply.bridgeSendAtMs - reply.bridgeReceiveAtMs
            )
            let rttMs = max(
                0,
                Double(receivedAtMs - sentAtMs - bridgeProcessingMs)
            )
            let offsetMs = (
                Double(reply.bridgeReceiveAtMs - sentAtMs) +
                Double(reply.bridgeSendAtMs - receivedAtMs)
            ) / 2
            let estimate = ClockEstimate(offsetMs: offsetMs, rttMs: rttMs)

            if self.bestClockEstimate == nil ||
                rttMs < self.bestClockEstimate!.rttMs {
                self.bestClockEstimate = estimate
            }
        }
    }
}
