import XCTest
@testable import Phone3DClockSync

final class BenchmarkCaptureConfigurationTests: XCTestCase {
    func testEncoderTimelinePreservesAdmittedCadenceAndIdleGaps() {
        var timeline = H264PresentationTimeline()
        XCTAssertEqual(timeline.next(sourceSeconds: 50, nominalFramesPerSecond: 60), 0)
        for frame in 1...20 {
            XCTAssertEqual(timeline.next(sourceSeconds: 50 + Double(frame) / 20,
                nominalFramesPerSecond: 60), Double(frame) / 20, accuracy: 1e-8)
        }
        XCTAssertEqual(timeline.next(sourceSeconds: 56, nominalFramesPerSecond: 60), 6, accuracy: 1e-8)
        timeline.reset()
        XCTAssertEqual(timeline.next(sourceSeconds: 100, nominalFramesPerSecond: 60), 0)
        XCTAssertEqual(timeline.next(sourceSeconds: 100 + 1.0 / 60,
            nominalFramesPerSecond: 60), 1.0 / 60, accuracy: 1e-8)
    }

    func testEncoderTimelineRecoversFromClockRegressionAndInvalidTimes() {
        var timeline = H264PresentationTimeline()
        let sources: [Double] = [10, 10, 9, 9.05, .nan, .infinity, 10, 10.05]
        let expected: [Double] = [0, 0.02, 0.04, 0.09, 0.11, 0.13, 0.15, 0.20]
        for (source, value) in zip(sources, expected) {
            XCTAssertEqual(timeline.next(sourceSeconds: source, nominalFramesPerSecond: 50), value, accuracy: 1e-8)
        }
    }

    func testKeyframeCadenceRecoversImmediatelyAfterSparseCaptureGap() {
        var cadence = H264KeyframeCadence()

        XCTAssertTrue(cadence.shouldForceKeyframe(at: 10, explicitlyRequested: false))
        XCTAssertFalse(cadence.shouldForceKeyframe(at: 10.016, explicitlyRequested: false))
        XCTAssertTrue(cadence.shouldForceKeyframe(at: 10.300, explicitlyRequested: false))
    }

    func testKeyframeCadenceHasARealTimeMaximumDuringContinuousCapture() {
        var cadence = H264KeyframeCadence()
        XCTAssertTrue(cadence.shouldForceKeyframe(at: 20, explicitlyRequested: false))
        for frame in 1..<120 {
            XCTAssertFalse(cadence.shouldForceKeyframe(
                at: 20 + Double(frame) / 60,
                explicitlyRequested: false
            ))
        }
        XCTAssertTrue(cadence.shouldForceKeyframe(at: 22, explicitlyRequested: false))
    }

    func testKeyframeCadenceHonorsExplicitRecoveryAndClockRegression() {
        var cadence = H264KeyframeCadence()
        XCTAssertTrue(cadence.shouldForceKeyframe(at: 30, explicitlyRequested: false))
        XCTAssertTrue(cadence.shouldForceKeyframe(at: 30.016, explicitlyRequested: true))
        XCTAssertTrue(cadence.shouldForceKeyframe(at: 29, explicitlyRequested: false))
    }

    func testQualitySnapshotRequestDecodesOptionalBitRate() throws {
        let command = try JSONDecoder().decode(
            QualitySnapshotRequestCommand.self,
            from: Data(
                """
                {
                  "type": "quality-snapshot-request",
                  "runId": "4d67af95-96bb-45a2-a7c0-0bf26c134b29",
                  "averageBitRate": 15000000
                }
                """.utf8
            )
        )

        XCTAssertEqual(command.averageBitRate, 15_000_000)
    }

    func testLegacyBenchmarkRequestDefaultsTo960ShortEdge() throws {
        let data = Data(
            """
            {
              "type": "benchmark-request",
              "runId": "legacy-run",
              "durationMs": 10000,
              "requestedAtMs": 1000
            }
            """.utf8
        )

        let command = try JSONDecoder().decode(
            BenchmarkRequestCommand.self,
            from: data
        )

        XCTAssertNil(command.captureShortEdge)
        XCTAssertEqual(
            BenchmarkCaptureConfiguration.resolvedShortEdge(
                command.captureShortEdge
            ),
            960
        )
    }

    func testOnlySupportedShortEdgesResolve() {
        XCTAssertEqual(
            BenchmarkCaptureConfiguration.resolvedShortEdge(960),
            960
        )
        XCTAssertEqual(
            BenchmarkCaptureConfiguration.resolvedShortEdge(720),
            720
        )
        XCTAssertEqual(
            BenchmarkCaptureConfiguration.resolvedShortEdge(640),
            640
        )
        XCTAssertNil(
            BenchmarkCaptureConfiguration.resolvedShortEdge(800)
        )
    }

    func testOutputDimensionsPreserveAspectAndUseEvenVideoDimensions() {
        XCTAssertEqual(
            BenchmarkCaptureConfiguration.outputDimensions(
                sourceWidth: 1_206,
                sourceHeight: 2_622,
                requestedShortEdge: 960
            ),
            CaptureOutputDimensions(width: 960, height: 2_088)
        )
        XCTAssertEqual(
            BenchmarkCaptureConfiguration.outputDimensions(
                sourceWidth: 1_206,
                sourceHeight: 2_622,
                requestedShortEdge: 720
            ),
            CaptureOutputDimensions(width: 720, height: 1_566)
        )
        XCTAssertEqual(
            BenchmarkCaptureConfiguration.outputDimensions(
                sourceWidth: 1_206,
                sourceHeight: 2_622,
                requestedShortEdge: 640
            ),
            CaptureOutputDimensions(width: 640, height: 1_392)
        )
    }

    func testReadinessRequiresMatchingGenerationSizeFreshnessAndEncoder() {
        let expected = CaptureOutputDimensions(width: 720, height: 1_566)
        var readiness = BenchmarkCaptureReadiness(
            streamGeneration: 12,
            requestedShortEdge: 720,
            expectedDimensions: expected
        )

        XCTAssertFalse(
            readiness.observe(
                streamGeneration: 11,
                actualDimensions: expected,
                freshContent: true,
                encoderReady: true,
                observedAtMs: 1_000
            )
        )
        XCTAssertFalse(
            readiness.observe(
                streamGeneration: 12,
                actualDimensions: CaptureOutputDimensions(
                    width: 720,
                    height: 1_564
                ),
                freshContent: true,
                encoderReady: true,
                observedAtMs: 1_000
            )
        )
        XCTAssertFalse(
            readiness.observe(
                streamGeneration: 12,
                actualDimensions: expected,
                freshContent: false,
                encoderReady: true,
                observedAtMs: 1_000
            )
        )
        XCTAssertFalse(
            readiness.observe(
                streamGeneration: 12,
                actualDimensions: expected,
                freshContent: true,
                encoderReady: false,
                observedAtMs: 1_000
            )
        )
        XCTAssertTrue(
            readiness.observe(
                streamGeneration: 12,
                actualDimensions: expected,
                freshContent: true,
                encoderReady: true,
                observedAtMs: 1_000
            )
        )
    }

    func testReadinessWaitsForTheFullWarmupAfterTargetPipelineIsReady() {
        let expected = CaptureOutputDimensions(width: 640, height: 1_392)
        var readiness = BenchmarkCaptureReadiness(
            streamGeneration: 20,
            requestedShortEdge: 640,
            expectedDimensions: expected
        )
        readiness.observe(
            streamGeneration: 20,
            actualDimensions: expected,
            freshContent: true,
            encoderReady: true,
            observedAtMs: 10_000
        )

        XCTAssertFalse(readiness.canStart(at: 11_999, warmupMs: 2_000))
        XCTAssertTrue(readiness.canStart(at: 12_000, warmupMs: 2_000))
        XCTAssertTrue(
            readiness.stillMatches(
                streamGeneration: 20,
                actualDimensions: expected,
                currentFrameFreshContent: true,
                lastVerifiedFreshFrameAtMs: 11_900,
                observedAtMs: 12_000,
                maximumFreshFrameAgeMs: 500,
                encoderReady: true
            )
        )
        XCTAssertFalse(
            readiness.stillMatches(
                streamGeneration: 19,
                actualDimensions: expected,
                currentFrameFreshContent: true,
                lastVerifiedFreshFrameAtMs: 11_900,
                observedAtMs: 12_000,
                maximumFreshFrameAgeMs: 500,
                encoderReady: true
            )
        )
    }

    func testReadinessInvalidationRequiresANewFullWarmup() {
        let expected = CaptureOutputDimensions(width: 720, height: 1_566)
        var readiness = BenchmarkCaptureReadiness(
            streamGeneration: 30,
            requestedShortEdge: 720,
            expectedDimensions: expected
        )
        XCTAssertTrue(
            readiness.observe(
                streamGeneration: 30,
                actualDimensions: expected,
                freshContent: true,
                encoderReady: true,
                observedAtMs: 10_000
            )
        )
        readiness.invalidate()
        XCTAssertFalse(readiness.canStart(at: 12_000, warmupMs: 2_000))

        XCTAssertTrue(
            readiness.observe(
                streamGeneration: 30,
                actualDimensions: expected,
                freshContent: true,
                encoderReady: true,
                observedAtMs: 12_100
            )
        )
        XCTAssertFalse(readiness.canStart(at: 14_099, warmupMs: 2_000))
        XCTAssertTrue(readiness.canStart(at: 14_100, warmupMs: 2_000))
    }

    func testRecoveredFreshOutputGapRequiresANewFullWarmup() {
        let expected = CaptureOutputDimensions(width: 720, height: 1_566)
        var readiness = BenchmarkCaptureReadiness(
            streamGeneration: 31,
            requestedShortEdge: 720,
            expectedDimensions: expected
        )
        XCTAssertTrue(
            readiness.observe(
                streamGeneration: 31,
                actualDimensions: expected,
                freshContent: true,
                encoderReady: true,
                observedAtMs: 10_000
            )
        )
        XCTAssertTrue(
            BenchmarkCaptureReadiness.freshnessContinuityIsBroken(
                previousVerifiedAtMs: 10_000,
                nextVerifiedAtMs: 10_501,
                maximumFreshFrameAgeMs: 500
            )
        )

        readiness.invalidate()
        XCTAssertTrue(
            readiness.observe(
                streamGeneration: 31,
                actualDimensions: expected,
                freshContent: true,
                encoderReady: true,
                observedAtMs: 10_501
            )
        )
        XCTAssertFalse(readiness.canStart(at: 12_500, warmupMs: 2_000))
        XCTAssertTrue(readiness.canStart(at: 12_501, warmupMs: 2_000))
    }

    func testEndpointRequiresCurrentAndRecentFreshOutput() {
        let expected = CaptureOutputDimensions(width: 640, height: 1_392)
        var readiness = BenchmarkCaptureReadiness(
            streamGeneration: 40,
            requestedShortEdge: 640,
            expectedDimensions: expected
        )
        readiness.observe(
            streamGeneration: 40,
            actualDimensions: expected,
            freshContent: true,
            encoderReady: true,
            observedAtMs: 1_000
        )

        XCTAssertFalse(
            readiness.stillMatches(
                streamGeneration: 40,
                actualDimensions: expected,
                currentFrameFreshContent: false,
                lastVerifiedFreshFrameAtMs: 2_900,
                observedAtMs: 3_000,
                maximumFreshFrameAgeMs: 500,
                encoderReady: true
            )
        )
        XCTAssertFalse(
            readiness.stillMatches(
                streamGeneration: 40,
                actualDimensions: expected,
                currentFrameFreshContent: true,
                lastVerifiedFreshFrameAtMs: 2_499,
                observedAtMs: 3_000,
                maximumFreshFrameAgeMs: 500,
                encoderReady: true
            )
        )
        XCTAssertTrue(
            readiness.stillMatches(
                streamGeneration: 40,
                actualDimensions: expected,
                currentFrameFreshContent: true,
                lastVerifiedFreshFrameAtMs: 2_500,
                observedAtMs: 3_000,
                maximumFreshFrameAgeMs: 500,
                encoderReady: true
            )
        )
    }

    func testPendingTimeoutIncludesTheRequestedWarmup() {
        XCTAssertEqual(
            BenchmarkCaptureConfiguration.pendingTimeoutMs(warmupMs: 2_000),
            12_000
        )
        XCTAssertEqual(
            BenchmarkCaptureConfiguration.pendingTimeoutMs(warmupMs: -1),
            BenchmarkCaptureConfiguration.readinessTimeoutMs
        )
    }
}
