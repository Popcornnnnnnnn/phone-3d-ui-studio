import CoreMedia
import CoreVideo
import Foundation
import VideoToolbox

struct H264FrameTiming {
    let frameId: Int64
    let captureAtMs: Int64
    let callbackAtMs: Int64
    let encodeStartedAtMs: Int64
    let width: Int
    let height: Int
    let orientation: String
}

private final class H264FrameTimingBox {
    let value: H264FrameTiming

    init(_ value: H264FrameTiming) {
        self.value = value
    }
}

private func phone3DCompressionOutputCallback(
    outputCallbackRefCon: UnsafeMutableRawPointer?,
    sourceFrameRefCon: UnsafeMutableRawPointer?,
    status: OSStatus,
    infoFlags: VTEncodeInfoFlags,
    sampleBuffer: CMSampleBuffer?
) {
    guard
        let outputCallbackRefCon,
        let sourceFrameRefCon
    else { return }

    let encoder = Unmanaged<H264Encoder>
        .fromOpaque(outputCallbackRefCon)
        .takeUnretainedValue()
    let timing = Unmanaged<H264FrameTimingBox>
        .fromOpaque(sourceFrameRefCon)
        .takeRetainedValue()
        .value
    encoder.handleOutput(
        status: status,
        infoFlags: infoFlags,
        sampleBuffer: sampleBuffer,
        timing: timing
    )
}

final class H264Encoder {
    typealias OutputHandler = (
        _ data: Data,
        _ timing: H264FrameTiming,
        _ isKeyframe: Bool
    ) -> Bool

    private let outputHandler: OutputHandler
    private var session: VTCompressionSession?
    private var dimensions: (width: Int, height: Int)?
    private let stateLock = NSLock()
    private var forceNextKeyframe = true
    private var lastEncodeStatus: OSStatus = noErr
    private var sessionResetCount = 0

    init(outputHandler: @escaping OutputHandler) {
        self.outputHandler = outputHandler
    }

    deinit {
        invalidate()
    }

    func invalidate() {
        guard let session else { return }
        VTCompressionSessionCompleteFrames(
            session,
            untilPresentationTimeStamp: .invalid
        )
        VTCompressionSessionInvalidate(session)
        self.session = nil
        dimensions = nil
        stateLock.withLock {
            forceNextKeyframe = true
        }
    }

    func requestKeyframe() {
        stateLock.withLock {
            forceNextKeyframe = true
        }
    }

    func diagnosticState() -> (status: OSStatus, resets: Int) {
        stateLock.withLock {
            (lastEncodeStatus, sessionResetCount)
        }
    }

    @discardableResult
    func encode(pixelBuffer: CVPixelBuffer, timing: H264FrameTiming) -> Bool {
        guard prepareSession(width: timing.width, height: timing.height),
              let session
        else { return false }

        let forceKeyframe = stateLock.withLock {
            let shouldForce = forceNextKeyframe || timing.frameId % 30 == 0
            forceNextKeyframe = false
            return shouldForce
        }

        let timingBox = H264FrameTimingBox(timing)
        let frameReference = Unmanaged.passRetained(timingBox).toOpaque()
        let presentationTime = CMTime(value: timing.frameId, timescale: 15)
        let frameProperties = forceKeyframe
            ? [kVTEncodeFrameOptionKey_ForceKeyFrame as String: true] as CFDictionary
            : nil
        var infoFlags = VTEncodeInfoFlags()
        let status = VTCompressionSessionEncodeFrame(
            session,
            imageBuffer: pixelBuffer,
            presentationTimeStamp: presentationTime,
            duration: CMTime(value: 1, timescale: 15),
            frameProperties: frameProperties,
            sourceFrameRefcon: frameReference,
            infoFlagsOut: &infoFlags
        )

        if status != noErr {
            Unmanaged<H264FrameTimingBox>
                .fromOpaque(frameReference)
                .release()
            stateLock.withLock {
                forceNextKeyframe = true
                lastEncodeStatus = status
                sessionResetCount += 1
            }
            // A VideoToolbox session that rejects one frame commonly keeps
            // rejecting every later frame. Recreate it on the next capture
            // callback instead of leaving the stream permanently frozen.
            VTCompressionSessionInvalidate(session)
            self.session = nil
            dimensions = nil
            return false
        }
        stateLock.withLock {
            lastEncodeStatus = noErr
        }
        return true
    }

    fileprivate func handleOutput(
        status: OSStatus,
        infoFlags: VTEncodeInfoFlags,
        sampleBuffer: CMSampleBuffer?,
        timing: H264FrameTiming
    ) {
        guard
            status == noErr,
            !infoFlags.contains(.frameDropped),
            let sampleBuffer,
            CMSampleBufferDataIsReady(sampleBuffer),
            let dataBuffer = CMSampleBufferGetDataBuffer(sampleBuffer)
        else { return }

        let attachments = CMSampleBufferGetSampleAttachmentsArray(
            sampleBuffer,
            createIfNecessary: false
        ) as? [[CFString: Any]]
        let isKeyframe = !(
            attachments?.first?[kCMSampleAttachmentKey_NotSync] as? Bool ?? false
        )

        var avccData = Data(count: CMBlockBufferGetDataLength(dataBuffer))
        let copyStatus = avccData.withUnsafeMutableBytes { buffer in
            guard let baseAddress = buffer.baseAddress else {
                return kCMBlockBufferBadOffsetParameterErr
            }
            return CMBlockBufferCopyDataBytes(
                dataBuffer,
                atOffset: 0,
                dataLength: buffer.count,
                destination: baseAddress
            )
        }
        guard copyStatus == kCMBlockBufferNoErr else { return }

        var annexBData = Data()
        if isKeyframe,
           let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer) {
            for index in 0..<2 {
                if let parameterSet = h264ParameterSet(
                    formatDescription: formatDescription,
                    index: index
                ) {
                    annexBData.append(contentsOf: [0, 0, 0, 1])
                    annexBData.append(parameterSet)
                }
            }
        }

        var offset = 0
        while offset + 4 <= avccData.count {
            let length =
                (Int(avccData[offset]) << 24) |
                (Int(avccData[offset + 1]) << 16) |
                (Int(avccData[offset + 2]) << 8) |
                Int(avccData[offset + 3])
            offset += 4
            guard length > 0, offset + length <= avccData.count else { break }
            annexBData.append(contentsOf: [0, 0, 0, 1])
            annexBData.append(avccData[offset..<(offset + length)])
            offset += length
        }

        guard !annexBData.isEmpty else { return }
        if !outputHandler(annexBData, timing, isKeyframe) {
            stateLock.withLock {
                forceNextKeyframe = true
            }
        }
    }

    private func prepareSession(width: Int, height: Int) -> Bool {
        if session != nil,
           dimensions?.width == width,
           dimensions?.height == height {
            return true
        }

        invalidate()
        var newSession: VTCompressionSession?
        let status = VTCompressionSessionCreate(
            allocator: kCFAllocatorDefault,
            width: Int32(width),
            height: Int32(height),
            codecType: kCMVideoCodecType_H264,
            encoderSpecification: nil,
            imageBufferAttributes: nil,
            compressedDataAllocator: nil,
            outputCallback: phone3DCompressionOutputCallback,
            refcon: Unmanaged.passUnretained(self).toOpaque(),
            compressionSessionOut: &newSession
        )
        guard status == noErr, let newSession else {
            stateLock.withLock {
                lastEncodeStatus = status
            }
            return false
        }

        VTSessionSetProperty(
            newSession,
            key: kVTCompressionPropertyKey_RealTime,
            value: kCFBooleanTrue
        )
        VTSessionSetProperty(
            newSession,
            key: kVTCompressionPropertyKey_AllowFrameReordering,
            value: kCFBooleanFalse
        )
        VTSessionSetProperty(
            newSession,
            key: kVTCompressionPropertyKey_ProfileLevel,
            value: kVTProfileLevel_H264_Baseline_4_1
        )
        VTSessionSetProperty(
            newSession,
            key: kVTCompressionPropertyKey_ExpectedFrameRate,
            value: NSNumber(value: 15)
        )
        VTSessionSetProperty(
            newSession,
            key: kVTCompressionPropertyKey_AverageBitRate,
            value: NSNumber(value: 4_000_000)
        )
        VTSessionSetProperty(
            newSession,
            key: kVTCompressionPropertyKey_DataRateLimits,
            value: [NSNumber(value: 625_000), NSNumber(value: 1)] as CFArray
        )
        VTSessionSetProperty(
            newSession,
            key: kVTCompressionPropertyKey_MaxKeyFrameInterval,
            value: NSNumber(value: 30)
        )
        VTSessionSetProperty(
            newSession,
            key: kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration,
            value: NSNumber(value: 2)
        )
        VTCompressionSessionPrepareToEncodeFrames(newSession)
        session = newSession
        dimensions = (width, height)
        return true
    }

    private func h264ParameterSet(
        formatDescription: CMFormatDescription,
        index: Int
    ) -> Data? {
        var pointer: UnsafePointer<UInt8>?
        var size = 0
        var count = 0
        var nalHeaderLength: Int32 = 0
        let status = CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
            formatDescription,
            parameterSetIndex: index,
            parameterSetPointerOut: &pointer,
            parameterSetSizeOut: &size,
            parameterSetCountOut: &count,
            nalUnitHeaderLengthOut: &nalHeaderLength
        )
        guard status == noErr, let pointer, size > 0 else { return nil }
        return Data(bytes: pointer, count: size)
    }
}
