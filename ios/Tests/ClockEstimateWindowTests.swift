import XCTest
@testable import Phone3DClockSync

final class ClockEstimateWindowTests: XCTestCase {
    func testBuildsFractionalEstimateFromMonotonicRoundTrip() throws {
        let estimate = try XCTUnwrap(
            ClockEstimate.fromExchange(
                phoneSendAtWallMs: 1_000.125,
                phoneReceiveAtWallMs: 1_001.375,
                phoneRoundTripElapsedMs: 1.25,
                bridgeReceiveAtMs: 1_010.625,
                bridgeSendAtMs: 1_010.875
            )
        )

        XCTAssertEqual(estimate.offsetMs, 10, accuracy: 0.000_001)
        XCTAssertEqual(estimate.rttMs, 1, accuracy: 0.000_001)
        XCTAssertNil(
            ClockEstimate.fromExchange(
                phoneSendAtWallMs: 1_000,
                phoneReceiveAtWallMs: 1_001,
                phoneRoundTripElapsedMs: 1,
                bridgeReceiveAtMs: 1_010,
                bridgeSendAtMs: 1_012
            )
        )
        XCTAssertNil(
            ClockEstimate.fromExchange(
                phoneSendAtWallMs: 1_000,
                phoneReceiveAtWallMs: 1_101,
                phoneRoundTripElapsedMs: 1,
                bridgeReceiveAtMs: 1_010,
                bridgeSendAtMs: 1_010.25
            )
        )
    }

    func testUsesLowestRTTSampleWithinRound() {
        var window = ClockEstimateWindow()
        window.beginRound(1)

        XCTAssertTrue(
            window.record(
                ClockEstimate(offsetMs: 10.25, rttMs: 4.75),
                inRound: 1
            )
        )
        XCTAssertTrue(
            window.record(
                ClockEstimate(offsetMs: 10.5, rttMs: 1.25),
                inRound: 1
            )
        )
        XCTAssertEqual(
            window.estimate,
            ClockEstimate(offsetMs: 10.5, rttMs: 1.25)
        )
        XCTAssertTrue(window.completeRound(1))
        XCTAssertEqual(
            window.estimate,
            ClockEstimate(offsetMs: 10.5, rttMs: 1.25)
        )
    }

    func testKeepsPublishedEstimateDuringRefresh() {
        var window = ClockEstimateWindow()
        window.beginRound(1)
        window.record(ClockEstimate(offsetMs: 10, rttMs: 1), inRound: 1)
        window.completeRound(1)

        window.beginRound(2)
        window.record(ClockEstimate(offsetMs: 20, rttMs: 0.5), inRound: 2)

        XCTAssertEqual(
            window.estimate,
            ClockEstimate(offsetMs: 10, rttMs: 1)
        )
        XCTAssertTrue(window.completeRound(2))
        XCTAssertEqual(
            window.estimate,
            ClockEstimate(offsetMs: 20, rttMs: 0.5)
        )
    }

    func testPublishesLatestCompletedRoundInsteadOfStaleMinimumRTT() {
        var window = ClockEstimateWindow(maximumCompletedRounds: 3)
        for roundId in 1...3 {
            window.beginRound(Int64(roundId))
            window.record(
                ClockEstimate(
                    offsetMs: Double(roundId * 10),
                    rttMs: Double(roundId)
                ),
                inRound: Int64(roundId)
            )
            window.completeRound(Int64(roundId))
        }
        XCTAssertEqual(window.estimate?.offsetMs, 30)

        window.beginRound(4)
        window.record(ClockEstimate(offsetMs: 40, rttMs: 4), inRound: 4)
        window.completeRound(4)

        XCTAssertEqual(window.estimate?.offsetMs, 40)
    }

    func testRejectsWrongRoundAndInvalidSamples() {
        var window = ClockEstimateWindow()
        window.beginRound(7)

        XCTAssertFalse(
            window.record(
                ClockEstimate(offsetMs: 1, rttMs: 1),
                inRound: 6
            )
        )
        XCTAssertFalse(
            window.record(
                ClockEstimate(offsetMs: .nan, rttMs: 1),
                inRound: 7
            )
        )
        XCTAssertFalse(
            window.record(
                ClockEstimate(offsetMs: 1, rttMs: -1),
                inRound: 7
            )
        )
        XCTAssertNil(window.estimate)
        XCTAssertFalse(window.completeRound(7))
    }

    func testClockProtocolPreservesFractionalMilliseconds() throws {
        let request = ClockSyncRequest(
            requestId: 42,
            phoneSendAtPreciseMs: 1_725_432_100_000.375
        )
        let data = try JSONEncoder().encode(request)
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        XCTAssertEqual(
            try XCTUnwrap(object["phoneSendAtMs"] as? NSNumber).int64Value,
            1_725_432_100_000
        )
        XCTAssertEqual(
            try XCTUnwrap(
                object["phoneSendAtPreciseMs"] as? NSNumber
            ).doubleValue,
            1_725_432_100_000.375,
            accuracy: 0.001
        )
        XCTAssertEqual(
            try XCTUnwrap(object["clockSyncVersion"] as? NSNumber).intValue,
            2
        )

        let replyData = Data(
            """
            {
              "type": "clock-sync-reply",
              "requestId": 42,
              "phoneSendAtMs": 1725432100000,
              "bridgeReceiveAtMs": 1725432100000,
              "bridgeSendAtMs": 1725432100000,
              "phoneSendAtPreciseMs": 1725432100000.375,
              "bridgeReceiveAtPreciseMs": 1725432100000.625,
              "bridgeSendAtPreciseMs": 1725432100000.875
            }
            """.utf8
        )
        let reply = try JSONDecoder().decode(ClockSyncReply.self, from: replyData)
        XCTAssertEqual(reply.bridgeReceiveAtMs, 1_725_432_100_000.625)
        XCTAssertEqual(reply.bridgeSendAtMs, 1_725_432_100_000.875)
    }

    func testClockProtocolFallsBackToLegacyOrTransitionalFields() throws {
        let legacyData = Data(
            """
            {
              "type": "clock-sync-reply",
              "requestId": 7,
              "phoneSendAtMs": 1725432100000,
              "bridgeReceiveAtMs": 1725432100001,
              "bridgeSendAtMs": 1725432100002
            }
            """.utf8
        )
        let legacy = try JSONDecoder().decode(
            ClockSyncReply.self,
            from: legacyData
        )
        XCTAssertEqual(legacy.phoneSendAtMs, 1_725_432_100_000)
        XCTAssertEqual(legacy.bridgeReceiveAtMs, 1_725_432_100_001)
        XCTAssertEqual(legacy.bridgeSendAtMs, 1_725_432_100_002)

        let transitionalData = Data(
            """
            {
              "type": "clock-sync-reply",
              "requestId": 8,
              "phoneSendAtMs": 1725432100000.125,
              "bridgeReceiveAtMs": 1725432100000.625,
              "bridgeSendAtMs": 1725432100000.875
            }
            """.utf8
        )
        let transitional = try JSONDecoder().decode(
            ClockSyncReply.self,
            from: transitionalData
        )
        XCTAssertEqual(
            transitional.bridgeReceiveAtMs,
            1_725_432_100_000.625,
            accuracy: 0.001
        )
    }

    func testBenchmarkCompletionRequiresTheSameActiveEncoderConfiguration() {
        XCTAssertTrue(
            BenchmarkEncoderConfigurationVerification.completionIsVerified(
                startedProfile: "legacy",
                startedTuning: "speed-priority",
                currentProfile: "legacy",
                currentTuning: "speed-priority"
            )
        )
        XCTAssertFalse(
            BenchmarkEncoderConfigurationVerification.completionIsVerified(
                startedProfile: "legacy",
                startedTuning: "speed-priority",
                currentProfile: nil,
                currentTuning: nil
            )
        )
        XCTAssertFalse(
            BenchmarkEncoderConfigurationVerification.completionIsVerified(
                startedProfile: "legacy",
                startedTuning: "speed-priority",
                currentProfile: "legacy",
                currentTuning: "default"
            )
        )
    }
}
