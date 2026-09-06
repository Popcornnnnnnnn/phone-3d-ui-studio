import XCTest
@testable import Phone3DClockSync

final class FrameTransportTraceTests: XCTestCase {
    func testIncrementalDeliveryRetriesUntilACKThenGoesQuiet() {
        var trace = FrameTransportTrace()
        trace.begin(frameId: 1, generation: 1, bytes: 1, keyframe: false,
            uptime: 1, wallMs: 1_000, clock: nil)
        trace.acknowledge(frameId: 1, uptime: 1.01, wallMs: 1_010, path: "raw", bridge: [:])
        XCTAssertEqual(trace.unacknowledgedSamples.count, 1)
        XCTAssertEqual(trace.unacknowledgedSamples.count, 1) // Read is not delivery.
        trace.acknowledgeDelivery(through: 2, generation: 0) // Future revision.
        XCTAssertEqual(trace.unacknowledgedSamples.count, 1)
        trace.acknowledgeDelivery(through: 1, generation: 0)
        XCTAssertTrue(trace.unacknowledgedSamples.isEmpty)
        XCTAssertEqual(trace.samples.count, 1) // Local evidence remains intact.
        trace.resetDelivery()
        trace.acknowledgeDelivery(through: 1, generation: 0) // Old socket ACK.
        XCTAssertEqual(trace.unacknowledgedSamples.count, 1)
        trace.acknowledgeDelivery(through: 1, generation: 1)
        XCTAssertTrue(trace.unacknowledgedSamples.isEmpty)
    }

    func testOutOfOrderACKAndLateCompletionAreExportedByRevision() {
        var trace = FrameTransportTrace()
        for id: Int64 in 1...2 {
            trace.begin(frameId: id, generation: 1, bytes: 1, keyframe: false,
                uptime: 1, wallMs: 1_000, clock: nil)
        }
        trace.acknowledge(frameId: 2, uptime: 1.01, wallMs: 1_010, path: "raw", bridge: [:])
        trace.acknowledgeDelivery(through: trace.latestRevision, generation: 0)
        trace.acknowledge(frameId: 1, uptime: 1.02, wallMs: 1_020, path: "raw", bridge: [:])
        XCTAssertEqual(trace.unacknowledgedSamples.map(\.frameId), [1])
        trace.acknowledgeDelivery(through: trace.latestRevision, generation: 0)
        trace.sent(frameId: 2, generation: 1, elapsedMs: 0.5)
        XCTAssertEqual(trace.unacknowledgedSamples.map(\.frameId), [2])
        XCTAssertEqual(trace.unacknowledgedSamples[0].timings["sendCompletionMs"], 0.5)
    }

    func testOfflineRingEvictionIsExplicitAndFailuresRemain() {
        var trace = FrameTransportTrace(capacity: 1)
        for id: Int64 in 1...2 {
            trace.begin(frameId: id, generation: 1, bytes: 1, keyframe: false,
                uptime: 1, wallMs: 1_000, clock: nil)
            trace.finishAll(reason: "timeout", uptime: 1.6, wallMs: 1_600)
        }
        XCTAssertEqual(trace.discardedThroughRevision, 1)
        XCTAssertEqual(trace.unacknowledgedSamples.map(\.outcome), ["timeout"])
        trace.acknowledgeDelivery(through: trace.latestRevision, generation: 0)
        XCTAssertTrue(trace.unacknowledgedSamples.isEmpty)
    }

    func testProductionDefaultIsTwoFrames() {
        XCTAssertEqual(BoundedFrameWindow().capacity, 2)
    }
    func testACKPhasesAndLateCompletionUseTheSameFrame() {
        var trace = FrameTransportTrace()
        trace.begin(frameId: 1, generation: 2, bytes: 100, keyframe: true,
            uptime: 10, wallMs: 1_000, clock: ClockEstimate(offsetMs: 50, rttMs: 2))
        trace.acknowledge(frameId: 1, uptime: 10.04, wallMs: 1_040, path: "raw",
            bridge: ["bridgeReceivedAtMs": 1_070, "bridgeAckIssuedAtMs": 1_072,
                     "bridgeProcessingMs": 2, "bridgeReadSpanMs": 8])
        trace.sent(frameId: 1, generation: 1, elapsedMs: 500) // stale generation
        XCTAssertNil(trace.samples[0].timings["sendCompletionMs"])
        trace.sent(frameId: 1, generation: 2, elapsedMs: 0.5)
        XCTAssertEqual(trace.samples[0].timings["forwardEstimateMs"], 20)
        XCTAssertEqual(trace.samples[0].timings["returnEstimateMs"], 18)
        XCTAssertEqual(trace.samples[0].timings["ackMs"]!, 40, accuracy: 0.001)
        XCTAssertEqual(trace.samples[0].timings["sendCompletionMs"], 0.5)
        trace.acknowledge(frameId: 1, uptime: 11, wallMs: 2_000, path: "pose", bridge: [:])
        XCTAssertEqual(trace.samples.count, 1)
    }
    func testWallClockStepDoesNotCorruptMonotonicRTT() {
        var trace = FrameTransportTrace()
        trace.begin(frameId: 1, generation: 1, bytes: 1, keyframe: false,
            uptime: 1, wallMs: 1_000, clock: ClockEstimate(offsetMs: 0, rttMs: 1))
        trace.acknowledge(frameId: 1, uptime: 1.1, wallMs: 4_000, path: "pose",
            bridge: ["bridgeReceivedAtMs": 1_020, "bridgeAckIssuedAtMs": 1_021])
        XCTAssertEqual(trace.samples[0].timings["ackMs"]!, 100, accuracy: 0.001)
        XCTAssertNil(trace.samples[0].timings["forwardEstimateMs"])
    }
    func testFailuresAndBoundedRetentionDoNotDisappear() throws {
        var trace = FrameTransportTrace(capacity: 2)
        for id: Int64 in 1...3 {
            trace.begin(frameId: id, generation: id, bytes: 1, keyframe: false,
                uptime: Double(id), wallMs: Double(id) * 1_000, clock: nil)
            trace.finishAll(reason: "frame-ack-hard-timeout", uptime: Double(id) + 0.6,
                wallMs: Double(id) * 1_000 + 600)
        }
        XCTAssertEqual(trace.samples.map(\.frameId), [2, 3])
        XCTAssertTrue(trace.samples.allSatisfy { $0.outcome == "frame-ack-hard-timeout" })
        XCTAssertNoThrow(try JSONEncoder().encode(trace.samples))
    }
}
