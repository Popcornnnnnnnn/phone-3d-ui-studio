import CoreImage
import CoreVideo
import Foundation

@main struct SnapshotSelfCheck {
    static func main() throws {
        let manager = FileManager.default
        let retained = CommandLine.arguments.count == 2
        let root = retained ? URL(fileURLWithPath: CommandLine.arguments[1]) :
            manager.temporaryDirectory.appendingPathComponent("phone3d-snapshot-check-\(UUID().uuidString)")
        precondition(!manager.fileExists(atPath: root.path), "Never overwrite an existing test output")
        // Only test-generated pixels are written under this fresh directory.
        defer { if !retained { try? manager.removeItem(at: root) } }
        let done = DispatchSemaphore(value: 0)
        let lock = NSLock()
        var result: [String: Any]?
        let snapshot = H264QualitySnapshot(outputRoot: root) { message in
            lock.withLock { result = message }
            done.signal()
        }
        var buffer: CVPixelBuffer?
        precondition(CVPixelBufferCreate(kCFAllocatorDefault, 64, 128, kCVPixelFormatType_32BGRA,
            [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &buffer) == 0)
        let context = CIContext()
        context.render(CIImage(color: CIColor(red: 0.2, green: 0.6, blue: 0.9)), to: buffer!)
        let id = UUID().uuidString.lowercased()
        let timing = H264FrameTiming(frameId: 1, captureAtMs: 0, callbackAtMs: 0, encodeStartedAtMs: 0,
            width: 64, height: 128, orientation: "portrait", captureContentStatus: "complete",
            freshContent: true, captureStreamGeneration: 1, h264PipelineEpoch: 1)
        precondition(!snapshot.observeInput(buffer!, timing: timing), "No request must mean no capture")
        precondition(!manager.fileExists(atPath: root.path))
        precondition(snapshot.arm(id: id, averageBitRate: 5_000_000))
        precondition(!snapshot.arm(id: UUID().uuidString, averageBitRate: 10_000_000))
        precondition(snapshot.observeInput(buffer!, timing: timing))
        precondition(!snapshot.observeInput(buffer!, timing: timing))
        let wrongTiming = H264FrameTiming(frameId: 2, captureAtMs: 0, callbackAtMs: 0, encodeStartedAtMs: 0,
            width: 64, height: 128, orientation: "portrait", captureContentStatus: "complete",
            freshContent: true, captureStreamGeneration: 1, h264PipelineEpoch: 1)
        snapshot.observeOutput(data: Data([1]), timing: wrongTiming, isKeyframe: true,
            format: "annex-b", description: nil, transportAccepted: false)
        precondition(!manager.fileExists(atPath: root.path), "Mismatched output must not save")
        var encoder: H264Encoder!
        encoder = H264Encoder(codecOutputHandler: { data, actualTiming, keyframe, _, format, description in
            precondition(encoder.diagnosticState().inFlight == 1, "Admission must remain held through delivery")
            snapshot.observeOutput(data: data, timing: actualTiming, isKeyframe: keyframe,
                format: format.rawValue, description: description, transportAccepted: true)
            return true
        })
        encoder.requestKeyframe()
        precondition(encoder.encode(pixelBuffer: buffer!, timing: timing))
        precondition(done.wait(timeout: .now() + 5) == .success)
        let saved = lock.withLock { result! }
        precondition(saved["ok"] as? Bool == true, "\(saved)")
        let folder = root.appendingPathComponent(id)
        let metadata = try JSONSerialization.jsonObject(with: Data(contentsOf: folder.appendingPathComponent("manifest.json"))) as! [String: Any]
        precondition(metadata["frameId"] as? Int == 1)
        precondition(metadata["h264PipelineEpoch"] as? Int == 1)
        let encoded = try Data(contentsOf: folder.appendingPathComponent("encoded.bin"))
        let png = try Data(contentsOf: folder.appendingPathComponent("pre-encode.png"))
        precondition(encoded.count > 4)
        precondition(png.count > 0)
        print("PASS: disarmed capture, single-request admission, frame identity, real encode, PNG and manifest export")
        if retained { print(folder.path) }
    }
}
