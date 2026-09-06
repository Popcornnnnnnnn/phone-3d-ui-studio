import Foundation

/// Selects frames against a stable cadence instead of measuring from the last
/// accepted frame. The latter turns a 30 Hz source into only 15 fps when the
/// requested output is 20 fps; a moving deadline preserves the requested
/// average rate without ever queueing old frames.
struct FrameRateGate {
    private var nextDeadlineSeconds: Double?
    private var lastTimestampSeconds: Double?

    mutating func reset() {
        nextDeadlineSeconds = nil
        lastTimestampSeconds = nil
    }

    mutating func accepts(
        timestampSeconds: Double,
        targetFramesPerSecond: Int,
        downstreamReady: Bool = true
    ) -> Bool {
        // A frame that cannot enter the encoder/transport must not consume a
        // cadence deadline. If capacity returns before the following deadline,
        // the next (fresher) source frame should be admitted immediately.
        guard downstreamReady else { return false }
        guard timestampSeconds.isFinite else { return true }

        let framesPerSecond = Double(
            min(240, max(1, targetFramesPerSecond))
        )
        let interval = 1 / framesPerSecond
        let clockResetThreshold = max(1, interval * 8)

        guard
            let deadline = nextDeadlineSeconds,
            let lastTimestamp = lastTimestampSeconds,
            timestampSeconds >= lastTimestamp,
            timestampSeconds - lastTimestamp <= clockResetThreshold
        else {
            lastTimestampSeconds = timestampSeconds
            nextDeadlineSeconds = timestampSeconds + interval
            return true
        }
        lastTimestampSeconds = timestampSeconds

        // Permit sub-millisecond timestamp rounding at exact cadence edges.
        let tolerance = min(0.001, interval * 0.05)
        guard timestampSeconds + tolerance >= deadline else { return false }

        let elapsedIntervals = max(
            1,
            Int(floor((timestampSeconds + tolerance - deadline) / interval)) + 1
        )
        nextDeadlineSeconds = deadline + Double(elapsedIntervals) * interval
        return true
    }
}
