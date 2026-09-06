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
            let p = WorldMath.projection(f.snapshot.balls[0], f.snapshot.phone!, f.snapshot.geometry)
            XCTAssertEqual(p.u, f.expected.u, accuracy: 1e-8, f.name)
            XCTAssertEqual(p.v, f.expected.v, accuracy: 1e-8, f.name)
            XCTAssertEqual(p.radius, f.expected.radius, accuracy: 1e-8, f.name)
        }
    }
    func testFiftyMillisecondInterpolationUsesSamePhoneAndBallTime() throws {
        let a = try fixtures()[0].snapshot
        var b = try altered(a, ["sequence": 2, "serverTimeMs": 1100])
        b.balls[0].position[0] = 0.02; b.phone?.position[0] = 0.01
        let buffer = WorldSnapshotBuffer(); buffer.welcome(a.worldId)
        buffer.receive(a, atMs: 1000, clockOffsetMs: 0); buffer.receive(b, atMs: 1100, clockOffsetMs: 0)
        let result = buffer.render(atMs: 1100, clockOffsetMs: 0)!
        XCTAssertEqual(result.balls[0].position[0], 0.01, accuracy: 1e-8)
        XCTAssertEqual(result.phone!.position[0], 0.005, accuracy: 1e-8)
        XCTAssertEqual(buffer.render(atMs: 1200, clockOffsetMs: 0)!.balls[0].position[0], 0.02, accuracy: 1e-8)
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
        var b = try altered(a, ["sequence": 2, "serverTimeMs": 1300]); b.balls[0].position[0] = 0.2
        buffer.receive(b, atMs: 1300, clockOffsetMs: 0)
        XCTAssertTrue(buffer.needsRestart)
        XCTAssertEqual(buffer.render(atMs: 1300, clockOffsetMs: 0)!.balls[0].position[0], 0)
        buffer.receive(try altered(b, ["sequence": 3, "epoch": 2, "serverTimeMs": 1350]), atMs: 1350, clockOffsetMs: 0)
        XCTAssertFalse(buffer.needsRestart)
    }
    func testImpactHapticOccursAtPresentationTimeOnlyOnce() throws {
        let a = try fixtures()[0].snapshot, buffer = WorldSnapshotBuffer(); buffer.welcome(a.worldId)
        buffer.receive(a, atMs: 1000, clockOffsetMs: 0)
        let hit = try altered(a, ["sequence": 2, "serverTimeMs": 1017, "hitCount": 1,
            "lastImpact": ["sequence": 1, "ballId": a.balls[0].id, "atMs": 1017]])
        buffer.receive(hit, atMs: 1017, clockOffsetMs: 0); XCTAssertFalse(buffer.shouldHaptic)
        _ = buffer.render(atMs: 1050, clockOffsetMs: 0); XCTAssertFalse(buffer.shouldHaptic)
        _ = buffer.render(atMs: 1067, clockOffsetMs: 0); XCTAssertTrue(buffer.shouldHaptic)
        _ = buffer.render(atMs: 1068, clockOffsetMs: 0); XCTAssertFalse(buffer.shouldHaptic)
        XCTAssertFalse(buffer.receive(hit, atMs: 1069, clockOffsetMs: 0))
        _ = buffer.render(atMs: 1070, clockOffsetMs: nil); XCTAssertTrue(buffer.needsRestart)
    }
    func testBirthAndRetirementArePresentedByIdentityAtTheirSampleTime() throws {
        let a = try fixtures()[0].snapshot
        var value = try JSONSerialization.jsonObject(with: JSONEncoder().encode(a)) as! [String: Any]
        var spent = value["balls"] as! [[String: Any]]
        var next = spent[0]; next["id"] = "new-ball"; next["position"] = [0.1, 0.204, 0.0]
        spent[0]["state"] = "rested"; spent[0]["position"] = [0.02, 0.204, 0.0]
        value["balls"] = spent + [next]; value["activeBallId"] = "new-ball"; value["sequence"] = 2; value["serverTimeMs"] = 1100
        let b = try JSONDecoder().decode(WorldSnapshot.self, from: JSONSerialization.data(withJSONObject: value))
        let buffer = WorldSnapshotBuffer(); buffer.welcome(a.worldId)
        buffer.receive(a, atMs: 1000, clockOffsetMs: 0); buffer.receive(b, atMs: 1100, clockOffsetMs: 0)
        let halfway = buffer.render(atMs: 1100, clockOffsetMs: 0)!
        XCTAssertEqual(halfway.activeBallId, a.activeBallId); XCTAssertEqual(halfway.balls.count, 1)
        XCTAssertEqual(halfway.balls[0].position[0], 0.01, accuracy: 1e-8)
        let born = buffer.render(atMs: 1150, clockOffsetMs: 0)!
        XCTAssertEqual(born.activeBallId, "new-ball"); XCTAssertEqual(born.balls.count, 2)
        XCTAssertEqual(born.balls[1].position[0], 0.1)
    }
    func testRejectsLegacyAndDuplicateBallIdentity() throws {
        let a = try fixtures()[0].snapshot
        XCTAssertFalse(try altered(a, ["protocolVersion": 1]).valid)
        var duplicate = a; duplicate.balls.append(a.balls[0]); XCTAssertFalse(duplicate.valid)
    }
    func testRejectsInvalidGeometryAndRotation() throws {
        var a = try fixtures()[0].snapshot; a.phone?.quaternion = [0, 0, 0, 0]
        XCTAssertFalse(a.valid)
        a = try altered(try fixtures()[0].snapshot, ["epoch": -1]); XCTAssertFalse(a.valid)
    }
}
