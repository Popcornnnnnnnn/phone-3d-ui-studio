import CoreMotion
import Foundation

final class MotionStreamer {
    private let manager = CMMotionManager()
    private let queue: OperationQueue = {
        let queue = OperationQueue()
        queue.name = "Phone3D.Motion"
        queue.maxConcurrentOperationCount = 1
        queue.qualityOfService = .userInteractive
        return queue
    }()
    private let socket: LiveSocket

    init(socket: LiveSocket) {
        self.socket = socket
    }

    func start() {
        guard manager.isDeviceMotionAvailable else { return }
        manager.deviceMotionUpdateInterval = 1.0 / 60.0
        manager.startDeviceMotionUpdates(
            using: .xArbitraryZVertical,
            to: queue
        ) { [weak self] motion, _ in
            guard let self, let motion else { return }
            let quaternion = motion.attitude.quaternion
            let callbackAtMs = LiveProtocol.timestampMs()
            let sampleAgeMs = max(
                0,
                (ProcessInfo.processInfo.systemUptime - motion.timestamp) * 1_000
            )
            let sampledAtMs = callbackAtMs - Int64(sampleAgeMs.rounded())
            let clock = self.socket.clockEstimate()
            let message = PoseMessage(
                timestampMs: sampledAtMs,
                quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
                clockOffsetMs: clock?.offsetMs,
                clockRttMs: clock?.rttMs
            )
            guard let json = LiveProtocol.json(message) else { return }
            self.socket.send(text: json)
        }
    }

    func stop() {
        manager.stopDeviceMotionUpdates()
        queue.cancelAllOperations()
    }
}
