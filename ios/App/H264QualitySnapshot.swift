import CoreImage
import CoreVideo
import Foundation

/// Explicit one-shot diagnostic. Normal streaming retains no frames or files.
/// Capture work is off the encoder callback; these samples are not latency runs.
final class H264QualitySnapshot {
    private struct Input {
        let buffer: CVPixelBuffer
        let timing: H264FrameTiming
    }
    private struct Pending {
        let id: String
        let averageBitRate: Int
        var input: Input?
    }
    private let lock = NSLock()
    private let worker = DispatchQueue(label: "Phone3D.QualitySnapshot", qos: .utility)
    private var pending: Pending?
    private var writing = false
    private let completion: ([String: Any]) -> Void
    private let outputRoot: URL?

    init(outputRoot: URL? = nil, completion: @escaping ([String: Any]) -> Void) {
        self.outputRoot = outputRoot
        self.completion = completion
    }

    func arm(id: String, averageBitRate: Int) -> Bool {
        guard UUID(uuidString: id) != nil else { return false }
        let accepted = lock.withLock {
            guard pending == nil, !writing else { return false }
            pending = Pending(id: id, averageBitRate: averageBitRate)
            return true
        }
        if accepted {
            worker.asyncAfter(deadline: .now() + 10) { [weak self] in
                guard let self else { return }
                let timedOut = self.lock.withLock {
                    guard self.pending?.id == id else { return false }
                    self.pending = nil
                    return true
                }
                if timedOut { self.completion(["runId": id, "ok": false, "error": "no-matching-frame-within-10-seconds"]) }
            }
        }
        return accepted
    }

    func cancel(reason: String) {
        let id = lock.withLock { () -> String? in
            defer { pending = nil }
            return pending?.id
        }
        if let id { completion(["runId": id, "ok": false, "error": reason]) }
    }

    /// Returns true only for the selected frame; caller requests an IDR before
    /// submitting that exact buffer to the live production encoder.
    func observeInput(_ buffer: CVPixelBuffer, timing: H264FrameTiming) -> Bool {
        lock.withLock {
            guard pending != nil, pending?.input == nil else { return false }
            pending?.input = Input(buffer: buffer, timing: timing)
            return true
        }
    }

    func observeOutput(data: Data, timing: H264FrameTiming, isKeyframe: Bool,
                       format: String, description: Data?, transportAccepted: Bool) {
        let selected = lock.withLock { () -> Pending? in
            guard let request = pending, let input = request.input,
                  input.timing.frameId == timing.frameId,
                  input.timing.captureStreamGeneration == timing.captureStreamGeneration,
                  input.timing.h264PipelineEpoch == timing.h264PipelineEpoch else { return nil }
            pending = nil
            writing = true
            return request
        }
        guard let selected, let input = selected.input else { return }
        worker.async { [weak self] in
            guard let self else { return }
            defer { self.lock.withLock { self.writing = false } }
            do {
                guard isKeyframe, data.count <= 8 * 1024 * 1024,
                      timing.width > 0, timing.height > 0,
                      timing.width * timing.height <= 8_000_000 else {
                    throw SnapshotFailure("invalid-or-oversized-keyframe")
                }
                let manager = FileManager.default
                let base = self.outputRoot ?? manager.urls(for: .cachesDirectory, in: .userDomainMask)[0]
                    .appendingPathComponent("QualitySnapshots", isDirectory: true)
                try manager.createDirectory(at: base, withIntermediateDirectories: true)
                guard try manager.contentsOfDirectory(atPath: base.path).count < 8 else {
                    throw SnapshotFailure("eight-samples-retained-export-and-clear-before-more")
                }
                let directory = base.appendingPathComponent(selected.id, isDirectory: true)
                guard !manager.fileExists(atPath: directory.path) else { throw SnapshotFailure("sample-already-exists") }
                try manager.createDirectory(at: directory, withIntermediateDirectories: false)
                let context = CIContext(options: [.cacheIntermediates: false])
                let image = CIImage(cvPixelBuffer: input.buffer)
                let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
                try context.writePNGRepresentation(of: image,
                    to: directory.appendingPathComponent("pre-encode.png"),
                    format: .RGBA8, colorSpace: colorSpace, options: [:])
                try data.write(to: directory.appendingPathComponent("encoded.bin"), options: .atomic)
                if let description {
                    try description.write(to: directory.appendingPathComponent("avcc-description.bin"), options: .atomic)
                }
                let manifest: [String: Any] = [
                    "runId": selected.id, "frameId": timing.frameId,
                    "captureStreamGeneration": timing.captureStreamGeneration,
                    "h264PipelineEpoch": timing.h264PipelineEpoch,
                    "width": timing.width, "height": timing.height,
                    "captureAtMs": timing.captureAtMs, "bitstreamFormat": format,
                    "averageBitRate": selected.averageBitRate,
                    "isKeyframe": isKeyframe, "transportAccepted": transportAccepted,
                    "encodedBytes": data.count,
                    "inputPixelFormat": CVPixelBufferGetPixelFormatType(input.buffer),
                    "inputColorAttachments": String(describing: CVBufferCopyAttachments(input.buffer, .shouldPropagate)),
                    "reference": "Same CVPixelBuffer submitted to production H264Encoder, exported as sRGB PNG; not an original-resolution phone screenshot",
                    "timingExcluded": "Explicit quality diagnostic forces one IDR and exports a PNG; exclude from latency runs"
                ]
                try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
                    .write(to: directory.appendingPathComponent("manifest.json"), options: .atomic)
                self.completion(["runId": selected.id, "ok": true,
                    "relativePath": "Library/Caches/QualitySnapshots/\(selected.id)",
                    "frameId": timing.frameId, "width": timing.width, "height": timing.height])
            } catch {
                self.completion(["runId": selected.id, "ok": false, "error": String(describing: error)])
            }
        }
    }
}

private struct SnapshotFailure: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}
