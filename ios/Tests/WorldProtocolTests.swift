import XCTest
@testable import Phone3DClockSync

final class WorldProtocolTests: XCTestCase {
    struct Expected: Decodable { let u: Double, v: Double, radius: Double }
    struct Fixture: Decodable { let name: String, snapshot: WorldSnapshot, expected: Expected }
    func fixtures() throws -> [Fixture] {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try JSONDecoder().decode([Fixture].self, from: Data(contentsOf: root.appendingPathComponent("shared/fixtures/marble-frames.json")))
    }
    func altered(_ base: WorldSnapshot, _ fields: [String: Any]) throws -> WorldSnapshot {
        var value = try JSONSerialization.jsonObject(with: JSONEncoder().encode(base)) as! [String: Any]
        for (key, field) in fields { value[key] = field }
        return try JSONDecoder().decode(WorldSnapshot.self, from: JSONSerialization.data(withJSONObject: value))
    }
    func testProjectionMatchesWebIncludingScreenBoundaryAndPartialEntry() throws {
        for f in try fixtures() {
            XCTAssertTrue(f.snapshot.valid)
            let p = WorldMath.projection(f.snapshot.ball!, f.snapshot.phone!, f.snapshot.geometry)
            XCTAssertEqual(p.u, f.expected.u, accuracy: 1e-8, f.name)
            XCTAssertEqual(p.v, f.expected.v, accuracy: 1e-8, f.name)
            XCTAssertEqual(p.radius, f.expected.radius, accuracy: 1e-8, f.name)
        }
    }
    func testFiftyMillisecondInterpolationUsesSamePhoneAndBallTime() throws {
        let a = try fixtures()[0].snapshot
        var b = try altered(a, ["sequence": 2, "serverTimeMs": 1100])
        b.ball?.position[0] = 0.02; b.phone?.position[0] = 0.01
        let buffer = WorldSnapshotBuffer(); buffer.welcome(a.worldId)
        buffer.receive(a, atMs: 1000, clockOffsetMs: 0); buffer.receive(b, atMs: 1100, clockOffsetMs: 0)
        let result = buffer.render(atMs: 1100, clockOffsetMs: 0)!
        XCTAssertEqual(result.ball!.position[0], 0.01, accuracy: 1e-8)
        XCTAssertEqual(result.phone!.position[0], 0.005, accuracy: 1e-8)
        XCTAssertEqual(buffer.render(atMs: 1200, clockOffsetMs: 0)!.ball!.position[0], 0.02, accuracy: 1e-8)
    }
    func testRejectsOldWorldsEpochsAndSequences() throws {
        let a = try fixtures()[0].snapshot, buffer = WorldSnapshotBuffer(); buffer.welcome(a.worldId)
        XCTAssertTrue(buffer.receive(a, atMs: 1000, clockOffsetMs: 0))
        XCTAssertFalse(buffer.receive(a, atMs: 1001, clockOffsetMs: 0))
        XCTAssertFalse(buffer.receive(try altered(a, ["worldId": "old", "sequence": 2]), atMs: 1001, clockOffsetMs: 0))
        XCTAssertFalse(buffer.receive(try altered(a, ["epoch": 0, "sequence": 2]), atMs: 1001, clockOffsetMs: 0))
    }
    func testStalenessFreezesAndDoesNotAcceptCatchUpJump() throws {
        let a = try fixtures()[0].snapshot, buffer = WorldSnapshotBuffer(); buffer.welcome(a.worldId)
        buffer.receive(a, atMs: 1000, clockOffsetMs: 0); _ = buffer.render(atMs: 1050, clockOffsetMs: 0)
        var b = try altered(a, ["sequence": 2, "serverTimeMs": 1300]); b.ball?.position[0] = 0.2
        buffer.receive(b, atMs: 1300, clockOffsetMs: 0)
        XCTAssertTrue(buffer.needsRestart)
        XCTAssertEqual(buffer.render(atMs: 1300, clockOffsetMs: 0)!.ball!.position[0], 0)
        buffer.receive(try altered(b, ["sequence": 3, "epoch": 2, "serverTimeMs": 1350]), atMs: 1350, clockOffsetMs: 0)
        XCTAssertFalse(buffer.needsRestart)
    }
    func testClockUnavailableFreezesAndCatchHapticIsNotReplayed() throws {
        let a = try fixtures()[0].snapshot, buffer = WorldSnapshotBuffer(); buffer.welcome(a.worldId)
        buffer.receive(a, atMs: 1000, clockOffsetMs: 0)
        XCTAssertFalse(buffer.shouldHaptic)
        let caught = try altered(a, ["sequence": 2, "serverTimeMs": 1017, "catchCount": 1])
        buffer.receive(caught, atMs: 1017, clockOffsetMs: 0); XCTAssertTrue(buffer.shouldHaptic)
        buffer.receive(caught, atMs: 1018, clockOffsetMs: 0); XCTAssertFalse(buffer.shouldHaptic)
        _ = buffer.render(atMs: 1020, clockOffsetMs: nil); XCTAssertTrue(buffer.needsRestart)
    }
    func testRejectsInvalidGeometryAndRotation() throws {
        var a = try fixtures()[0].snapshot; a.phone?.quaternion = [0, 0, 0, 0]
        XCTAssertFalse(a.valid)
        a = try altered(try fixtures()[0].snapshot, ["epoch": -1]); XCTAssertFalse(a.valid)
    }
}
