import XCTest
@testable import Phone3DClockSync

final class FrameRateGateTests: XCTestCase {
    func testDownstreamBusyDoesNotConsumeCadenceDeadline() {
        var gate = FrameRateGate()

        XCTAssertTrue(
            gate.accepts(
                timestampSeconds: 0,
                targetFramesPerSecond: 30,
                downstreamReady: true
            )
        )
        XCTAssertFalse(
            gate.accepts(
                timestampSeconds: 1.0 / 30.0,
                targetFramesPerSecond: 30,
                downstreamReady: false
            )
        )

        // A 60 Hz source supplies this frame before the next 30 Hz deadline.
        // It is accepted because the busy callback above did not advance the
        // gate. Advancing the deadline would incorrectly reject it until 2/30.
        XCTAssertTrue(
            gate.accepts(
                timestampSeconds: 1.5 / 30.0,
                targetFramesPerSecond: 30,
                downstreamReady: true
            )
        )
    }

    func testCadenceStillAdvancesAfterSuccessfulAdmission() {
        var gate = FrameRateGate()

        XCTAssertTrue(
            gate.accepts(
                timestampSeconds: 0,
                targetFramesPerSecond: 30,
                downstreamReady: true
            )
        )
        XCTAssertTrue(
            gate.accepts(
                timestampSeconds: 1.0 / 30.0,
                targetFramesPerSecond: 30,
                downstreamReady: true
            )
        )
        XCTAssertFalse(
            gate.accepts(
                timestampSeconds: 1.5 / 30.0,
                targetFramesPerSecond: 30,
                downstreamReady: true
            )
        )
    }

    func testDefaultAdmissionMatchesExplicitlyReadyDownstream() {
        var defaultGate = FrameRateGate()
        var explicitlyReadyGate = FrameRateGate()
        let timestamps = [0.0, 0.01, 0.02, 0.034, 0.05, 0.067]

        for timestamp in timestamps {
            XCTAssertEqual(
                defaultGate.accepts(
                    timestampSeconds: timestamp,
                    targetFramesPerSecond: 30
                ),
                explicitlyReadyGate.accepts(
                    timestampSeconds: timestamp,
                    targetFramesPerSecond: 30,
                    downstreamReady: true
                )
            )
        }
    }
}
