import XCTest
@testable import Phone3DClockSync

final class BoundedFrameWindowTests: XCTestCase {
    func testWindowAllowsOverlapButNeverExceedsCapacity() {
        for capacity in 1...3 {
            var window = BoundedFrameWindow(capacity: capacity)
            for id in 1...capacity {
                XCTAssertNotNil(window.insert(frameId: Int64(id), bytes: 30_000, at: 10))
            }
            XCTAssertNil(window.insert(frameId: 4, bytes: 30_000, at: 10.01))
            XCTAssertNotNil(window.acknowledge(frameId: 1))
            XCTAssertNotNil(window.insert(frameId: 4, bytes: 30_000, at: 10.02))
        }
    }
    func testOutOfOrderDuplicateAndUnknownACKsDoNotReleaseOtherFrames() {
        var window = BoundedFrameWindow(capacity: 3)
        for id: Int64 in 1...3 { XCTAssertNotNil(window.insert(frameId: id, bytes: 100, at: 0)) }
        XCTAssertNotNil(window.acknowledge(frameId: 3))
        XCTAssertNil(window.acknowledge(frameId: 3))
        XCTAssertNil(window.acknowledge(frameId: 99))
        XCTAssertEqual(Set(window.entries.keys), [1, 2])
        XCTAssertEqual(window.outstandingBytes, 200)
    }
    func testByteLimitAndSingletonKeyframeExceptionAreBounded() {
        var window = BoundedFrameWindow(capacity: 3, byteLimit: 100, maximumFrameBytes: 200)
        XCTAssertNotNil(window.insert(frameId: 1, bytes: 60, at: 0))
        XCTAssertNil(window.insert(frameId: 2, bytes: 41, at: 0))
        XCTAssertNotNil(window.insert(frameId: 2, bytes: 40, at: 0))
        XCTAssertFalse(window.canAdmit(at: 0))
        window.clear()
        XCTAssertNotNil(window.insert(frameId: 3, bytes: 150, at: 0))
        XCTAssertFalse(window.canAdmit(at: 0))
        _ = window.acknowledge(frameId: 3)
        XCTAssertNil(window.insert(frameId: 4, bytes: 201, at: 0))
    }
    func testStaleFrameStopsAdmissionWithoutDroppingItsDependencies() {
        var window = BoundedFrameWindow(capacity: 3)
        let entry = window.insert(frameId: 1, bytes: 10, at: 0)!
        XCTAssertFalse(window.canAdmit(at: 0.101))
        XCTAssertEqual(window.entries[1]?.token, entry.token)
        _ = window.acknowledge(frameId: 1)
        XCTAssertTrue(window.canAdmit(at: 0.102))
        window.clear()
        let replacement = window.insert(frameId: 1, bytes: 10, at: 1)!
        XCTAssertNotEqual(replacement.token, entry.token)
    }
    func testDelayedACKSimulationMeasuresAdmissionNotVisibleFPS() {
        var counts: [Int] = []
        for capacity in 1...3 {
            var window = BoundedFrameWindow(capacity: capacity)
            var accepted = 0
            for tick in 0..<60 {
                let now = Double(tick) / 60
                for (id, entry) in window.entries where now - entry.sentAt >= 0.040 {
                    _ = window.acknowledge(frameId: id)
                }
                if window.insert(frameId: Int64(tick), bytes: 30_000, at: now) != nil { accepted += 1 }
                XCTAssertLessThanOrEqual(window.entries.count, capacity)
            }
            counts.append(accepted)
        }
        XCTAssertEqual(counts, [20, 40, 60])
    }
}
