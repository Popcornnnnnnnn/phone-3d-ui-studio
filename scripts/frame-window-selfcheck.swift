// Integration check of the real NWConnection sender and length-prefixed ACKs.
// Loopback plus synthetic delayed/reordered ACKs is not a Wi-Fi benchmark.
import Foundation
import Network

final class DelayedACKServer: @unchecked Sendable {
    let queue = DispatchQueue(label: "FrameWindowCheck.server")
    let listener: NWListener
    private var received = 0
    private var boundPort: UInt16?
    private var connections: [NWConnection] = []

    init() throws {
        listener = try NWListener(using: .tcp, on: .any)
        listener.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            if case .ready = state { self.boundPort = self.listener.port?.rawValue }
            if case let .failed(error) = state {
                FileHandle.standardError.write(Data("Listener failed: \(error)\n".utf8))
            }
        }
        listener.newConnectionHandler = { [weak self] connection in
            guard let self else { return }
            self.connections.append(connection)
            connection.start(queue: self.queue)
            self.receive(connection, accumulated: Data())
        }
        listener.start(queue: queue)
    }
    var port: UInt16? { queue.sync { boundPort } }
    var receivedCount: Int { queue.sync { received } }
    func stop() { queue.sync { listener.cancel(); connections.forEach { $0.cancel() } } }

    private func integer(_ data: Data) -> Int { data.reduce(0) { ($0 << 8) | Int($1) } }
    private func receive(_ connection: NWConnection, accumulated: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] data, _, complete, error in
            guard let self else { return }
            var buffer = accumulated
            if let data { buffer.append(data) }
            while buffer.count >= 4 {
                let length = self.integer(Data(buffer.prefix(4)))
                guard length > 8, length < 2_100_000 else { preconditionFailure("Invalid frame framing") }
                if buffer.count < 4 + length { break }
                let record = Data(buffer.dropFirst(4).prefix(length))
                buffer = Data(buffer.dropFirst(4 + length))
                precondition(Data(record.prefix(4)) == Data("P3D1".utf8))
                let metadataLength = self.integer(Data(record.dropFirst(4).prefix(4)))
                let metadata = try! JSONSerialization.jsonObject(with: Data(record.dropFirst(8).prefix(metadataLength))) as! [String: Any]
                let id = (metadata["frameId"] as! NSNumber).int64Value
                self.received += 1
                // Alternate delays so ACK order differs from frame order.
                self.queue.asyncAfter(deadline: .now() + (id % 2 == 0 ? 0.065 : 0.025)) {
                    let json = try! JSONSerialization.data(withJSONObject: ["type": "frame-ack", "frameId": id])
                    var size = UInt32(json.count).bigEndian
                    var packet = Data()
                    withUnsafeBytes(of: &size) { packet.append(contentsOf: $0) }
                    packet.append(json)
                    connection.send(content: packet, completion: .contentProcessed { _ in })
                    // Duplicate ACK must not release a different in-flight frame.
                    connection.send(content: packet, completion: .contentProcessed { _ in })
                }
            }
            if !complete && error == nil { self.receive(connection, accumulated: buffer) }
        }
    }
}

@main struct FrameWindowSelfCheck {
    static func wait(_ condition: () -> Bool, seconds: Double) {
        let deadline = ProcessInfo.processInfo.systemUptime + seconds
        while !condition() && ProcessInfo.processInfo.systemUptime < deadline { Thread.sleep(forTimeInterval: 0.005) }
        precondition(condition(), "Bounded integration wait failed")
    }
    static func main() throws {
        for capacity in 1...3 {
            let server = try DelayedACKServer()
            defer { server.stop() }
            wait({ server.port != nil }, seconds: 2)
            let socket = LowLatencyFrameSocket()
            // Loopback uses the existing automatic fallback, never a device route.
            precondition(socket.configure(route: .wiredPreferred, window: capacity))
            socket.connect(to: URL(string: "ws://127.0.0.1:\(Int(server.port!) - 1)/")!)
            defer { socket.disconnect() }
            wait({ socket.state == .connected }, seconds: 3)
            var admitted = 0
            var maximumOutstanding = 0
            for id: Int64 in 1...90 {
                if socket.canAcceptOrderedFrame() {
                    if socket.sendOrderedFrame(frameId: id, metadata: "{\"frameId\":\(id)}", encodedData: Data(repeating: 1, count: 256)) {
                        admitted += 1
                    }
                }
                let state = socket.frameTransportDiagnosticState()
                maximumOutstanding = max(maximumOutstanding, state.outstandingFrames)
                precondition(state.outstandingFrames <= capacity)
                Thread.sleep(forTimeInterval: 0.008)
            }
            wait({ socket.frameTransportDiagnosticState().outstandingFrames == 0 }, seconds: 1)
            let state = socket.frameTransportDiagnosticState()
            precondition(state.ackCount == Int64(admitted) && server.receivedCount == admitted)
            precondition(state.ackTimeouts == 0 && maximumOutstanding == capacity)
            print("PASS window=\(capacity), admitted=\(admitted), max outstanding=\(maximumOutstanding), duplicate/reordered ACK accounting intact")
        }
    }
}
