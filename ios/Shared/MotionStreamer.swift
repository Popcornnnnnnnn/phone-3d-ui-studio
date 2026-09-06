import CoreMotion
import Foundation

final class MotionStreamer {
    private static let standardHz = 60.0
    private static let maximumRequestedHz = 240.0
    private let manager = CMMotionManager()
    private let queue: OperationQueue = {
        let queue = OperationQueue()
        queue.name = "Phone3D.Motion"
        queue.maxConcurrentOperationCount = 1
        queue.qualityOfService = .userInteractive
        return queue
    }()
    private let socket: LiveSocket
    private let producerSessionId: String
    private let captureSource: String
    private let configurationLock = NSLock()
    private var requestedHz = MotionStreamer.standardHz
    private var lastMotionTimestamp: TimeInterval?

    init(
        socket: LiveSocket,
        producerSessionId: String,
        captureSource: String
    ) {
        self.socket = socket
        self.producerSessionId = producerSessionId
        self.captureSource = captureSource
    }

    func start() {
        guard manager.isDeviceMotionAvailable else { return }
        let activeRequestedHz = configurationLock.withLock { requestedHz }
        lastMotionTimestamp = nil
        manager.deviceMotionUpdateInterval = 1.0 / activeRequestedHz
        manager.startDeviceMotionUpdates(
            using: .xArbitraryZVertical,
            to: queue
        ) { [weak self] motion, _ in
            guard let self, let motion else { return }
            let quaternion = motion.attitude.quaternion
            let rotationRate = motion.rotationRate
            let sampleIntervalMs = self.lastMotionTimestamp.map {
                max(0, (motion.timestamp - $0) * 1_000)
            }
            self.lastMotionTimestamp = motion.timestamp
            let requestedHz = self.configurationLock.withLock {
                self.requestedHz
            }
            let callbackAtMs = LiveProtocol.timestampMs()
            let sampleAgeMs = max(
                0,
                (ProcessInfo.processInfo.systemUptime - motion.timestamp) * 1_000
            )
            let sampledAtMs = callbackAtMs - Int64(sampleAgeMs.rounded())
            let clock = self.socket.clockEstimate()
            let message = PoseMessage(
                producerSessionId: self.producerSessionId,
                captureSource: self.captureSource,
                timestampMs: sampledAtMs,
                quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
                rotationRate: [rotationRate.x, rotationRate.y, rotationRate.z],
                requestedHz: requestedHz,
                sampleIntervalMs: sampleIntervalMs,
                clockOffsetMs: clock?.offsetMs,
                clockRttMs: clock?.rttMs
            )
            guard let json = LiveProtocol.json(message) else { return }
            self.socket.send(text: json)
        }
    }

    func setPresentationMode(_ mode: String, requestedHz: Double?) {
        let nextHz: Double
        if mode == "ultra" {
            nextHz = min(
                max(requestedHz ?? Self.maximumRequestedHz, Self.standardHz),
                Self.maximumRequestedHz
            )
        } else {
            nextHz = Self.standardHz
        }

        configurationLock.withLock {
            self.requestedHz = nextHz
        }
        queue.addOperation { [weak self] in
            guard let self else { return }
            self.lastMotionTimestamp = nil
            self.manager.deviceMotionUpdateInterval = 1.0 / nextHz
        }
    }

    func stop() {
        manager.stopDeviceMotionUpdates()
        queue.cancelAllOperations()
    }
}
