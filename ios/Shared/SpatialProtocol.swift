import Foundation

enum StudioInputMode: String, CaseIterable, Identifiable {
    case spatial = "Spatial tracking"
    case mirroring = "Screen mirroring"
    var id: String { rawValue }
}

/// Invalidates callbacks after stop, backgrounding, or a replacement request.
struct SpatialSessionGate {
    private(set) var generation = 0
    private(set) var requested = false
    private(set) var foreground = true
    mutating func start() -> Int { requested = true; generation += 1; return generation }
    mutating func stop() { requested = false; generation += 1 }
    mutating func setForeground(_ value: Bool) { foreground = value; generation += 1 }
    func accepts(_ candidate: Int) -> Bool { requested && foreground && generation == candidate }
}

struct SpatialMessage: Encodable {
    let source = "arkit"
    let type: String
    let sessionId: String
    let sequence: Int64
    let sampledAtMs: Double
    let trackingState: String
    let reason: String
    let positionMeters: [Float]?
    let quaternion: [Float]?
    let clockOffsetMs: Double?
    let clockRttMs: Double?
}

/// A transport send completion is not a remote receipt. Bound both the opaque
/// transport and the application queue to one message each.
struct SpatialSendWindow {
    struct Packet {
        let sequence: Int64
        let text: String
    }
    private(set) var awaiting: Packet?
    private(set) var latest: Packet?
    private(set) var sentAt: TimeInterval?

    mutating func offer(_ packet: Packet, now: TimeInterval) -> Packet? {
        guard awaiting == nil else { latest = packet; return nil }
        awaiting = packet; sentAt = now
        return packet
    }
    mutating func acknowledge(_ sequence: Int64, now: TimeInterval) -> Packet? {
        guard awaiting?.sequence == sequence else { return nil }
        awaiting = nil; sentAt = nil
        guard let next = latest else { return nil }
        latest = nil
        return offer(next, now: now)
    }
    func expired(now: TimeInterval) -> Bool {
        sentAt.map { now - $0 > 1 } ?? false
    }
}
