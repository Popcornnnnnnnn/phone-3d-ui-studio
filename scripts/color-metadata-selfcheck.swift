// Compile with the actual production H264Encoder.swift and LiveProtocol.swift.
// This validates session transitions, not device picture or latency acceptance.
import CoreMedia
import CoreVideo
import Foundation
import VideoToolbox

final class ColorCheckOutput: @unchecked Sendable {
    let semaphore = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var value: Bool?
    func put(_ key: Bool) { lock.withLock { value = key }; semaphore.signal() }
    func take() throws -> Bool {
        guard semaphore.wait(timeout: .now() + 3) == .success,
              let key = lock.withLock({ value }) else { throw ColorCheckError.failed("Output timeout; not retried") }
        return key
    }
}
enum ColorCheckError: Error { case failed(String) }

@main struct ColorMetadataCheck {
    static func main() throws {
        var buffer: CVPixelBuffer?
        guard CVPixelBufferCreate(kCFAllocatorDefault, 64, 64,
            kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
            [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &buffer) == noErr,
              let buffer else { throw ColorCheckError.failed("Create NV12") }
        CVPixelBufferLockBaseAddress(buffer, [])
        for plane in 0..<CVPixelBufferGetPlaneCount(buffer) {
            memset(CVPixelBufferGetBaseAddressOfPlane(buffer, plane)!, plane == 0 ? 64 : 128,
                CVPixelBufferGetBytesPerRowOfPlane(buffer, plane) * CVPixelBufferGetHeightOfPlane(buffer, plane))
        }
        CVPixelBufferUnlockBaseAddress(buffer, [])
        let missing = H264SourceColorMetadata(pixelBuffer: buffer)
        guard missing.primaries == nil, missing.transfer == nil, missing.matrix == nil else {
            throw ColorCheckError.failed("Untagged input must stay untagged")
        }
        CVBufferSetAttachment(buffer, kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_ITU_R_709_2, .shouldPropagate)
        CVBufferSetAttachment(buffer, kCVImageBufferTransferFunctionKey, kCVImageBufferTransferFunction_sRGB, .shouldPropagate)
        CVBufferSetAttachment(buffer, kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_709_2, .shouldPropagate)
        let tagged = H264SourceColorMetadata(pixelBuffer: buffer)
        guard tagged != missing, tagged.matrix == kCVImageBufferYCbCrMatrix_ITU_R_709_2 as String else {
            throw ColorCheckError.failed("Read source tags")
        }
        let output = ColorCheckOutput()
        let encoder = H264Encoder(codecOutputHandler: { _, _, key, _, _, _ in output.put(key); return true })
        encoder.setTargetFrameRate(60)
        func encode(_ id: Int64) throws -> Bool {
            let timing = H264FrameTiming(frameId: id, captureAtMs: id * 17, callbackAtMs: id * 17,
                encodeStartedAtMs: id * 17, width: 64, height: 64, orientation: "portrait",
                captureContentStatus: "complete", freshContent: true, captureStreamGeneration: 1,
                h264PipelineEpoch: 1, sourcePresentationSeconds: Double(id) / 60)
            guard encoder.encode(pixelBuffer: buffer, timing: timing) else { throw ColorCheckError.failed("Encode rejected") }
            return try output.take()
        }
        guard try encode(0), try !encode(1) else { throw ColorCheckError.failed("Same tags should reuse the session") }
        for name in ["ColorPrimaries", "TransferFunction", "YCbCrMatrix"] {
            guard encoder.diagnosticState().propertyStatuses[name] == 0 else { throw ColorCheckError.failed("Color property rejected") }
        }
        CVBufferSetAttachment(buffer, kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_601_4, .shouldPropagate)
        guard H264SourceColorMetadata(pixelBuffer: buffer) != tagged,
              try encode(2), try !encode(3) else { throw ColorCheckError.failed("Changed matrix must start a new keyframe session") }
        CVBufferRemoveAllAttachments(buffer)
        guard H264SourceColorMetadata(pixelBuffer: buffer) == missing, try encode(4),
              encoder.diagnosticState().propertyStatuses["YCbCrMatrix"] == nil else {
            throw ColorCheckError.failed("Removed tags must not leak from previous session")
        }
        encoder.invalidate()
        print("PASS: missing tags, source tags, stable reuse, changed-matrix keyframe, and removed-tag session reset")
    }
}
