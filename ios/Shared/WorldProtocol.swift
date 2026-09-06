import Foundation
import simd

let worldProtocolVersion = 2
struct MarbleGeometry: Codable {
    let width: Double, height: Double, screenZ: Double, cornerRadius: Double
    let radius: Double, exitHalfWidth: Double, wallHeight: Double, interpolationMs: Double, gravity: Double
    var valid: Bool {
        [width, height, screenZ, cornerRadius, radius, exitHalfWidth, wallHeight, interpolationMs, gravity].allSatisfy(\.isFinite)
        && width > 0 && width < 1 && height > 0 && height < 1 && radius > 0 && radius < 0.1 && interpolationMs == 50
        && cornerRadius > 0 && cornerRadius <= min(width, height) / 2 && exitHalfWidth > 0 && exitHalfWidth < height / 2 && wallHeight > 0 && gravity > 0
    }
}
struct WorldPose: Codable {
    var position: [Double]
    var quaternion: [Double]
    var valid: Bool { WorldMath.vector(position, 3) && WorldMath.vector(quaternion, 4) && abs(sqrt(quaternion.reduce(0) { $0 + $1 * $1 }) - 1) < 0.01 }
}
struct WorldBall: Codable {
    let id: String, state: String
    var position: [Double], quaternion: [Double]
    let velocity: [Double], angularVelocity: [Double], radius: Double
    var pose: WorldPose { get { .init(position: position, quaternion: quaternion) } set { position = newValue.position; quaternion = newValue.quaternion } }
    var valid: Bool { WorldMath.id(id) && ["active", "settling", "rested"].contains(state) && pose.valid && WorldMath.vector(velocity, 3) && WorldMath.vector(angularVelocity, 3) && radius.isFinite && radius > 0 }
}
struct WorldImpact: Codable { let sequence: Int, ballId: String, atMs: Double }
struct WorldSnapshot: Codable {
    let type: String, protocolVersion: Int, worldId: String, epoch: Int, sequence: Int64, serverTimeMs: Double
    let phase: String, reason: String, ownerId: String?, phoneSessionId: String?, phoneConnectionId: String?, source: String?
    let canStart: Bool, canAddBall: Bool, active: Bool, hitCount: Int, region: String
    let activeBallId: String?, lastImpact: WorldImpact?, geometry: MarbleGeometry
    var phone: WorldPose?
    var balls: [WorldBall]
    var activeBall: WorldBall? { balls.first { $0.id == activeBallId } }
    var valid: Bool {
        guard type == "world-snapshot", protocolVersion == worldProtocolVersion, WorldMath.id(worldId), epoch >= 0, sequence >= 0,
              serverTimeMs.isFinite, ["waiting", "ready", "running", "paused", "unsupported"].contains(phase), reason.count <= 512,
              source == nil || source == "arkit" || source == "fixture", hitCount >= 0,
              ["tray", "air", "needs-ball"].contains(region), geometry.valid,
              phone == nil || phone!.valid, balls.count <= 5, Set(balls.map(\.id)).count == balls.count,
              balls.allSatisfy({ $0.valid && $0.radius == geometry.radius }) else { return false }
        for identity in [ownerId, phoneSessionId, phoneConnectionId, activeBallId] { if let identity, !WorldMath.id(identity) { return false } }
        let current = balls.filter { $0.state == "active" }
        if activeBallId == nil ? !current.isEmpty : current.count != 1 || current[0].id != activeBallId { return false }
        if (region == "needs-ball") != (activeBallId == nil) || (canAddBall && activeBallId != nil) { return false }
        if let impact = lastImpact {
            if !WorldMath.id(impact.ballId) || impact.sequence < 1 || impact.sequence != hitCount || !impact.atMs.isFinite { return false }
        } else if hitCount > 0 { return false }
        return phase != "running" || (phone != nil && active)
    }
}
struct WorldCommand: Encodable {
    let type = "world-command", protocolVersion = worldProtocolVersion
    let commandId: String, worldId: String, epoch: Int, action: String
}
struct WorldReceipt: Encodable {
    let type = "world-ack", protocolVersion = worldProtocolVersion
    let worldId: String, sequence: Int64
}
struct MarbleProjection { let local: SIMD3<Double>, radius: Double, marker: SIMD3<Double>, u: Double, v: Double }
enum WorldMath {
    static func id(_ s: String) -> Bool { !s.isEmpty && s.count <= 128 }
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
        // Intersect the sphere with the finite slot [screenZ - radius, screenZ].
        let separation = max(d, -g.radius - d, 0)
        let r = separation >= ball.radius ? 0 : sqrt(ball.radius * ball.radius - separation * separation)
        let marker = (inverse * q(ball.quaternion)).act(SIMD3(0, 0, 1))
        return .init(local: p, radius: r, marker: marker, u: 0.5 + p.x / g.width, v: 0.5 - p.y / g.height)
    }
}

/// Main-thread presentation only. No second simulation and no future prediction.
final class WorldSnapshotBuffer {
    private(set) var worldId: String?, latest: WorldSnapshot?, visual: WorldSnapshot?
    private(set) var needsRestart = false, shouldHaptic = false
    private(set) var receivedAtMs = -Double.infinity
    private var frames: [WorldSnapshot] = []
    private var hapticSequence = 0
    func welcome(_ id: String) {
        if worldId != id { latest = nil; visual = nil; frames = []; needsRestart = false; hapticSequence = 0 }
        worldId = id
    }
    @discardableResult
    func receive(_ s: WorldSnapshot, atMs now: Double, clockOffsetMs: Double?) -> Bool {
        shouldHaptic = false
        guard s.valid, s.worldId == worldId else { return false }
        if let previous = latest, s.epoch < previous.epoch || s.sequence <= previous.sequence { return false }
        let previous = latest, changed = previous?.epoch != s.epoch
        let age = clockOffsetMs.map { now + $0 - s.serverTimeMs }
        let stale = now - receivedAtMs > 250 || age == nil || age! > 250 || age! < -50
        latest = s; receivedAtMs = now
        if changed { frames = []; needsRestart = false; hapticSequence = s.hitCount }
        if (stale && previous?.phase == "running" && !changed) || (age != nil && (age! > 250 || age! < -50)) { needsRestart = true }
        if !needsRestart { frames.append(s); if frames.count > 120 { frames.removeFirst() } }
        if !s.active { visual = s; needsRestart = false }
        return true
    }
    func disconnect() { needsRestart = true; shouldHaptic = false }
    func render(atMs now: Double, clockOffsetMs: Double?) -> WorldSnapshot? {
        shouldHaptic = false
        guard let latest else { return nil }
        if latest.phase == "running", now - receivedAtMs > 250 || clockOffsetMs == nil { needsRestart = true }
        guard latest.phase == "running", !needsRestart, let offset = clockOffsetMs else { return visual ?? latest }
        let target = now + offset - latest.geometry.interpolationMs
        var a: WorldSnapshot?, b = frames.first ?? latest
        for frame in frames { b = frame; if frame.serverTimeMs >= target { break }; a = frame }
        var result = b
        if let a, a.epoch == b.epoch, let pa = a.phone, let pb = b.phone {
            let t = min(1, max(0, (target - a.serverTimeMs) / max(1, b.serverTimeMs - a.serverTimeMs)))
            result = t < 1 ? a : b
            result.phone = WorldMath.interpolate(pa, pb, t)
            result.balls = result.balls.map { ball in
                var value = ball
                if let from = a.balls.first(where: { $0.id == ball.id }), let to = b.balls.first(where: { $0.id == ball.id }) {
                    value.pose = WorldMath.interpolate(from.pose, to.pose, t)
                }
                return value
            }
        }
        if let impact = result.lastImpact, impact.sequence > hapticSequence, target >= impact.atMs {
            hapticSequence = impact.sequence
            shouldHaptic = now + offset - impact.atMs <= 250
        }
        visual = result
        return result
    }
}
