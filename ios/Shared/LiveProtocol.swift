import Foundation

struct PoseMessage: Encodable {
    let type = "pose"
    let timestampMs: Int64
    let quaternion: [Double]
    let rotationRate: [Double]
    let requestedHz: Double
    let sampleIntervalMs: Double?
    let clockOffsetMs: Double?
    let clockRttMs: Double?
}

struct PoseModeCommand: Decodable {
    let type: String
    let mode: String
    let requestedHz: Double?
}

struct FrameMetadataMessage: Encodable {
    let type = "frame-meta"
    let frameId: Int64
    let timestampMs: Int64
    let captureAtMs: Int64
    let callbackAtMs: Int64
    let encodeStartedAtMs: Int64
    let encodedAtMs: Int64
    let width: Int
    let height: Int
    let orientation: String
    let jpegBytes: Int
    let codec: String
    let isKeyframe: Bool?
    let clockOffsetMs: Double?
    let clockRttMs: Double?
}

enum ScreenCodec: String, CaseIterable, Identifiable {
    case jpeg = "JPEG"
    case h264 = "H.264"
    case webrtc = "WebRTC"

    var id: String { rawValue }
}

struct ClockSyncRequest: Encodable {
    let type = "clock-sync"
    let requestId: Int64
    let phoneSendAtMs: Int64
}

struct ClockSyncReply: Decodable {
    let type: String
    let requestId: Int64
    let phoneSendAtMs: Int64
    let bridgeReceiveAtMs: Int64
    let bridgeSendAtMs: Int64
}

struct ClockEstimate {
    let offsetMs: Double
    let rttMs: Double
}

enum LiveProtocol {
    static func timestampMs() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1_000)
    }

    static func json<T: Encodable>(_ value: T) -> String? {
        guard let data = try? JSONEncoder().encode(value) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
