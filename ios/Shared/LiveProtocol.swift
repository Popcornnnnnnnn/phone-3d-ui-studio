import Foundation

struct PoseMessage: Encodable {
    let type = "pose"
    let producerSessionId: String
    let captureSource: String
    let timestampMs: Int64
    let quaternion: [Double]
    let rotationRate: [Double]
    let requestedHz: Double
    let sampleIntervalMs: Double?
    let clockOffsetMs: Double?
    let clockRttMs: Double?
}

struct PoseModeCommand: Decodable {
    let type: String
    let mode: String
    let requestedHz: Double?
}

struct BenchmarkRequestCommand: Decodable {
    let type: String
    let runId: String
    let durationMs: Int
    let requestedAtMs: Int64
    let targetFps: Int?
    let encoderProfile: String?
    let encoderTuning: String?
    let warmupMs: Int?
    let captureShortEdge: Int?
}

struct QualitySnapshotRequestCommand: Decodable {
    let type: String
    let runId: String
    let averageBitRate: Int?
}

enum FrameRoutePolicy: String, Codable {
    case wifiOnly = "wifi-only"
    case wiredPreferred = "wired-preferred"
}

struct FrameTransportConfigurationCommand: Decodable {
    let type: String
    let runId: String
    let route: FrameRoutePolicy
    let window: Int
}

struct FrameTransportTraceACKCommand: Decodable {
    let producerSessionId: String
    let throughRevision: Int64
    let exportGeneration: Int64
}

/// Queue-confined admission accounting. ACKs are per frame, not cumulative:
/// receiving an ACK through the independent pose socket can reorder feedback.
struct BoundedFrameWindow {
    static let productionCapacity = 2
    struct Entry {
        let token: UInt64
        let bytes: Int
        let sentAt: Double
    }
    let capacity: Int
    let byteLimit: Int
    let maximumFrameBytes: Int
    let maximumAdmissionAge: Double
    private(set) var entries: [Int64: Entry] = [:]
    private var nextToken: UInt64 = 0

    init(capacity: Int = productionCapacity, byteLimit: Int = 512 * 1024,
         maximumFrameBytes: Int = 2 * 1024 * 1024,
         maximumAdmissionAge: Double = 0.100) {
        precondition((1...3).contains(capacity))
        self.capacity = capacity
        self.byteLimit = byteLimit
        self.maximumFrameBytes = maximumFrameBytes
        self.maximumAdmissionAge = maximumAdmissionAge
    }

    var outstandingBytes: Int { entries.values.reduce(0) { $0 + $1.bytes } }
    func oldestAge(at now: Double) -> Double {
        entries.values.map { max(0, now - $0.sentAt) }.max() ?? 0
    }
    func canAdmit(at now: Double) -> Bool {
        now.isFinite && entries.count < capacity && outstandingBytes < byteLimit &&
            oldestAge(at: now) < maximumAdmissionAge
    }
    mutating func insert(frameId: Int64, bytes: Int, at now: Double) -> Entry? {
        guard entries[frameId] == nil, bytes > 0, bytes <= maximumFrameBytes,
              canAdmit(at: now),
              entries.isEmpty || bytes <= byteLimit - outstandingBytes else { return nil }
        // A large IDR may occupy the window alone, up to maximumFrameBytes.
        // No further input is admitted until it is acknowledged.
        nextToken &+= 1
        let entry = Entry(token: nextToken, bytes: bytes, sentAt: now)
        entries[frameId] = entry
        return entry
    }
    mutating func acknowledge(frameId: Int64) -> Entry? {
        entries.removeValue(forKey: frameId)
    }
    mutating func clear() { entries.removeAll(keepingCapacity: true) }
}

/// Bounded metadata-only trace. Monotonic same-host intervals are measured;
/// cross-host directions are estimates and are withheld after a wall-clock
/// discontinuity or a poor clock exchange. Failed frames are retained too.
struct FrameTransportTrace {
    struct Sample: Encodable {
        let sequence: Int64
        var revision: Int64 = 0
        let frameId: Int64
        let generation: Int64
        let bytes: Int
        let keyframe: Bool
        var outcome: String
        var ackPath: String?
        var timings: [String: Double]
    }
    private struct Pending {
        var sample: Sample
        let sentUptime: Double
        let sentWallMs: Double
        let clock: ClockEstimate?
    }
    private var pending: [Int64: Pending] = [:]
    private(set) var samples: [Sample] = []
    private var nextSequence: Int64 = 0
    private(set) var latestRevision: Int64 = 0
    private(set) var acknowledgedRevision: Int64 = 0
    private(set) var discardedThroughRevision: Int64 = 0
    private(set) var exportGeneration: Int64 = 0
    let capacity: Int

    init(capacity: Int = 128) { self.capacity = max(1, capacity) }

    // Completion order is not frame order: an older frame's ACK (or send
    // completion) can arrive later. Export by revision, never by frame ID.
    var unacknowledgedSamples: [Sample] {
        samples.filter { $0.revision > acknowledgedRevision }
            .sorted { $0.revision < $1.revision }
    }

    mutating func resetDelivery() {
        exportGeneration &+= 1
        acknowledgedRevision = 0
    }

    mutating func acknowledgeDelivery(through revision: Int64, generation: Int64) {
        guard generation == exportGeneration,
              revision >= acknowledgedRevision, revision <= latestRevision else { return }
        acknowledgedRevision = revision
    }

    mutating func begin(frameId: Int64, generation: Int64, bytes: Int,
                        keyframe: Bool, uptime: Double, wallMs: Double,
                        clock: ClockEstimate?) {
        guard pending.count < 3, pending[frameId] == nil else { return }
        nextSequence += 1
        let sample = Sample(sequence: nextSequence, frameId: frameId,
            generation: generation, bytes: bytes, keyframe: keyframe,
            outcome: "pending", timings: ["sentWallMs": wallMs])
        pending[frameId] = Pending(sample: sample, sentUptime: uptime,
            sentWallMs: wallMs, clock: clock)
    }

    mutating func sent(frameId: Int64, generation: Int64, elapsedMs: Double) {
        guard elapsedMs.isFinite, elapsedMs >= 0 else { return }
        if pending[frameId]?.sample.generation == generation {
            pending[frameId]?.sample.timings["sendCompletionMs"] = elapsedMs
        } else if let index = samples.lastIndex(where: {
            $0.frameId == frameId && $0.generation == generation
        }) {
            // A reverse ACK can beat Network.framework's send completion.
            samples[index].timings["sendCompletionMs"] = elapsedMs
            latestRevision += 1
            samples[index].revision = latestRevision
        }
    }

    mutating func acknowledge(frameId: Int64, uptime: Double, wallMs: Double,
                              path: String, bridge: [String: Double],
                              receiveQueueMs: Double? = nil) {
        guard var entry = pending.removeValue(forKey: frameId) else { return }
        let total = (uptime - entry.sentUptime) * 1_000
        entry.sample.outcome = "ack"
        entry.sample.ackPath = path
        entry.sample.timings["ackMs"] = max(0, total)
        entry.sample.timings["finishedWallMs"] = wallMs
        if let receiveQueueMs, receiveQueueMs.isFinite, receiveQueueMs >= 0 {
            entry.sample.timings["ackReceiveQueueMs"] = receiveQueueMs
        }
        for key in ["bridgeReceivedAtMs", "bridgeAckIssuedAtMs", "bridgeReadSpanMs",
                    "bridgeDispatchMs", "bridgeProcessingMs"] {
            if let value = bridge[key], value.isFinite, value >= 0 {
                entry.sample.timings[key] = value
            }
        }
        if let processing = bridge["bridgeProcessingMs"], processing.isFinite,
           processing >= 0, processing <= total {
            entry.sample.timings["outsideBridgeProcessingMs"] = total - processing
        }
        if let clock = entry.clock, clock.offsetMs.isFinite,
           clock.rttMs.isFinite, (0...20).contains(clock.rttMs),
           abs(wallMs - entry.sentWallMs - total) <= 5,
           let received = bridge["bridgeReceivedAtMs"], received.isFinite,
           let issued = bridge["bridgeAckIssuedAtMs"], issued.isFinite, issued >= received {
            let forward = received - entry.sentWallMs - clock.offsetMs
            let reverse = wallMs + clock.offsetMs - issued
            let uncertainty = clock.rttMs / 2 + 1 // Clock RTT indicator, not a guaranteed bound.
            if forward >= -uncertainty, reverse >= -uncertainty {
                entry.sample.timings["forwardEstimateMs"] = forward
                entry.sample.timings["returnEstimateMs"] = reverse
                entry.sample.timings["clockRttMs"] = clock.rttMs
            }
        }
        retain(entry.sample)
    }

    mutating func finishAll(reason: String, uptime: Double, wallMs: Double) {
        for entry in pending.values.sorted(by: { $0.sample.sequence < $1.sample.sequence }) {
            var sample = entry.sample
            sample.outcome = reason
            sample.timings["unfinishedMs"] = max(0, (uptime - entry.sentUptime) * 1_000)
            sample.timings["finishedWallMs"] = wallMs
            retain(sample)
        }
        pending.removeAll(keepingCapacity: true)
    }

    private mutating func retain(_ value: Sample) {
        var sample = value
        latestRevision += 1
        sample.revision = latestRevision
        samples.append(sample)
        if samples.count > capacity {
            let count = samples.count - capacity
            discardedThroughRevision = max(discardedThroughRevision,
                samples.prefix(count).map(\.revision).max() ?? 0)
            samples.removeFirst(count)
        }
    }
}

struct CaptureOutputDimensions: Equatable {
    let width: Int
    let height: Int

    var shortEdge: Int {
        min(width, height)
    }
}

struct H264PipelineIdentity: Equatable {
    let captureStreamGeneration: Int64
    let pipelineEpoch: UInt64
}

/// Preserve elapsed source time when admission drops capture frames. A frame
/// counter divided by the requested FPS compresses media time under backpressure
/// and makes the encoder's per-second rate limits apply to the wrong interval.
struct H264PresentationTimeline {
    private var previousSourceSeconds: Double?
    private var previousPresentationSeconds: Double?

    mutating func reset() { self = Self() }

    mutating func next(sourceSeconds: Double, nominalFramesPerSecond: Int) -> Double {
        let previousSource = previousSourceSeconds
        previousSourceSeconds = sourceSeconds.isFinite ? sourceSeconds : nil
        guard let previousPresentation = previousPresentationSeconds else {
            previousPresentationSeconds = 0
            return 0
        }
        let delta = previousSource.map { sourceSeconds - $0 } ?? .nan
        // Duplicate/invalid timestamps or a source clock discontinuity must
        // never send a non-increasing PTS to VideoToolbox. Rebase on this input
        // so later valid source deltas recover immediately.
        let step = delta.isFinite && delta > 0
            ? max(0.000001, delta)
            : 1 / Double(max(1, nominalFramesPerSecond))
        let result = previousPresentation + step
        previousPresentationSeconds = result
        return result
    }
}

/// Keeps recovery points tied to real elapsed time. ScreenCaptureKit may emit
/// fewer than one callback per second for static content, so a frame-count-only
/// GOP can otherwise last several minutes and carry a damaged delta frame
/// across a full-screen transition.
struct H264KeyframeCadence {
    static let sparseFrameGapSeconds = 0.250
    static let maximumKeyframeIntervalSeconds = 2.0

    private(set) var lastSubmissionUptime: Double?
    private(set) var lastKeyframeUptime: Double?

    mutating func reset() {
        lastSubmissionUptime = nil
        lastKeyframeUptime = nil
    }

    mutating func shouldForceKeyframe(
        at uptime: Double,
        explicitlyRequested: Bool
    ) -> Bool {
        guard uptime.isFinite else {
            reset()
            return true
        }
        if let previous = lastSubmissionUptime, uptime < previous {
            reset()
        }
        let followsSparseGap = lastSubmissionUptime.map {
            uptime - $0 >= Self.sparseFrameGapSeconds
        } ?? true
        let exceedsMaximumInterval = lastKeyframeUptime.map {
            uptime - $0 >= Self.maximumKeyframeIntervalSeconds
        } ?? true
        let shouldForce = explicitlyRequested || followsSparseGap ||
            exceedsMaximumInterval
        lastSubmissionUptime = uptime
        if shouldForce { lastKeyframeUptime = uptime }
        return shouldForce
    }
}

enum BenchmarkCaptureConfiguration {
    static let defaultShortEdge = 960
    static let supportedShortEdges = [960, 720, 640]
    // Leave enough room for a ScreenCaptureKit replacement and one complete
    // warmup, while still terminating before the bridge's run watchdog.
    static let readinessTimeoutMs = 10_000

    static func resolvedShortEdge(_ requested: Int?) -> Int? {
        let resolved = requested ?? defaultShortEdge
        return supportedShortEdges.contains(resolved) ? resolved : nil
    }

    static func outputDimensions(
        sourceWidth: Double,
        sourceHeight: Double,
        requestedShortEdge: Int
    ) -> CaptureOutputDimensions? {
        guard
            sourceWidth.isFinite,
            sourceHeight.isFinite,
            sourceWidth > 0,
            sourceHeight > 0,
            supportedShortEdges.contains(requestedShortEdge)
        else { return nil }

        let sourceShortEdge = min(sourceWidth, sourceHeight)
        let outputShortEdge = min(
            sourceShortEdge,
            Double(requestedShortEdge)
        )
        let scale = outputShortEdge / sourceShortEdge

        func evenDimension(_ value: Double) -> Int {
            let rounded = max(2, Int(value.rounded()))
            return rounded.isMultiple(of: 2) ? rounded : rounded + 1
        }

        return CaptureOutputDimensions(
            width: evenDimension(sourceWidth * scale),
            height: evenDimension(sourceHeight * scale)
        )
    }

    static func pendingTimeoutMs(warmupMs: Int) -> Int {
        max(0, warmupMs) + readinessTimeoutMs
    }
}

struct BenchmarkCaptureReadiness: Equatable {
    let streamGeneration: Int64
    let requestedShortEdge: Int
    let expectedDimensions: CaptureOutputDimensions
    private(set) var readyAtMs: Int64?

    @discardableResult
    mutating func observe(
        streamGeneration: Int64,
        actualDimensions: CaptureOutputDimensions,
        freshContent: Bool,
        encoderReady: Bool,
        observedAtMs: Int64
    ) -> Bool {
        guard readyAtMs == nil else { return false }
        guard
            streamGeneration == self.streamGeneration,
            actualDimensions == expectedDimensions,
            actualDimensions.shortEdge == requestedShortEdge,
            freshContent,
            encoderReady
        else { return false }
        readyAtMs = observedAtMs
        return true
    }

    mutating func invalidate() {
        readyAtMs = nil
    }

    static func freshnessContinuityIsBroken(
        previousVerifiedAtMs: Int64?,
        nextVerifiedAtMs: Int64,
        maximumFreshFrameAgeMs: Int64
    ) -> Bool {
        guard let previousVerifiedAtMs else { return false }
        return nextVerifiedAtMs < previousVerifiedAtMs ||
            nextVerifiedAtMs - previousVerifiedAtMs >
                max(0, maximumFreshFrameAgeMs)
    }

    func canStart(at timestampMs: Int64, warmupMs: Int) -> Bool {
        guard let readyAtMs else { return false }
        return timestampMs >= readyAtMs + Int64(max(0, warmupMs))
    }

    func stillMatches(
        streamGeneration: Int64,
        actualDimensions: CaptureOutputDimensions?,
        currentFrameFreshContent: Bool,
        lastVerifiedFreshFrameAtMs: Int64?,
        observedAtMs: Int64,
        maximumFreshFrameAgeMs: Int64,
        encoderReady: Bool
    ) -> Bool {
        guard
            let lastVerifiedFreshFrameAtMs,
            observedAtMs >= lastVerifiedFreshFrameAtMs,
            observedAtMs - lastVerifiedFreshFrameAtMs <=
                max(0, maximumFreshFrameAgeMs)
        else { return false }
        return streamGeneration == self.streamGeneration &&
            actualDimensions == expectedDimensions &&
            currentFrameFreshContent &&
            encoderReady
    }
}

enum CaptureFreshnessResetScope {
    case benchmarkCadenceWindow
    case captureSession
}

struct CaptureFreshnessState: Equatable {
    private(set) var contentStatus: String?
    private(set) var freshContent: Bool?

    mutating func record(contentStatus: String, freshContent: Bool) {
        self.contentStatus = contentStatus
        self.freshContent = freshContent
    }

    mutating func reset(for scope: CaptureFreshnessResetScope) {
        switch scope {
        case .benchmarkCadenceWindow:
            // A benchmark window is only a measurement boundary. Preserve the
            // last observed capture truth until the producer emits a new frame.
            return
        case .captureSession:
            contentStatus = nil
            freshContent = nil
        }
    }

    var messageContentStatus: String {
        contentStatus ?? "missing"
    }

    var messageFreshContent: Bool {
        freshContent ?? false
    }
}

enum BenchmarkEncoderConfigurationVerification {
    static func completionIsVerified(
        startedProfile: String?,
        startedTuning: String?,
        currentProfile: String?,
        currentTuning: String?
    ) -> Bool {
        guard
            let startedProfile,
            let startedTuning,
            let currentProfile,
            let currentTuning
        else { return false }
        return currentProfile == startedProfile &&
            currentTuning == startedTuning
    }
}

struct H264OutputFormatCommand: Decodable {
    let type: String
    let format: String
}

struct FrameMetadataMessage: Encodable {
    let type = "frame-meta"
    let producerSessionId: String
    let captureSource: String
    let frameId: Int64
    let timestampMs: Int64
    let captureAtMs: Int64
    let callbackAtMs: Int64
    let encodeStartedAtMs: Int64
    let encodedAtMs: Int64
    let width: Int
    let height: Int
    let orientation: String
    let jpegBytes: Int
    let codec: String
    let isKeyframe: Bool?
    let decoderCodec: String?
    let h264BitstreamFormat: String?
    let decoderDescriptionBase64: String?
    let clockOffsetMs: Double?
    let clockRttMs: Double?
    let captureTimestampSource: String?
    let captureTimestampValid: Bool?
    let captureSampleAgeMs: Double?
    let captureContentStatus: String
    let freshContent: Bool
    let captureShortEdgeActive: Int
    let captureWidthActive: Int
    let captureHeightActive: Int
    let captureStreamGeneration: Int64
    let h264PipelineEpoch: UInt64
    let conversionStartedAtMs: Int64?
    let conversionEndedAtMs: Int64?

    init(
        producerSessionId: String,
        captureSource: String,
        frameId: Int64,
        timestampMs: Int64,
        captureAtMs: Int64,
        callbackAtMs: Int64,
        encodeStartedAtMs: Int64,
        encodedAtMs: Int64,
        width: Int,
        height: Int,
        orientation: String,
        jpegBytes: Int,
        codec: String,
        isKeyframe: Bool?,
        decoderCodec: String?,
        h264BitstreamFormat: String?,
        decoderDescriptionBase64: String?,
        clockOffsetMs: Double?,
        clockRttMs: Double?,
        captureTimestampSource: String? = nil,
        captureTimestampValid: Bool? = nil,
        captureSampleAgeMs: Double? = nil,
        captureContentStatus: String,
        freshContent: Bool,
        captureShortEdgeActive: Int,
        captureWidthActive: Int,
        captureHeightActive: Int,
        captureStreamGeneration: Int64,
        h264PipelineEpoch: UInt64,
        conversionStartedAtMs: Int64? = nil,
        conversionEndedAtMs: Int64? = nil
    ) {
        self.producerSessionId = producerSessionId
        self.captureSource = captureSource
        self.frameId = frameId
        self.timestampMs = timestampMs
        self.captureAtMs = captureAtMs
        self.callbackAtMs = callbackAtMs
        self.encodeStartedAtMs = encodeStartedAtMs
        self.encodedAtMs = encodedAtMs
        self.width = width
        self.height = height
        self.orientation = orientation
        self.jpegBytes = jpegBytes
        self.codec = codec
        self.isKeyframe = isKeyframe
        self.decoderCodec = decoderCodec
        self.h264BitstreamFormat = h264BitstreamFormat
        self.decoderDescriptionBase64 = decoderDescriptionBase64
        self.clockOffsetMs = clockOffsetMs
        self.clockRttMs = clockRttMs
        self.captureTimestampSource = captureTimestampSource
        self.captureTimestampValid = captureTimestampValid
        self.captureSampleAgeMs = captureSampleAgeMs
        self.captureContentStatus = captureContentStatus
        self.freshContent = freshContent
        self.captureShortEdgeActive = captureShortEdgeActive
        self.captureWidthActive = captureWidthActive
        self.captureHeightActive = captureHeightActive
        self.captureStreamGeneration = captureStreamGeneration
        self.h264PipelineEpoch = h264PipelineEpoch
        self.conversionStartedAtMs = conversionStartedAtMs
        self.conversionEndedAtMs = conversionEndedAtMs
    }
}

enum ScreenCodec: String, CaseIterable, Identifiable {
    case jpeg = "JPEG"
    case h264 = "H.264"
    case webrtc = "WebRTC"

    var id: String { rawValue }
}

struct ClockSyncRequest: Encodable {
    let type = "clock-sync"
    let requestId: Int64
    let clockSyncVersion = 2
    // Preserve the integer field consumed by already-installed clients and
    // bridges while version 2 carries sub-millisecond timestamps separately.
    let phoneSendAtMs: Int64
    let phoneSendAtPreciseMs: Double

    init(requestId: Int64, phoneSendAtPreciseMs: Double) {
        self.requestId = requestId
        phoneSendAtMs = Int64(phoneSendAtPreciseMs)
        self.phoneSendAtPreciseMs = phoneSendAtPreciseMs
    }
}

struct ClockSyncReply: Decodable {
    let type: String
    let requestId: Int64
    let phoneSendAtMs: Double
    let bridgeReceiveAtMs: Double
    let bridgeSendAtMs: Double

    private enum CodingKeys: String, CodingKey {
        case type
        case requestId
        case phoneSendAtMs
        case bridgeReceiveAtMs
        case bridgeSendAtMs
        case phoneSendAtPreciseMs
        case bridgeReceiveAtPreciseMs
        case bridgeSendAtPreciseMs
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        type = try values.decode(String.self, forKey: .type)
        requestId = try values.decode(Int64.self, forKey: .requestId)

        let legacyPhoneSend = try values.decode(
            Double.self,
            forKey: .phoneSendAtMs
        )
        let legacyBridgeReceive = try values.decode(
            Double.self,
            forKey: .bridgeReceiveAtMs
        )
        let legacyBridgeSend = try values.decode(
            Double.self,
            forKey: .bridgeSendAtMs
        )
        let preciseValues = (
            try values.decodeIfPresent(
                Double.self,
                forKey: .phoneSendAtPreciseMs
            ),
            try values.decodeIfPresent(
                Double.self,
                forKey: .bridgeReceiveAtPreciseMs
            ),
            try values.decodeIfPresent(
                Double.self,
                forKey: .bridgeSendAtPreciseMs
            )
        )
        if
            let precisePhoneSend = preciseValues.0,
            let preciseBridgeReceive = preciseValues.1,
            let preciseBridgeSend = preciseValues.2,
            precisePhoneSend.isFinite,
            preciseBridgeReceive.isFinite,
            preciseBridgeSend.isFinite
        {
            phoneSendAtMs = precisePhoneSend
            bridgeReceiveAtMs = preciseBridgeReceive
            bridgeSendAtMs = preciseBridgeSend
        } else {
            phoneSendAtMs = legacyPhoneSend
            bridgeReceiveAtMs = legacyBridgeReceive
            bridgeSendAtMs = legacyBridgeSend
        }
    }
}

struct ClockEstimate: Equatable {
    let offsetMs: Double
    let rttMs: Double

    static func fromExchange(
        phoneSendAtWallMs: Double,
        phoneReceiveAtWallMs: Double,
        phoneRoundTripElapsedMs: Double,
        bridgeReceiveAtMs: Double,
        bridgeSendAtMs: Double
    ) -> ClockEstimate? {
        let timestamps = [
            phoneSendAtWallMs,
            phoneReceiveAtWallMs,
            phoneRoundTripElapsedMs,
            bridgeReceiveAtMs,
            bridgeSendAtMs,
        ]
        guard
            timestamps.allSatisfy(\.isFinite),
            phoneRoundTripElapsedMs >= 0,
            bridgeSendAtMs >= bridgeReceiveAtMs
        else { return nil }

        let bridgeProcessingMs = bridgeSendAtMs - bridgeReceiveAtMs
        let phoneWallElapsedMs = phoneReceiveAtWallMs - phoneSendAtWallMs
        guard
            bridgeProcessingMs <= phoneRoundTripElapsedMs,
            phoneWallElapsedMs >= 0,
            // A wall-clock step during one exchange makes the NTP offset
            // meaningless even when the monotonic RTT still looks excellent.
            abs(phoneWallElapsedMs - phoneRoundTripElapsedMs) <= 5
        else { return nil }

        return ClockEstimate(
            offsetMs: (
                (bridgeReceiveAtMs - phoneSendAtWallMs) +
                (bridgeSendAtMs - phoneReceiveAtWallMs)
            ) / 2,
            rttMs: phoneRoundTripElapsedMs - bridgeProcessingMs
        )
    }
}

/// Maintains one low-RTT result per completed synchronization round and only
/// selects from a bounded number of recent rounds. The last published result
/// remains available while a refresh is in flight, so frame timestamps never
/// temporarily lose synchronization.
struct ClockEstimateWindow {
    private struct RoundEstimate {
        let roundId: Int64
        let estimate: ClockEstimate
    }

    let maximumCompletedRounds: Int

    private var activeRoundId: Int64?
    private var activeBestEstimate: ClockEstimate?
    private var completedRounds: [RoundEstimate] = []
    private var publishedEstimate: ClockEstimate?

    init(maximumCompletedRounds: Int = 3) {
        self.maximumCompletedRounds = max(1, maximumCompletedRounds)
    }

    var estimate: ClockEstimate? {
        // The active value is provisional only during initial synchronization.
        // Refresh rounds retain the previous completed estimate until they end.
        publishedEstimate ?? activeBestEstimate
    }

    mutating func reset() {
        activeRoundId = nil
        activeBestEstimate = nil
        completedRounds.removeAll(keepingCapacity: true)
        publishedEstimate = nil
    }

    mutating func beginRound(_ roundId: Int64) {
        activeRoundId = roundId
        activeBestEstimate = nil
    }

    @discardableResult
    mutating func record(
        _ estimate: ClockEstimate,
        inRound roundId: Int64
    ) -> Bool {
        guard
            activeRoundId == roundId,
            estimate.offsetMs.isFinite,
            estimate.rttMs.isFinite,
            estimate.rttMs >= 0
        else { return false }

        if
            activeBestEstimate == nil ||
                estimate.rttMs < activeBestEstimate!.rttMs
        {
            activeBestEstimate = estimate
        }
        return true
    }

    @discardableResult
    mutating func completeRound(_ roundId: Int64) -> Bool {
        guard activeRoundId == roundId else { return false }
        defer {
            activeRoundId = nil
            activeBestEstimate = nil
        }
        guard let activeBestEstimate else { return false }

        completedRounds.removeAll { $0.roundId == roundId }
        completedRounds.append(
            RoundEstimate(roundId: roundId, estimate: activeBestEstimate)
        )
        if completedRounds.count > maximumCompletedRounds {
            completedRounds.removeFirst(
                completedRounds.count - maximumCompletedRounds
            )
        }
        // Each round already chooses its lowest-RTT exchange. Publish the most
        // recent completed round so wall-clock correction or drift is visible
        // immediately instead of allowing an older low-RTT offset to remain in
        // force for another two refresh intervals.
        publishedEstimate = completedRounds.last?.estimate
        return true
    }
}

enum LiveProtocol {
    static func thermalStateValue(
        _ state: ProcessInfo.ThermalState = ProcessInfo.processInfo.thermalState
    ) -> String {
        switch state {
        case .nominal:
            return "nominal"
        case .fair:
            return "fair"
        case .serious:
            return "serious"
        case .critical:
            return "critical"
        @unknown default:
            return "unknown"
        }
    }

    static func timestampMs() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1_000)
    }

    static func preciseTimestampMs() -> Double {
        Date().timeIntervalSince1970 * 1_000
    }

    static func json<T: Encodable>(_ value: T) -> String? {
        guard let data = try? JSONEncoder().encode(value) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
