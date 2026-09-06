import XCTest
@testable import Phone3DClockSync

final class SpatialProtocolTests: XCTestCase {
    func testRemoteReceiptReleasesOnlyLatestWaitingPose() {
        var window = SpatialSendWindow()
        XCTAssertEqual(window.offer(.init(sequence: 1, text: "first"), now: 0)?.sequence, 1)
        XCTAssertNil(window.offer(.init(sequence: 2, text: "old"), now: 0.1))
        XCTAssertNil(window.offer(.init(sequence: 3, text: "latest"), now: 0.2))
        XCTAssertNil(window.acknowledge(99, now: 0.3))
        XCTAssertEqual(window.awaiting?.sequence, 1)
        XCTAssertEqual(window.acknowledge(1, now: 0.3)?.sequence, 3)
        XCTAssertNil(window.latest)
        XCTAssertFalse(window.expired(now: 1.2))
        XCTAssertTrue(window.expired(now: 1.31))
        XCTAssertNil(window.acknowledge(3, now: 1.32))
        XCTAssertFalse(window.expired(now: 2))
    }
    func testStoppedPermissionCallbackCannotStartSession() {
        var gate = SpatialSessionGate()
        let pending = gate.start()
        gate.stop()
        XCTAssertFalse(gate.accepts(pending))
        let next = gate.start()
        XCTAssertTrue(gate.accepts(next))
        XCTAssertFalse(gate.accepts(pending))
    }
    func testBackgroundAndModeStopInvalidateSession() {
        var gate = SpatialSessionGate()
        let pending = gate.start()
        gate.setForeground(false)
        XCTAssertFalse(gate.accepts(pending))
        gate.setForeground(true)
        XCTAssertTrue(gate.accepts(gate.generation))
        gate.stop()
        gate.setForeground(false)
        gate.setForeground(true)
        XCTAssertFalse(gate.accepts(gate.generation))
    }
    func testStatusDoesNotRequirePoseOrClock() throws {
        let message = SpatialMessage(type: "spatial-status", sessionId: "a", sequence: 1,
            sampledAtMs: 1000, trackingState: "denied", reason: "Enable Camera",
            positionMeters: nil, quaternion: nil, clockOffsetMs: nil, clockRttMs: nil)
        let result = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(message)) as? [String: Any])
        XCTAssertEqual(result["trackingState"] as? String, "denied")
        XCTAssertNil(result["positionMeters"])
        XCTAssertNil(result["clockOffsetMs"])
    }
}
