import XCTest
@testable import Phone3DClockSync

final class CaptureFreshnessStateTests: XCTestCase {
    func testBenchmarkCadenceResetPreservesObservedCaptureTruth() {
        var state = CaptureFreshnessState()
        state.record(contentStatus: "complete", freshContent: true)

        state.reset(for: .benchmarkCadenceWindow)

        XCTAssertEqual(state.contentStatus, "complete")
        XCTAssertEqual(state.freshContent, true)
        XCTAssertEqual(state.messageContentStatus, "complete")
        XCTAssertEqual(state.messageFreshContent, true)
    }

    func testNewCaptureSessionClearsPreviousCaptureTruth() {
        var state = CaptureFreshnessState()
        state.record(contentStatus: "complete", freshContent: true)

        state.reset(for: .captureSession)

        XCTAssertNil(state.contentStatus)
        XCTAssertNil(state.freshContent)
        XCTAssertEqual(state.messageContentStatus, "missing")
        XCTAssertEqual(state.messageFreshContent, false)
    }

    func testFrameMetadataAlwaysEncodesCaptureFreshness() throws {
        let metadata = FrameMetadataMessage(
            producerSessionId: "producer-a",
            captureSource: "screencapturekit-host",
            frameId: 42,
            timestampMs: 1_000,
            captureAtMs: 1_000,
            callbackAtMs: 1_001,
            encodeStartedAtMs: 1_002,
            encodedAtMs: 1_003,
            width: 960,
            height: 2_088,
            orientation: "portrait",
            jpegBytes: 128,
            codec: "h264",
            isKeyframe: true,
            decoderCodec: "avc1.64002a",
            h264BitstreamFormat: "annex-b",
            decoderDescriptionBase64: nil,
            clockOffsetMs: 0,
            clockRttMs: 1,
            captureTimestampSource: "screencapturekit-display-time",
            captureTimestampValid: true,
            captureSampleAgeMs: 4,
            captureContentStatus: "complete",
            freshContent: true,
            captureShortEdgeActive: 960,
            captureWidthActive: 960,
            captureHeightActive: 2_088,
            captureStreamGeneration: 7,
            h264PipelineEpoch: 11
        )

        let data = try JSONEncoder().encode(metadata)
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )

        XCTAssertEqual(object["captureContentStatus"] as? String, "complete")
        XCTAssertEqual(object["freshContent"] as? Bool, true)
        XCTAssertEqual(object["captureShortEdgeActive"] as? Int, 960)
        XCTAssertEqual(object["captureWidthActive"] as? Int, 960)
        XCTAssertEqual(object["captureHeightActive"] as? Int, 2_088)
        XCTAssertEqual(object["captureStreamGeneration"] as? Int, 7)
        XCTAssertEqual(object["h264PipelineEpoch"] as? Int, 11)
    }

    func testH264DeliveryIdentityRejectsEitherGenerationOrPipelineDrift() {
        let active = H264PipelineIdentity(
            captureStreamGeneration: 7,
            pipelineEpoch: 11
        )

        XCTAssertEqual(
            active,
            H264PipelineIdentity(
                captureStreamGeneration: 7,
                pipelineEpoch: 11
            )
        )
        XCTAssertNotEqual(
            active,
            H264PipelineIdentity(
                captureStreamGeneration: 8,
                pipelineEpoch: 11
            )
        )
        XCTAssertNotEqual(
            active,
            H264PipelineIdentity(
                captureStreamGeneration: 7,
                pipelineEpoch: 12
            )
        )
    }

    func testThermalStateUsesStableProtocolValues() {
        XCTAssertEqual(LiveProtocol.thermalStateValue(.nominal), "nominal")
        XCTAssertEqual(LiveProtocol.thermalStateValue(.fair), "fair")
        XCTAssertEqual(LiveProtocol.thermalStateValue(.serious), "serious")
        XCTAssertEqual(LiveProtocol.thermalStateValue(.critical), "critical")
    }
}
