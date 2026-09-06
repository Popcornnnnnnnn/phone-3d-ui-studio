import Foundation
import simd

struct MarbleGeometry: Codable {
    let width: Double, height: Double, screenZ: Double, cornerRadius: Double
    let radius: Double, exitHalfWidth: Double, wallHeight: Double, interpolationMs: Double, gravity: Double
    var valid: Bool {
        [width, height, screenZ, cornerRadius, radius, exitHalfWidth, wallHeight, interpolationMs, gravity].allSatisfy(\.isFinite)
        && width > 0 && width < 1 && height > 0 && height < 1 && radius > 0 && radius < 0.1 && interpolationMs == 50
    }
}
struct WorldPose: Codable {
    var position: [Double]
    var quaternion: [Double]
    var valid: Bool { WorldMath.vector(position, 3) && WorldMath.vector(quaternion, 4) && abs(sqrt(quaternion.reduce(0) { $0 + $1 * $1 }) - 1) < 0.01 }
}
struct WorldBall: Codable {
    let id: String
    var position: [Double]
    var quaternion: [Double]
    let velocity: [Double], angularVelocity: [Double], radius: Double
    var pose: WorldPose { get { .init(position: position, quaternion: quaternion) } set { position = newValue.position; quaternion = newValue.quaternion } }
    var valid: Bool { id == "marble-1" && pose.valid && WorldMath.vector(velocity, 3) && WorldMath.vector(angularVelocity, 3) && radius.isFinite && radius > 0 }
}
struct WorldSnapshot: Codable {
    let type: String, protocolVersion: Int, worldId: String, epoch: Int, sequence: Int64, serverTimeMs: Double
    let phase: String, reason: String, ownerId: String?, phoneSessionId: String?, phoneConnectionId: String?, source: String?
    let canStart: Bool, canReturn: Bool, active: Bool, catchCount: Int, region: String
    let catchTarget: [Double], geometry: MarbleGeometry
    var phone: WorldPose?
    var ball: WorldBall?
    var valid: Bool {
        type == "world-snapshot" && protocolVersion == 1 && !worldId.isEmpty && worldId.count <= 128 && epoch >= 0 && sequence >= 0
        && serverTimeMs.isFinite && ["waiting", "ready", "running", "paused", "lost", "unsupported"].contains(phase)
        && reason.count <= 512 && (source == nil || source == "arkit" || source == "fixture") && catchCount >= 0
        && ["phone", "world", "returning"].contains(region) && WorldMath.vector(catchTarget, 3) && geometry.valid
        && (phone == nil || phone!.valid) && (ball == nil || (ball!.valid && ball!.radius == geometry.radius))
        && (!["running", "lost"].contains(phase) || (phone != nil && ball != nil))
    }
}
struct WorldCommand: Encodable {
    let type = "world-command", protocolVersion = 1
    let commandId: String, worldId: String, epoch: Int, action: String
}
struct WorldReceipt: Encodable {
    let type = "world-ack", protocolVersion = 1
    let worldId: String, sequence: Int64
}
struct MarbleProjection {
    let local: SIMD3<Double>, radius: Double, marker: SIMD3<Double>, u: Double, v: Double
}
enum WorldMath {
    static func vector(_ a: [Double], _ count: Int) -> Bool { a.count == count && a.allSatisfy(\.isFinite) }
    static func v(_ a: [Double]) -> SIMD3<Double> { SIMD3(a[0], a[1], a[2]) }
    static func q(_ a: [Double]) -> simd_quatd { simd_quatd(ix: a[0], iy: a[1], iz: a[2], r: a[3]) }
    static func array(_ v: SIMD3<Double>) -> [Double] { [v.x, v.y, v.z] }
    static func interpolate(_ a: WorldPose, _ b: WorldPose, _ t: Double) -> WorldPose {
        let p = v(a.position) + (v(b.position) - v(a.position)) * t
        let rotation = simd_slerp(q(a.quaternion), q(b.quaternion), t)
        return .init(position: array(p), quaternion: [rotation.imag.x, rotation.imag.y, rotation.imag.z, rotation.real])
    }
    static func projection(_ ball: WorldBall, _ phone: WorldPose, _ g: MarbleGeometry) -> MarbleProjection {
        let inverse = q(phone.quaternion).inverse
        let p = inverse.act(v(ball.position) - v(phone.position)), d = p.z - g.screenZ
        let r = d >= ball.radius ? 0 : d <= 0 ? ball.radius : sqrt(ball.radius * ball.radius - d * d)
        let marker = (inverse * q(ball.quaternion)).act(SIMD3(0, 0, 1))
        return .init(local: p, radius: r, marker: marker, u: 0.5 + p.x / g.width, v: 0.5 - p.y / g.height)
    }
}

/// Main-thread buffer only; it never simulates physics or predicts future motion.
final class WorldSnapshotBuffer {
    private(set) var worldId: String?
    private(set) var latest: WorldSnapshot?
    private(set) var visual: WorldSnapshot?
    private(set) var needsRestart = false
    private(set) var receivedAtMs = -Double.infinity
    private var frames: [WorldSnapshot] = []
    private(set) var shouldHaptic = false
    func welcome(_ id: String) {
        if worldId != id { latest = nil; visual = nil; frames = []; needsRestart = false }
        worldId = id
    }
    @discardableResult
    func receive(_ s: WorldSnapshot, atMs now: Double, clockOffsetMs: Double?) -> Bool {
        shouldHaptic = false
        guard s.valid, s.worldId == worldId else { return false }
        if let previous = latest, s.epoch < previous.epoch || s.sequence <= previous.sequence { return false }
        let previous = latest
        let changed = previous?.epoch != s.epoch
        let age = clockOffsetMs.map { now + $0 - s.serverTimeMs }
        let stale = now - receivedAtMs > 250 || age == nil || age! > 250 || age! < -50
        latest = s; receivedAtMs = now
        if changed { frames = []; needsRestart = false }
        if (stale && previous?.phase == "running" && !changed) || (age != nil && (age! > 250 || age! < -50)) { needsRestart = true }
        if !needsRestart { frames.append(s); if frames.count > 120 { frames.removeFirst() } }
        if !s.active { visual = s }
        shouldHaptic = !needsRestart && !stale && !changed && s.phase == "running" && s.catchCount > (previous?.catchCount ?? s.catchCount)
        return true
    }
    func disconnect() { needsRestart = true }
    func render(atMs now: Double, clockOffsetMs: Double?) -> WorldSnapshot? {
        guard let latest else { return nil }
        if latest.phase == "running", now - receivedAtMs > 250 { needsRestart = true }
        if latest.phase == "running", clockOffsetMs == nil { needsRestart = true }
        guard latest.phase == "running", !needsRestart, let offset = clockOffsetMs else { return visual ?? latest }
        let target = now + offset - latest.geometry.interpolationMs
        var a: WorldSnapshot?, b = frames.first ?? latest
        for frame in frames { b = frame; if frame.serverTimeMs >= target { break }; a = frame }
        if let a, a.epoch == b.epoch, let pa = a.phone, let pb = b.phone, let ba = a.ball, let bb = b.ball {
            let t = min(1, max(0, (target - a.serverTimeMs) / max(1, b.serverTimeMs - a.serverTimeMs)))
            b.phone = WorldMath.interpolate(pa, pb, t)
            b.ball?.pose = WorldMath.interpolate(ba.pose, bb.pose, t)
        }
        visual = b
        return b
    }
}
