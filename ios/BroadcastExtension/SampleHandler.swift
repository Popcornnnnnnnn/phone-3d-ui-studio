import CoreImage
import ImageIO
import ReplayKit

final class SampleHandler: RPBroadcastSampleHandler {
    private let socket = LiveSocket()
    private lazy var motion = MotionStreamer(socket: socket)
    private let imageContext = CIContext(options: [.cacheIntermediates: false])
    private let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
    private var lastFrameTimestamp = CMTime.invalid
    private let minimumFrameInterval = CMTime(value: 1, timescale: 15)

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        guard
            let value = Bundle.main.object(forInfoDictionaryKey: "LiveBridgeURL") as? String,
            let url = URL(string: value)
        else {
            finishBroadcastWithError(BroadcastError.missingBridgeURL)
            return
        }

        socket.connect(to: url)
        motion.start()
    }

    override func broadcastPaused() {}

    override func broadcastResumed() {}

    override func broadcastFinished() {
        motion.stop()
        socket.disconnect()
    }

    override func processSampleBuffer(
        _ sampleBuffer: CMSampleBuffer,
        with sampleBufferType: RPSampleBufferType
    ) {
        guard sampleBufferType == .video else { return }

        let timestamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        if lastFrameTimestamp.isValid,
           CMTimeCompare(
               CMTimeSubtract(timestamp, lastFrameTimestamp),
               minimumFrameInterval
           ) < 0 {
            return
        }
        lastFrameTimestamp = timestamp

        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        var image = CIImage(cvPixelBuffer: pixelBuffer)

        if let orientation = imageOrientation(from: sampleBuffer) {
            image = image.oriented(orientation)
        }

        let extent = image.extent.integral
        guard
            extent.width > 0,
            extent.height > 0,
            let jpeg = imageContext.jpegRepresentation(
                of: image,
                colorSpace: colorSpace,
                options: [
                    CIImageRepresentationOption(
                        rawValue: kCGImageDestinationLossyCompressionQuality as String
                    ): 0.72
                ]
            )
        else { return }

        let width = Int(extent.width)
        let height = Int(extent.height)
        let metadata = FrameMetadataMessage(
            timestampMs: LiveProtocol.timestampMs(),
            width: width,
            height: height,
            orientation: height >= width ? "portrait" : "landscape"
        )
        guard let json = LiveProtocol.json(metadata) else { return }
        socket.sendFrame(metadata: json, jpegData: jpeg)
    }

    private func imageOrientation(
        from sampleBuffer: CMSampleBuffer
    ) -> CGImagePropertyOrientation? {
        guard
            let value = CMGetAttachment(
                sampleBuffer,
                key: RPVideoSampleOrientationKey as CFString,
                attachmentModeOut: nil
            ) as? NSNumber
        else { return nil }

        return CGImagePropertyOrientation(rawValue: value.uint32Value)
    }
}

private enum BroadcastError: LocalizedError {
    case missingBridgeURL

    var errorDescription: String? {
        "The LiveBridgeURL setting is missing or invalid."
    }
}
