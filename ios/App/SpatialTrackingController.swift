import ARKit
import AVFoundation
import Combine
import Foundation
import UIKit

/// All lifecycle and AR delegate callbacks are serialized on the main queue.
final class SpatialTrackingController: NSObject, ObservableObject, ARSessionDelegate {
    @Published private(set) var running = false
    @Published private(set) var connection = "Disconnected"
    @Published private(set) var trackingState = "initializing"
    @Published private(set) var guidance = "Hold the phone above a textured surface. The camera stays on this device."
    @Published private(set) var cameraPosition: [Float] = [0, 0, 0]
    @Published private(set) var sentFrames: Int64 = 0
    private let socket = LiveSocket()
    private var session: ARSession?
    private var sessionId = UUID().uuidString
    private var gate = SpatialSessionGate()
    private var sequence: Int64 = 0
    private var lastFrameAt: TimeInterval = -.infinity
    private var lastUIAt: TimeInterval = -.infinity
    private var reconnect: DispatchWorkItem?
    private var connectTimeout: DispatchWorkItem?
    private var reconnectAttempt = 0
    private var statusTimer: Timer?
    private var sendWindow = SpatialSendWindow()
    private var previousIdleTimerDisabled: Bool?

    override init() {
        super.init()
        socket.onStateChange = { [weak self] state in
            guard let self else { return }
            self.connection = state.rawValue.capitalized
            if state != .connecting { self.connectTimeout?.cancel() }
            if state == .connected {
                self.reconnectAttempt = 0
                self.sendWindow = SpatialSendWindow()
                self.sendStatus()
            } else if state == .failed, self.gate.requested && self.gate.foreground {
                self.scheduleReconnect()
            }
        }
        socket.onTextMessage = { [weak self] text in
            guard let self, let data = text.data(using: .utf8),
                  let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  value["type"] as? String == "spatial-ack",
                  value["sessionId"] as? String == self.sessionId,
                  let sequence = value["sequence"] as? NSNumber else { return }
            if let next = self.sendWindow.acknowledge(sequence.int64Value, now: ProcessInfo.processInfo.systemUptime) {
                self.socket.send(text: next.text)
            }
        }
    }

    func start() {
        guard !gate.requested else { return }
        let generation = gate.start()
        begin(generation)
    }

    private func begin(_ generation: Int) {
        guard gate.accepts(generation) else { return }
        sessionId = UUID().uuidString; sequence = 0; sentFrames = 0
        trackingState = "initializing"; guidance = "Allow the camera, then slowly move above a textured surface."
        lastFrameAt = -.infinity; lastUIAt = -.infinity
        connect()
        statusTimer?.invalidate()
        statusTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.sendStatus() }
        guard ARWorldTrackingConfiguration.isSupported else {
            fail("unsupported", "World tracking is not supported on this device.")
            return
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: runSession(generation)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] allowed in
                DispatchQueue.main.async {
                    guard let self, self.gate.accepts(generation) else { return }
                    if allowed { self.runSession(generation) }
                    else { self.fail("denied", "Enable Camera for Phone 3D Studio in Settings, then stop and start tracking.") }
                }
            }
        default: fail("denied", "Enable Camera for Phone 3D Studio in Settings, then stop and start tracking.")
        }
    }

    private func runSession(_ generation: Int) {
        guard gate.accepts(generation) else { return }
        let configuration = ARWorldTrackingConfiguration()
        configuration.worldAlignment = .gravity
        let next = ARSession()
        next.delegate = self
        next.delegateQueue = .main
        session = next
        previousIdleTimerDisabled = UIApplication.shared.isIdleTimerDisabled
        UIApplication.shared.isIdleTimerDisabled = true
        next.run(configuration)
        running = true
    }

    private func connect() {
        guard gate.requested && gate.foreground,
              let value = Bundle.main.object(forInfoDictionaryKey: "LiveBridgeURL") as? String,
              var url = URLComponents(string: value) else {
            connection = "Invalid bridge URL"
            return
        }
        url.queryItems = [
            URLQueryItem(name: "role", value: "phone-spatial"),
            URLQueryItem(name: "sessionId", value: sessionId)
        ]
        guard let endpoint = url.url else { return }
        socket.connect(to: endpoint)
        let generation = gate.generation
        let timeout = DispatchWorkItem { [weak self] in
            guard let self, self.gate.accepts(generation), self.socket.state != .connected else { return }
            self.socket.disconnect()
            self.connection = "Connection timed out"
            self.scheduleReconnect()
        }
        connectTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 8, execute: timeout)
    }

    private func scheduleReconnect() {
        reconnect?.cancel()
        let generation = gate.generation
        let delay = min(0.5 * pow(2, Double(min(reconnectAttempt, 4))), 5)
        reconnectAttempt += 1
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.gate.accepts(generation) else { return }
            self.connect()
        }
        reconnect = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    private func releaseResources() {
        running = false
        session?.pause(); session?.delegate = nil; session = nil
        reconnect?.cancel(); reconnect = nil
        connectTimeout?.cancel(); connectTimeout = nil
        statusTimer?.invalidate(); statusTimer = nil
        sendWindow = SpatialSendWindow()
        socket.disconnect()
        restoreIdleTimer()
    }

    private func restoreIdleTimer() {
        if let previousIdleTimerDisabled {
            UIApplication.shared.isIdleTimerDisabled = previousIdleTimerDisabled
            self.previousIdleTimerDisabled = nil
        }
    }

    func stop() {
        gate.stop()
        releaseResources()
        trackingState = "paused"; guidance = "Tracking stopped. Tap Start tracking when ready."
    }

    func updateForeground(_ active: Bool) {
        guard gate.foreground != active else { return }
        gate.setForeground(active)
        releaseResources()
        if active && gate.requested { begin(gate.generation) }
        else {
            trackingState = "paused"
            guidance = active ? "Tap Start tracking when ready." : "Tracking pauses while this app is in the background."
        }
    }

    var requested: Bool { gate.requested }

    private func fail(_ state: String, _ reason: String) {
        session?.pause(); session = nil; running = false
        restoreIdleTimer()
        trackingState = state; guidance = reason
        sendStatus()
    }

    private func sendStatus() {
        guard gate.requested && gate.foreground else { return }
        send(type: "spatial-status", sampledAtMs: Date().timeIntervalSince1970 * 1000)
    }

    private func send(type: String, sampledAtMs: Double, position: [Float]? = nil, rotation: [Float]? = nil) {
        guard socket.state == .connected else { return }
        let now = ProcessInfo.processInfo.systemUptime
        if sendWindow.expired(now: now) {
            sendWindow = SpatialSendWindow()
            socket.disconnect()
            connection = "Tracking link timed out"
            scheduleReconnect()
            return
        }
        sequence += 1
        let clock = socket.clockEstimate()
        let message = SpatialMessage(
            type: type, sessionId: sessionId, sequence: sequence, sampledAtMs: sampledAtMs,
            trackingState: trackingState, reason: guidance, positionMeters: position, quaternion: rotation,
            clockOffsetMs: clock?.offsetMs, clockRttMs: clock?.rttMs
        )
        guard let data = try? JSONEncoder().encode(message), let text = String(data: data, encoding: .utf8) else { return }
        if let packet = sendWindow.offer(.init(sequence: sequence, text: text), now: now) {
            socket.send(text: packet.text)
        }
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        guard self.session === session, gate.requested, gate.foreground else { return }
        let state: String
        let reason: String
        switch frame.camera.trackingState {
        case .normal:
            state = "normal"; reason = "Tracking ready. Set origin in the Web workspace."
        case .notAvailable:
            state = "unavailable"; reason = "Tracking unavailable. Keep the rear camera unobstructed."
        case .limited(let limitation):
            state = "limited"
            switch limitation {
            case .initializing: reason = "Move slowly above a textured surface while tracking starts."
            case .excessiveMotion: reason = "Move more slowly and keep the rear camera unobstructed."
            case .insufficientFeatures: reason = "Point the rear camera at a well-lit, textured surface."
            case .relocalizing: reason = "Re-establishing position. Set origin again once tracking is ready."
            @unknown default: reason = "Tracking is limited. Move slowly over a textured surface."
            }
        }
        let changed = trackingState != state || guidance != reason
        if changed { trackingState = state; guidance = reason; sendStatus() }
        guard frame.timestamp - lastFrameAt >= 1.0 / 60.0 else { return }
        lastFrameAt = frame.timestamp
        let transform = frame.camera.transform
        let p = transform.columns.3
        let q = simd_quatf(transform)
        let sampledAtMs = Date().timeIntervalSince1970 * 1000 -
            max(0, ProcessInfo.processInfo.systemUptime - frame.timestamp) * 1000
        send(type: "spatial-pose", sampledAtMs: sampledAtMs, position: [p.x, p.y, p.z],
             rotation: [q.imag.x, q.imag.y, q.imag.z, q.real])
        if frame.timestamp - lastUIAt >= 0.1 {
            cameraPosition = [p.x, p.y, p.z]; sentFrames = sequence; lastUIAt = frame.timestamp
        }
    }

    func sessionWasInterrupted(_ session: ARSession) {
        guard self.session === session else { return }
        trackingState = "paused"; guidance = "Camera interrupted. Keep this app in the foreground."
        sendStatus()
    }
    func sessionInterruptionEnded(_ session: ARSession) {
        guard self.session === session, gate.requested, gate.foreground else { return }
        releaseResources()
        begin(gate.start())
    }
    func session(_ session: ARSession, didFailWithError error: Error) {
        guard self.session === session else { return }
        fail("error", "Tracking failed: \(error.localizedDescription). Stop and start tracking to retry.")
    }
}
