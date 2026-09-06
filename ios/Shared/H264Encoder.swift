import CoreMedia
import CoreVideo
import Foundation
import VideoToolbox

// Source tags are part of the compression-session identity, just like size.
// Never invent BT.709 for an untagged or differently tagged input buffer.
struct H264SourceColorMetadata: Equatable {
    let primaries: String?
    let transfer: String?
    let matrix: String?

    init(pixelBuffer: CVPixelBuffer) {
        primaries = CVBufferCopyAttachment(pixelBuffer, kCVImageBufferColorPrimariesKey, nil) as? String
        transfer = CVBufferCopyAttachment(pixelBuffer, kCVImageBufferTransferFunctionKey, nil) as? String
        matrix = CVBufferCopyAttachment(pixelBuffer, kCVImageBufferYCbCrMatrixKey, nil) as? String
    }
}

struct H264FrameTiming {
    let frameId: Int64
    let captureAtMs: Int64
    let callbackAtMs: Int64
    let encodeStartedAtMs: Int64
    let width: Int
    let height: Int
    let orientation: String
    let captureTimestampSource: String?
    let captureTimestampValid: Bool?
    let captureSampleAgeMs: Double?
    let captureContentStatus: String
    let freshContent: Bool
    let captureStreamGeneration: Int64
    let h264PipelineEpoch: UInt64
    let conversionStartedAtMs: Int64?
    let conversionEndedAtMs: Int64?
    let sourcePresentationSeconds: Double?

    init(
        frameId: Int64,
        captureAtMs: Int64,
        callbackAtMs: Int64,
        encodeStartedAtMs: Int64,
        width: Int,
        height: Int,
        orientation: String,
        captureTimestampSource: String? = nil,
        captureTimestampValid: Bool? = nil,
        captureSampleAgeMs: Double? = nil,
        captureContentStatus: String,
        freshContent: Bool,
        captureStreamGeneration: Int64,
        h264PipelineEpoch: UInt64,
        conversionStartedAtMs: Int64? = nil,
        conversionEndedAtMs: Int64? = nil,
        sourcePresentationSeconds: Double? = nil
    ) {
        self.frameId = frameId
        self.captureAtMs = captureAtMs
        self.callbackAtMs = callbackAtMs
        self.encodeStartedAtMs = encodeStartedAtMs
        self.width = width
        self.height = height
        self.orientation = orientation
        self.captureTimestampSource = captureTimestampSource
        self.captureTimestampValid = captureTimestampValid
        self.captureSampleAgeMs = captureSampleAgeMs
        self.captureContentStatus = captureContentStatus
        self.freshContent = freshContent
        self.captureStreamGeneration = captureStreamGeneration
        self.h264PipelineEpoch = h264PipelineEpoch
        self.conversionStartedAtMs = conversionStartedAtMs
        self.conversionEndedAtMs = conversionEndedAtMs
        self.sourcePresentationSeconds = sourcePresentationSeconds
    }

    func stampedForEncoding(at timestampMs: Int64) -> H264FrameTiming {
        H264FrameTiming(
            frameId: frameId,
            captureAtMs: captureAtMs,
            callbackAtMs: callbackAtMs,
            encodeStartedAtMs: timestampMs,
            width: width,
            height: height,
            orientation: orientation,
            captureTimestampSource: captureTimestampSource,
            captureTimestampValid: captureTimestampValid,
            captureSampleAgeMs: captureSampleAgeMs,
            captureContentStatus: captureContentStatus,
            freshContent: freshContent,
            captureStreamGeneration: captureStreamGeneration,
            h264PipelineEpoch: h264PipelineEpoch,
            conversionStartedAtMs: conversionStartedAtMs,
            conversionEndedAtMs: conversionEndedAtMs,
            sourcePresentationSeconds: sourcePresentationSeconds
        )
    }
}

private final class H264FrameTimingBox {
    let value: H264FrameTiming
    let requestedKeyframe: Bool
    let sessionGeneration: UInt64

    init(
        _ value: H264FrameTiming,
        requestedKeyframe: Bool,
        sessionGeneration: UInt64
    ) {
        self.value = value
        self.requestedKeyframe = requestedKeyframe
        self.sessionGeneration = sessionGeneration
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
    let timingBox = Unmanaged<H264FrameTimingBox>
        .fromOpaque(sourceFrameRefCon)
        .takeRetainedValue()
    encoder.handleOutput(
        status: status,
        infoFlags: infoFlags,
        sampleBuffer: sampleBuffer,
        timing: timingBox.value,
        requestedKeyframe: timingBox.requestedKeyframe,
        sessionGeneration: timingBox.sessionGeneration
    )
}

final class H264Encoder {
    enum Profile: String {
        case legacy
        case lowLatency = "low-latency"
    }

    enum BitstreamFormat: String {
        case annexB = "annex-b"
        case avcc
    }

    enum Tuning: String {
        case `default`
        case speedPriority = "speed-priority"
        case highSpeedPreset = "high-speed-preset"
        case videoConferencingPreset = "video-conferencing-preset"
    }

    typealias OutputHandler = (
        _ data: Data,
        _ timing: H264FrameTiming,
        _ isKeyframe: Bool
    ) -> Bool

    typealias CodecOutputHandler = (
        _ data: Data,
        _ timing: H264FrameTiming,
        _ isKeyframe: Bool,
        _ rfc6381Codec: String?,
        _ bitstreamFormat: BitstreamFormat,
        _ decoderDescription: Data?
    ) -> Bool

    private let outputHandler: CodecOutputHandler
    private var session: VTCompressionSession?
    private var dimensions: (width: Int, height: Int)?
    private var sourceColorMetadata: H264SourceColorMetadata?
    // VideoToolbox session creation, submission, and invalidation must be
    // serialized independently from the lightweight diagnostic state. In
    // particular, an encode failure must never tear down a replacement
    // session installed concurrently by a profile or tuning change.
    private let sessionLock = NSLock()
    private let stateLock = NSLock()
    private var nextSessionGeneration: UInt64 = 0
    private var sessionGeneration: UInt64?
    private var activeSessionGeneration: UInt64?
    private var forceNextKeyframe = true
    private var keyframeCadence = H264KeyframeCadence()
    // Serialized by sessionLock with the encoder session it belongs to.
    private var presentationTimeline = H264PresentationTimeline()
    private var lastEncodeStatus: OSStatus = noErr
    private var sessionResetCount = 0
    private var sessionNeedsReset = false
    private var inFlightFrameCount = 0
    private var busyDropCount: Int64 = 0
    private var maxFrameDelayZeroStatus: OSStatus?
    private var maxFrameDelayFallbackStatus: OSStatus?
    private var effectiveMaxFrameDelayCount: Int?
    private var targetFrameRate = 20
    // 960 x 2088 text-heavy iPhone UI needs this budget to avoid persistent
    // vertical smearing on the physical encoder. The wireless A/B evidence is
    // recorded in experiments/live-screen-latency/QUALITY_FINDINGS.md.
    private var averageBitRate = 15_000_000
    private var selectedProfile: Profile = .legacy
    private var selectedTuning: Tuning = .default
    private var selectedBitstreamFormat: BitstreamFormat = .annexB
    private var activeProfile: Profile?
    private var activeTuning: Tuning?
    private var sessionCreateStatus: OSStatus?
    private var propertyStatuses: [String: OSStatus] = [:]
    private var prepareStatus: OSStatus?
    private var hardwareQueryStatus: OSStatus?
    private var usingHardwareEncoder: Bool?
    private var rfc6381Codec: String?
    private var tuningPresetQueryStatus: OSStatus?
    private var tuningPresetApplyStatus: OSStatus?
    private var tuningPresetSupported: Bool?
    private var tuningPresetPropertyCount: Int?
    private var tuningFallbackReason: String?
    private var tuningEvents: [String] = []

    init(outputHandler: @escaping OutputHandler) {
        self.outputHandler = { data, timing, isKeyframe, _, _, _ in
            outputHandler(data, timing, isKeyframe)
        }
    }

    init(codecOutputHandler: @escaping CodecOutputHandler) {
        outputHandler = codecOutputHandler
    }

    deinit {
        invalidate()
    }

    func invalidate() {
        sessionLock.withLock {
            invalidateSessionLocked(completeFrames: true)
        }
    }

    private func invalidateSessionLocked(completeFrames: Bool) {
        presentationTimeline.reset()
        let invalidatedSession = session
        session = nil
        sessionGeneration = nil
        dimensions = nil
        sourceColorMetadata = nil
        stateLock.withLock {
            forceNextKeyframe = true
            keyframeCadence.reset()
            inFlightFrameCount = 0
            clearActiveSessionDiagnosticsLocked()
        }
        if let invalidatedSession {
            if completeFrames {
                VTCompressionSessionCompleteFrames(
                    invalidatedSession,
                    untilPresentationTimeStamp: .invalid
                )
            }
            VTCompressionSessionInvalidate(invalidatedSession)
        }
        // CompleteFrames may synchronously deliver a final successful output
        // callback. Clear its codec observation once more after the session is
        // definitively invalidated.
        stateLock.withLock {
            forceNextKeyframe = true
            keyframeCadence.reset()
            sessionNeedsReset = false
            inFlightFrameCount = 0
            clearActiveSessionDiagnosticsLocked()
        }
    }

    // Must be called while holding stateLock. Attempt/error diagnostics are
    // intentionally retained, but values that describe a usable active
    // session must disappear atomically with that session.
    private func clearActiveSessionDiagnosticsLocked() {
        activeSessionGeneration = nil
        activeProfile = nil
        activeTuning = nil
        effectiveMaxFrameDelayCount = nil
        hardwareQueryStatus = nil
        usingHardwareEncoder = nil
        rfc6381Codec = nil
    }

    private func invalidateCandidateSession(
        _ candidate: VTCompressionSession?,
        failureStatus: OSStatus
    ) {
        if let candidate {
            VTCompressionSessionInvalidate(candidate)
        }
        stateLock.withLock {
            lastEncodeStatus = failureStatus
            sessionNeedsReset = false
            clearActiveSessionDiagnosticsLocked()
        }
    }

    private func resetAttemptDiagnosticsLocked() {
        sessionCreateStatus = nil
        propertyStatuses.removeAll(keepingCapacity: true)
        prepareStatus = nil
        maxFrameDelayZeroStatus = nil
        maxFrameDelayFallbackStatus = nil
        hardwareQueryStatus = nil
        rfc6381Codec = nil
        tuningPresetQueryStatus = nil
        tuningPresetApplyStatus = nil
        tuningPresetSupported = nil
        tuningPresetPropertyCount = nil
        tuningFallbackReason = nil
        tuningEvents.removeAll(keepingCapacity: true)
        clearActiveSessionDiagnosticsLocked()
    }

    private func invalidatePreparedSessionAfterSubmissionFailure(
        _ failedSession: VTCompressionSession,
        status: OSStatus
    ) {
        // encode() holds sessionLock, so this identity cannot be replaced
        // between submission and failure cleanup.
        if session === failedSession {
            invalidateSessionLocked(completeFrames: false)
        } else {
            VTCompressionSessionCompleteFrames(
                failedSession,
                untilPresentationTimeStamp: .invalid
            )
            VTCompressionSessionInvalidate(failedSession)
        }
        stateLock.withLock {
            forceNextKeyframe = true
            lastEncodeStatus = status
            sessionResetCount += 1
            inFlightFrameCount = 0
            clearActiveSessionDiagnosticsLocked()
        }
    }

    func requestKeyframe() {
        stateLock.withLock {
            forceNextKeyframe = true
        }
    }

    func setTargetFrameRate(_ value: Int) {
        let boundedValue = min(120, max(15, value))
        sessionLock.withLock {
            let changed = stateLock.withLock {
                targetFrameRate != boundedValue
            }
            guard changed else { return }
            invalidateSessionLocked(completeFrames: true)
            stateLock.withLock {
                targetFrameRate = boundedValue
            }
        }
    }

    func setProfile(_ value: Profile) {
        sessionLock.withLock {
            let changed = stateLock.withLock {
                selectedProfile != value
            }
            guard changed else { return }

            // Complete the old profile before publishing the new selection so
            // any final callback is still identified with its original session.
            invalidateSessionLocked(completeFrames: true)
            stateLock.withLock {
                selectedProfile = value
            }
        }
    }

    /// Changes only the rate budget; the 1.2x one-second peak allowance follows
    /// it so a higher average is not silently constrained by the old 6 Mbps cap.
    /// Session replacement preserves the existing keyframe/generation contract.
    @discardableResult
    func setAverageBitRate(_ value: Int) -> Bool {
        guard (1_000_000...20_000_000).contains(value) else { return false }
        sessionLock.withLock {
            guard stateLock.withLock({ averageBitRate != value }) else { return }
            invalidateSessionLocked(completeFrames: true)
            stateLock.withLock { averageBitRate = value }
        }
        return true
    }

    func setTuning(_ value: Tuning) {
        sessionLock.withLock {
            let changed = stateLock.withLock {
                selectedTuning != value
            }
            guard changed else { return }

            // Keep the tuning associated with the session that produced any
            // final callback, then force a fresh IDR from the replacement session.
            invalidateSessionLocked(completeFrames: true)
            stateLock.withLock {
                selectedTuning = value
            }
        }
    }

    func setBitstreamFormat(_ value: BitstreamFormat) {
        sessionLock.withLock {
            let changed = stateLock.withLock {
                selectedBitstreamFormat != value
            }
            guard changed else { return }

            // Finish callbacks with the old framing before publishing the new
            // selection. The new session starts with a forced IDR and fresh avcC.
            invalidateSessionLocked(completeFrames: true)
            stateLock.withLock {
                selectedBitstreamFormat = value
            }
        }
    }

    func canAcceptFrame() -> Bool {
        stateLock.withLock {
            guard inFlightFrameCount == 0 else {
                busyDropCount += 1
                return false
            }
            return true
        }
    }

    func diagnosticState() -> (
        status: OSStatus,
        resets: Int,
        inFlight: Int,
        busyDrops: Int64,
        maxFrameDelayZeroStatus: OSStatus?,
        maxFrameDelayFallbackStatus: OSStatus?,
        effectiveMaxFrameDelayCount: Int?,
        selectedProfile: String,
        activeProfile: String?,
        selectedTuning: String,
        activeTuning: String?,
        sessionCreateStatus: OSStatus?,
        propertyStatuses: [String: OSStatus],
        prepareStatus: OSStatus?,
        hardwareQueryStatus: OSStatus?,
        usingHardwareEncoder: Bool?,
        rfc6381Codec: String?,
        tuningPresetQueryStatus: OSStatus?,
        tuningPresetApplyStatus: OSStatus?,
        tuningPresetSupported: Bool?,
        tuningPresetPropertyCount: Int?,
        tuningFallbackReason: String?,
        tuningEvents: [String]
    ) {
        stateLock.withLock {
            (
                lastEncodeStatus,
                sessionResetCount,
                inFlightFrameCount,
                busyDropCount,
                maxFrameDelayZeroStatus,
                maxFrameDelayFallbackStatus,
                effectiveMaxFrameDelayCount,
                selectedProfile.rawValue,
                activeProfile?.rawValue,
                selectedTuning.rawValue,
                activeTuning?.rawValue,
                sessionCreateStatus,
                propertyStatuses,
                prepareStatus,
                hardwareQueryStatus,
                usingHardwareEncoder,
                rfc6381Codec,
                tuningPresetQueryStatus,
                tuningPresetApplyStatus,
                tuningPresetSupported,
                tuningPresetPropertyCount,
                tuningFallbackReason,
                tuningEvents
            )
        }
    }

    func bitstreamFormatDiagnosticValue() -> String {
        stateLock.withLock { selectedBitstreamFormat.rawValue }
    }

    func averageBitRateDiagnosticValue() -> Int {
        stateLock.withLock { averageBitRate }
    }

    @discardableResult
    func encode(pixelBuffer: CVPixelBuffer, timing: H264FrameTiming) -> Bool {
        sessionLock.lock()
        defer { sessionLock.unlock() }
        guard prepareSession(width: timing.width, height: timing.height,
              colorMetadata: H264SourceColorMetadata(pixelBuffer: pixelBuffer)),
              let session,
              let sessionGeneration
        else { return false }

        let reservedFrame = stateLock.withLock {
            guard inFlightFrameCount == 0 else {
                busyDropCount += 1
                return false
            }
            inFlightFrameCount = 1
            return true
        }
        guard reservedFrame else { return false }

        let encoderConfiguration = stateLock.withLock {
            (frameRate: targetFrameRate, profile: selectedProfile)
        }
        let encodingFrameRate = encoderConfiguration.frameRate
        let keyframeInterval = Int64(max(1, encodingFrameRate * 2))
        let submissionUptime = ProcessInfo.processInfo.systemUptime
        let forceKeyframe = stateLock.withLock {
            let shouldForce = keyframeCadence.shouldForceKeyframe(
                at: submissionUptime,
                explicitlyRequested: forceNextKeyframe
            ) || (
                encoderConfiguration.profile == .legacy &&
                timing.frameId % keyframeInterval == 0
            )
            forceNextKeyframe = false
            return shouldForce
        }

        let presentationTime = CMTime(
            seconds: presentationTimeline.next(
                sourceSeconds: timing.sourcePresentationSeconds ?? Double(timing.captureAtMs) / 1_000,
                nominalFramesPerSecond: encodingFrameRate
            ),
            preferredTimescale: 1_000_000
        )
        let frameProperties = forceKeyframe
            ? [kVTEncodeFrameOptionKey_ForceKeyFrame as String: true] as CFDictionary
            : nil
        // Stamp this after conversion and immediately before submission so
        // encode duration does not accidentally include Core Image work.
        let submittedTiming = timing.stampedForEncoding(
            at: LiveProtocol.timestampMs()
        )
        let timingBox = H264FrameTimingBox(
            submittedTiming,
            requestedKeyframe: forceKeyframe,
            sessionGeneration: sessionGeneration
        )
        let frameReference = Unmanaged.passRetained(timingBox).toOpaque()
        var infoFlags = VTEncodeInfoFlags()
        let status = VTCompressionSessionEncodeFrame(
            session,
            imageBuffer: pixelBuffer,
            presentationTimeStamp: presentationTime,
            // The next admitted capture time is not known yet. Supplying a
            // fixed 1/60 duration would contradict sparse source timestamps.
            duration: .invalid,
            frameProperties: frameProperties,
            sourceFrameRefcon: frameReference,
            infoFlagsOut: &infoFlags
        )

        if status != noErr {
            Unmanaged<H264FrameTimingBox>
                .fromOpaque(frameReference)
                .release()
            // A VideoToolbox session that rejects one frame commonly keeps
            // rejecting every later frame. Recreate it on the next capture
            // callback instead of leaving the stream permanently frozen.
            invalidatePreparedSessionAfterSubmissionFailure(session, status: status)
            return false
        }
        stateLock.withLock {
            // A VideoToolbox callback may fail synchronously during the
            // submission call. Do not overwrite that failure merely because
            // the submission API itself returned noErr.
            if !sessionNeedsReset {
                lastEncodeStatus = noErr
            }
        }
        return true
    }

    fileprivate func handleOutput(
        status: OSStatus,
        infoFlags: VTEncodeInfoFlags,
        sampleBuffer: CMSampleBuffer?,
        timing: H264FrameTiming,
        requestedKeyframe: Bool,
        sessionGeneration: UInt64
    ) {
        let isCurrentSession = stateLock.withLock {
            guard activeSessionGeneration == sessionGeneration else {
                return false
            }
            lastEncodeStatus = status
            if status != noErr {
                inFlightFrameCount = 0
                forceNextKeyframe = true
                sessionNeedsReset = true
                clearActiveSessionDiagnosticsLocked()
            }
            return true
        }
        guard isCurrentSession else { return }
        // Admission remains reserved until the encoded packet has entered the
        // transport window. Releasing before outputHandler lets the next
        // capture observe stale free capacity while this callback is packing.
        defer {
            stateLock.withLock {
                if activeSessionGeneration == sessionGeneration {
                    inFlightFrameCount = max(0, inFlightFrameCount - 1)
                }
            }
        }
        guard
            status == noErr,
            !infoFlags.contains(.frameDropped),
            let sampleBuffer,
            CMSampleBufferDataIsReady(sampleBuffer),
            let dataBuffer = CMSampleBufferGetDataBuffer(sampleBuffer)
        else {
            restoreRequestedKeyframeIfNeeded(
                requestedKeyframe,
                sessionGeneration: sessionGeneration
            )
            return
        }

        let attachments = CMSampleBufferGetSampleAttachmentsArray(
            sampleBuffer,
            createIfNecessary: false
        ) as? [[CFString: Any]]
        let isKeyframe = !(
            attachments?.first?[kCMSampleAttachmentKey_NotSync] as? Bool ?? false
        )
        let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer)
        let outputCodec = formatDescription.flatMap(rfc6381CodecString)
        let outputCodecState = stateLock.withLock {
            guard activeSessionGeneration == sessionGeneration else {
                return (isCurrent: false, codec: nil as String?)
            }
            if let outputCodec {
                rfc6381Codec = outputCodec
            }
            return (isCurrent: true, codec: rfc6381Codec)
        }
        guard outputCodecState.isCurrent else { return }
        let effectiveOutputCodec = outputCodecState.codec

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
        guard copyStatus == kCMBlockBufferNoErr else {
            restoreRequestedKeyframeIfNeeded(
                requestedKeyframe,
                sessionGeneration: sessionGeneration
            )
            return
        }

        let bitstreamFormat = stateLock.withLock { selectedBitstreamFormat }
        let outputData: Data
        let decoderDescription: Data?
        switch bitstreamFormat {
        case .annexB:
            var annexBData = Data()
            if isKeyframe, let formatDescription {
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
            guard !annexBData.isEmpty else {
                restoreRequestedKeyframeIfNeeded(
                    requestedKeyframe,
                    sessionGeneration: sessionGeneration
                )
                return
            }
            outputData = annexBData
            decoderDescription = nil
        case .avcc:
            guard !avccData.isEmpty else {
                restoreRequestedKeyframeIfNeeded(
                    requestedKeyframe,
                    sessionGeneration: sessionGeneration
                )
                return
            }
            if isKeyframe {
                guard
                    let formatDescription,
                    let configuration = avcDecoderConfigurationRecord(
                        formatDescription: formatDescription
                    )
                else {
                    restoreRequestedKeyframeIfNeeded(
                        requestedKeyframe,
                        sessionGeneration: sessionGeneration
                    )
                    return
                }
                decoderDescription = configuration
            } else {
                decoderDescription = nil
            }
            outputData = avccData
        }
        if requestedKeyframe, !isKeyframe {
            restoreRequestedKeyframeIfNeeded(
                true,
                sessionGeneration: sessionGeneration
            )
        }
        guard stateLock.withLock({
            activeSessionGeneration == sessionGeneration
        }) else { return }
        if !outputHandler(
            outputData,
            timing,
            isKeyframe,
            effectiveOutputCodec,
            bitstreamFormat,
            decoderDescription
        ) {
            stateLock.withLock {
                if activeSessionGeneration == sessionGeneration {
                    forceNextKeyframe = true
                }
            }
        }
    }

    private func restoreRequestedKeyframeIfNeeded(
        _ requestedKeyframe: Bool,
        sessionGeneration: UInt64
    ) {
        guard requestedKeyframe else { return }
        stateLock.withLock {
            guard activeSessionGeneration == sessionGeneration else { return }
            forceNextKeyframe = true
        }
    }

    private func prepareSession(width: Int, height: Int, colorMetadata: H264SourceColorMetadata) -> Bool {
        let needsReset = stateLock.withLock { sessionNeedsReset }
        if needsReset {
            // A callback can report an invalid/malfunctioning session after a
            // successful submission. Retire it before considering reuse.
            invalidateSessionLocked(completeFrames: false)
        }
        if session != nil,
           dimensions?.width == width,
           dimensions?.height == height,
           sourceColorMetadata == colorMetadata {
            return true
        }

        // prepareSession is only called from encode() while sessionLock is held.
        invalidateSessionLocked(completeFrames: true)
        let encoderConfiguration = stateLock.withLock {
            (
                frameRate: targetFrameRate,
                profile: selectedProfile,
                tuning: selectedTuning,
                bitRate: averageBitRate
            )
        }
        stateLock.withLock {
            resetAttemptDiagnosticsLocked()
            tuningEvents = ["requested=\(encoderConfiguration.tuning.rawValue)"]
        }

        if prepareSessionAttempt(
            width: width,
            height: height,
            frameRate: encoderConfiguration.frameRate,
            profile: encoderConfiguration.profile,
            tuning: encoderConfiguration.tuning,
            bitRate: encoderConfiguration.bitRate,
            colorMetadata: colorMetadata
        ) {
            return true
        }

        guard encoderConfiguration.profile == .lowLatency else { return false }

        // The low-latency encoder is optional even on OS releases that expose
        // its VideoToolbox key. Fall back once, in the same admission attempt,
        // rather than retrying a failing session on every ReplayKit callback.
        // `selectedProfile` remains the requested value while `activeProfile`
        // reports the encoder that actually produced the stream.
        retainLowLatencyFallbackDiagnostics()
        return prepareSessionAttempt(
            width: width,
            height: height,
            frameRate: encoderConfiguration.frameRate,
            profile: .legacy,
            tuning: encoderConfiguration.tuning,
            bitRate: encoderConfiguration.bitRate,
            colorMetadata: colorMetadata
        )
    }

    private func prepareSessionAttempt(
        width: Int,
        height: Int,
        frameRate: Int,
        profile: Profile,
        tuning: Tuning,
        bitRate: Int,
        colorMetadata: H264SourceColorMetadata
    ) -> Bool {
        stateLock.withLock {
            sessionCreateStatus = nil
            self.prepareStatus = nil
            maxFrameDelayZeroStatus = nil
            maxFrameDelayFallbackStatus = nil
            clearActiveSessionDiagnosticsLocked()
            tuningPresetQueryStatus = nil
            tuningPresetApplyStatus = nil
            tuningPresetSupported = nil
            tuningPresetPropertyCount = nil
            tuningFallbackReason = nil
            tuningEvents.append("attempt-profile=\(profile.rawValue)")
        }

        var encoderSpecification: CFDictionary?
        if profile == .lowLatency {
            encoderSpecification = [
                kVTVideoEncoderSpecification_EnableLowLatencyRateControl as String:
                    kCFBooleanTrue as Any
            ] as CFDictionary
        }
        var newSession: VTCompressionSession?
        let status = VTCompressionSessionCreate(
            allocator: kCFAllocatorDefault,
            width: Int32(width),
            height: Int32(height),
            codecType: kCMVideoCodecType_H264,
            encoderSpecification: encoderSpecification,
            imageBufferAttributes: nil,
            compressedDataAllocator: nil,
            outputCallback: phone3DCompressionOutputCallback,
            refcon: Unmanaged.passUnretained(self).toOpaque(),
            compressionSessionOut: &newSession
        )
        stateLock.withLock {
            sessionCreateStatus = status
        }
        guard status == noErr else {
            invalidateCandidateSession(newSession, failureStatus: status)
            return false
        }
        guard newSession != nil else {
            invalidateCandidateSession(
                nil,
                failureStatus: kVTVideoEncoderMalfunctionErr
            )
            return false
        }
        let createdSession = newSession!

        // Presets are base dictionaries. Apply them before the explicit stream
        // contract below so real-time mode, no reordering, profile, rate, and
        // bitrate remain authoritative for this encoder.
        var effectiveTuning = applyPresetTuningIfRequested(
            tuning,
            profile: profile,
            to: createdSession
        )

        // Pixel-buffer attachments alone did not populate the Annex-B SPS/VUI
        // in captured device samples. Publish the input's explicit color tags
        // to the encoder before preparation; otherwise receivers guess different
        // matrices/transfers. Property statuses remain visible for unsupported
        // hardware; only actual encoded SPS proves the tags were retained.
        for (key, value, name) in [
            (kVTCompressionPropertyKey_ColorPrimaries, colorMetadata.primaries, "ColorPrimaries"),
            (kVTCompressionPropertyKey_TransferFunction, colorMetadata.transfer, "TransferFunction"),
            (kVTCompressionPropertyKey_YCbCrMatrix, colorMetadata.matrix, "YCbCrMatrix"),
        ] {
            if let value {
                setCompressionProperty(createdSession, key: key, value: value as CFString, diagnosticName: name)
            }
        }

        setCompressionProperty(
            createdSession,
            key: kVTCompressionPropertyKey_RealTime,
            value: kCFBooleanTrue,
            diagnosticName: "RealTime"
        )
        setCompressionProperty(
            createdSession,
            key: kVTCompressionPropertyKey_AllowFrameReordering,
            value: kCFBooleanFalse,
            diagnosticName: "AllowFrameReordering"
        )
        var speedPriorityStatus: OSStatus?
        if profile == .legacy {
            setCompressionProperty(
                createdSession,
                key: kVTCompressionPropertyKey_ProfileLevel,
                // Let VideoToolbox raise the level when a 960 px short edge is
                // benchmarked above 30 fps. Pinning Level 4.1 silently exceeds
                // its macroblock-rate budget at this phone aspect ratio.
                value: kVTProfileLevel_H264_Baseline_AutoLevel,
                diagnosticName: "ProfileLevel"
            )
        } else {
            // Low-latency rate control chooses its own compatible H.264
            // profile. In particular, never force Baseline on this path.
            speedPriorityStatus = setCompressionProperty(
                createdSession,
                key: kVTCompressionPropertyKey_PrioritizeEncodingSpeedOverQuality,
                value: kCFBooleanTrue,
                diagnosticName: "PrioritizeEncodingSpeedOverQuality"
            )
        }
        if profile == .legacy, tuning == .speedPriority {
            speedPriorityStatus = setCompressionProperty(
                createdSession,
                key: kVTCompressionPropertyKey_PrioritizeEncodingSpeedOverQuality,
                value: kCFBooleanTrue,
                diagnosticName: "PrioritizeEncodingSpeedOverQuality"
            )
        }
        if tuning == .speedPriority {
            if profile == .legacy {
                effectiveTuning = resolveSpeedPriorityTuning(
                    status: speedPriorityStatus,
                    profile: profile
                )
            } else {
                recordPresetConstraintFallback(
                    tuning: tuning,
                    profile: profile,
                    requiredProfile: .legacy
                )
                effectiveTuning = .default
            }
        }
        let encodingFrameRate = frameRate
        setCompressionProperty(
            createdSession,
            key: kVTCompressionPropertyKey_ExpectedFrameRate,
            value: NSNumber(value: encodingFrameRate),
            diagnosticName: "ExpectedFrameRate"
        )
        let zeroDelayStatus = setCompressionProperty(
            createdSession,
            key: kVTCompressionPropertyKey_MaxFrameDelayCount,
            value: NSNumber(value: 0),
            diagnosticName: "MaxFrameDelayCount.0"
        )
        var fallbackDelayStatus: OSStatus?
        var appliedDelayCount: Int?
        if zeroDelayStatus == noErr {
            appliedDelayCount = 0
        } else {
            let status = setCompressionProperty(
                createdSession,
                key: kVTCompressionPropertyKey_MaxFrameDelayCount,
                value: NSNumber(value: 1),
                diagnosticName: "MaxFrameDelayCount.1"
            )
            fallbackDelayStatus = status
            if status == noErr {
                appliedDelayCount = 1
            }
        }
        stateLock.withLock {
            maxFrameDelayZeroStatus = zeroDelayStatus
            maxFrameDelayFallbackStatus = fallbackDelayStatus
        }
        setCompressionProperty(
            createdSession,
            key: kVTCompressionPropertyKey_AverageBitRate,
            value: NSNumber(value: bitRate),
            diagnosticName: "AverageBitRate"
        )
        setCompressionProperty(
            createdSession,
            key: kVTCompressionPropertyKey_DataRateLimits,
            value: [NSNumber(value: bitRate * 3 / 20), NSNumber(value: 1)] as CFArray,
            diagnosticName: "DataRateLimits"
        )
        if profile == .legacy {
            setCompressionProperty(
                createdSession,
                key: kVTCompressionPropertyKey_MaxKeyFrameInterval,
                value: NSNumber(value: encodingFrameRate * 2),
                diagnosticName: "MaxKeyFrameInterval"
            )
            setCompressionProperty(
                createdSession,
                key: kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration,
                value: NSNumber(value: 2),
                diagnosticName: "MaxKeyFrameIntervalDuration"
            )
        }
        if let fatalPropertyStatus = stateLock.withLock({
            propertyStatuses.values.first(where: isSessionInvalidatingStatus)
        }) {
            invalidateCandidateSession(
                createdSession,
                failureStatus: fatalPropertyStatus
            )
            return false
        }
        let sessionPrepareStatus = VTCompressionSessionPrepareToEncodeFrames(createdSession)
        stateLock.withLock {
            prepareStatus = sessionPrepareStatus
        }
        guard sessionPrepareStatus == noErr else {
            invalidateCandidateSession(
                createdSession,
                failureStatus: sessionPrepareStatus
            )
            return false
        }
        let hardwareDiagnostics = readHardwareDiagnostics(for: createdSession)
        nextSessionGeneration &+= 1
        let preparedSessionGeneration = nextSessionGeneration
        session = createdSession
        sessionGeneration = preparedSessionGeneration
        dimensions = (width, height)
        sourceColorMetadata = colorMetadata
        stateLock.withLock {
            activeSessionGeneration = preparedSessionGeneration
            activeProfile = profile
            activeTuning = effectiveTuning
            effectiveMaxFrameDelayCount = appliedDelayCount
            hardwareQueryStatus = hardwareDiagnostics.status
            usingHardwareEncoder = hardwareDiagnostics.usingHardwareEncoder
            sessionNeedsReset = false
            lastEncodeStatus = noErr
        }
        return true
    }

    private func applyPresetTuningIfRequested(
        _ tuning: Tuning,
        profile: Profile,
        to session: VTCompressionSession
    ) -> Tuning {
        let presetKey: CFString
        switch tuning {
        case .default:
            stateLock.withLock {
                tuningEvents.append("profile=\(profile.rawValue);active=default")
            }
            return .default
        case .speedPriority:
            // This is a single explicit property rather than a preset. It is
            // applied alongside the corresponding existing profile property.
            return .default
        case .highSpeedPreset:
            guard profile == .legacy else {
                recordPresetConstraintFallback(
                    tuning: tuning,
                    profile: profile,
                    requiredProfile: .legacy
                )
                return .default
            }
            presetKey = kVTCompressionPreset_HighSpeed
        case .videoConferencingPreset:
            guard profile == .lowLatency else {
                recordPresetConstraintFallback(
                    tuning: tuning,
                    profile: profile,
                    requiredProfile: .lowLatency
                )
                return .default
            }
            presetKey = kVTCompressionPreset_VideoConferencing
        }

        var copiedPresetDictionaries: Unmanaged<CFTypeRef>?
        let queryStatus = VTSessionCopyProperty(
            session,
            key: kVTCompressionPropertyKey_SupportedPresetDictionaries,
            allocator: kCFAllocatorDefault,
            valueOut: &copiedPresetDictionaries
        )
        let diagnosticPrefix = "Tuning.\(profile.rawValue).\(tuning.rawValue)"
        stateLock.withLock {
            tuningPresetQueryStatus = queryStatus
            propertyStatuses["\(diagnosticPrefix).PresetQuery"] = queryStatus
            tuningEvents.append(
                "profile=\(profile.rawValue);preset=\(tuning.rawValue);query=\(queryStatus)"
            )
        }
        guard queryStatus == noErr else {
            recordTuningFallback(
                "preset-query-failed(status:\(queryStatus))",
                profile: profile,
                tuning: tuning
            )
            return .default
        }

        let copiedValue = copiedPresetDictionaries?.takeRetainedValue()
        guard let presetDictionaries = copiedValue as? NSDictionary else {
            stateLock.withLock {
                tuningPresetSupported = false
                propertyStatuses["\(diagnosticPrefix).PresetLookup"] =
                    kVTPropertyNotSupportedErr
            }
            recordTuningFallback(
                "preset-dictionary-missing",
                profile: profile,
                tuning: tuning
            )
            return .default
        }
        guard
            let presetProperties = presetDictionaries.object(forKey: presetKey)
                as? NSDictionary
        else {
            stateLock.withLock {
                tuningPresetSupported = false
                propertyStatuses["\(diagnosticPrefix).PresetLookup"] =
                    kVTPropertyNotSupportedErr
                tuningEvents.append(
                    "profile=\(profile.rawValue);preset=\(tuning.rawValue);supported=false"
                )
            }
            recordTuningFallback(
                "preset-unsupported",
                profile: profile,
                tuning: tuning
            )
            return .default
        }

        stateLock.withLock {
            tuningPresetSupported = true
            tuningPresetPropertyCount = presetProperties.count
            propertyStatuses["\(diagnosticPrefix).PresetLookup"] = noErr
            tuningEvents.append(
                "profile=\(profile.rawValue);preset=\(tuning.rawValue);supported=true;properties=\(presetProperties.count)"
            )
        }
        let applyStatus = VTSessionSetProperties(
            session,
            propertyDictionary: presetProperties
        )
        stateLock.withLock {
            tuningPresetApplyStatus = applyStatus
            propertyStatuses["\(diagnosticPrefix).PresetApply"] = applyStatus
            tuningEvents.append(
                "profile=\(profile.rawValue);preset=\(tuning.rawValue);apply=\(applyStatus)"
            )
        }
        guard applyStatus == noErr else {
            recordTuningFallback(
                "preset-apply-failed(status:\(applyStatus))",
                profile: profile,
                tuning: tuning
            )
            return .default
        }
        return tuning
    }

    private func resolveSpeedPriorityTuning(
        status: OSStatus?,
        profile: Profile
    ) -> Tuning {
        guard status == noErr else {
            let effectiveStatus = status ?? kVTPropertyNotSupportedErr
            recordTuningFallback(
                "speed-priority-unsupported(status:\(effectiveStatus))",
                profile: profile,
                tuning: .speedPriority
            )
            return .default
        }
        stateLock.withLock {
            tuningEvents.append(
                "profile=\(profile.rawValue);tuning=speed-priority;apply=0"
            )
        }
        return .speedPriority
    }

    private func recordPresetConstraintFallback(
        tuning: Tuning,
        profile: Profile,
        requiredProfile: Profile
    ) {
        let diagnosticName =
            "Tuning.\(profile.rawValue).\(tuning.rawValue).ProfileConstraint"
        stateLock.withLock {
            tuningPresetSupported = false
            propertyStatuses[diagnosticName] = kVTPropertyNotSupportedErr
            tuningEvents.append(
                "profile=\(profile.rawValue);preset=\(tuning.rawValue);constraint=requires-\(requiredProfile.rawValue)"
            )
        }
        recordTuningFallback(
            "profile-mismatch(requires:\(requiredProfile.rawValue))",
            profile: profile,
            tuning: tuning
        )
    }

    private func recordTuningFallback(
        _ reason: String,
        profile: Profile,
        tuning: Tuning
    ) {
        stateLock.withLock {
            tuningFallbackReason = reason
            tuningEvents.append(
                "profile=\(profile.rawValue);tuning=\(tuning.rawValue);fallback=default;reason=\(reason)"
            )
        }
    }

    private func retainLowLatencyFallbackDiagnostics() {
        stateLock.withLock {
            if let status = sessionCreateStatus, status != noErr {
                propertyStatuses["LowLatencyFallback.SessionCreate"] = status
            }
            if let status = prepareStatus, status != noErr {
                propertyStatuses["LowLatencyFallback.Prepare"] = status
            }
            tuningEvents.append("profile-fallback=low-latency-to-legacy")
        }
    }

    @discardableResult
    private func setCompressionProperty(
        _ session: VTCompressionSession,
        key: CFString,
        value: CFTypeRef,
        diagnosticName: String
    ) -> OSStatus {
        let status = VTSessionSetProperty(session, key: key, value: value)
        stateLock.withLock {
            propertyStatuses[diagnosticName] = status
        }
        return status
    }

    private func isSessionInvalidatingStatus(_ status: OSStatus) -> Bool {
        status == kVTInvalidSessionErr ||
            status == kVTVideoEncoderMalfunctionErr ||
            status == kVTAllocationFailedErr
    }

    private func readHardwareDiagnostics(
        for session: VTCompressionSession
    ) -> (status: OSStatus, usingHardwareEncoder: Bool?) {
        var propertyValue: Unmanaged<CFTypeRef>?
        let status = VTSessionCopyProperty(
            session,
            key: kVTCompressionPropertyKey_UsingHardwareAcceleratedVideoEncoder,
            allocator: kCFAllocatorDefault,
            valueOut: &propertyValue
        )
        let retainedValue = propertyValue?.takeRetainedValue()
        return (
            status,
            (retainedValue as? NSNumber)?.boolValue
        )
    }

    private func rfc6381CodecString(
        formatDescription: CMFormatDescription
    ) -> String? {
        guard let sequenceParameterSet = h264ParameterSet(
            formatDescription: formatDescription,
            index: 0
        ), sequenceParameterSet.count >= 4 else { return nil }

        return String(
            format: "avc1.%02x%02x%02x",
            Int(sequenceParameterSet[1]),
            Int(sequenceParameterSet[2]),
            Int(sequenceParameterSet[3])
        )
    }

    private func avcDecoderConfigurationRecord(
        formatDescription: CMFormatDescription
    ) -> Data? {
        if
            let atoms = CMFormatDescriptionGetExtension(
                formatDescription,
                extensionKey: kCMFormatDescriptionExtension_SampleDescriptionExtensionAtoms
            ) as? NSDictionary,
            let record = atoms["avcC"] as? Data,
            !record.isEmpty
        {
            return record
        }

        var pointer: UnsafePointer<UInt8>?
        var size = 0
        var parameterSetCount = 0
        var nalUnitHeaderLength: Int32 = 0
        let firstStatus = CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
            formatDescription,
            parameterSetIndex: 0,
            parameterSetPointerOut: &pointer,
            parameterSetSizeOut: &size,
            parameterSetCountOut: &parameterSetCount,
            nalUnitHeaderLengthOut: &nalUnitHeaderLength
        )
        guard
            firstStatus == noErr,
            parameterSetCount > 0,
            (1...4).contains(nalUnitHeaderLength)
        else { return nil }

        var sequenceParameterSets: [Data] = []
        var pictureParameterSets: [Data] = []
        for index in 0..<parameterSetCount {
            guard let parameterSet = h264ParameterSet(
                formatDescription: formatDescription,
                index: index
            ), let firstByte = parameterSet.first else { continue }
            switch firstByte & 0x1f {
            case 7:
                sequenceParameterSets.append(parameterSet)
            case 8:
                pictureParameterSets.append(parameterSet)
            default:
                continue
            }
        }
        guard
            let firstSequenceParameterSet = sequenceParameterSets.first,
            firstSequenceParameterSet.count >= 4,
            !pictureParameterSets.isEmpty,
            sequenceParameterSets.count <= 31,
            pictureParameterSets.count <= 255,
            (sequenceParameterSets + pictureParameterSets).allSatisfy({
                $0.count <= Int(UInt16.max)
            })
        else { return nil }

        var record = Data([
            1,
            firstSequenceParameterSet[1],
            firstSequenceParameterSet[2],
            firstSequenceParameterSet[3],
            0xfc | UInt8(nalUnitHeaderLength - 1),
            0xe0 | UInt8(sequenceParameterSets.count)
        ])
        for parameterSet in sequenceParameterSets {
            appendBigEndianUInt16(UInt16(parameterSet.count), to: &record)
            record.append(parameterSet)
        }
        record.append(UInt8(pictureParameterSets.count))
        for parameterSet in pictureParameterSets {
            appendBigEndianUInt16(UInt16(parameterSet.count), to: &record)
            record.append(parameterSet)
        }

        // The encoders used here emit 8-bit 4:2:0. High-profile avcC records
        // carry these defaults explicitly after the PPS collection.
        if [100, 110, 122, 144].contains(Int(firstSequenceParameterSet[1])) {
            record.append(0xfd) // reserved + chroma_format 4:2:0
            record.append(0xf8) // reserved + bit_depth_luma_minus8 = 0
            record.append(0xf8) // reserved + bit_depth_chroma_minus8 = 0
            record.append(0) // numOfSequenceParameterSetExt
        }
        return record
    }

    private func appendBigEndianUInt16(_ value: UInt16, to data: inout Data) {
        data.append(UInt8((value >> 8) & 0xff))
        data.append(UInt8(value & 0xff))
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
