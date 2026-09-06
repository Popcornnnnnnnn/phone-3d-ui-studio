// Local diagnostic: replay a user-supplied still through the production encoder
// on this Mac. This does NOT measure iPhone capture or wireless performance.
// Build with H264Encoder.swift and LiveProtocol.swift; see quality-probe.mjs.
import CoreImage
import CoreMedia
import CoreVideo
import Foundation
import ImageIO
import VideoToolbox

struct ProbeFailure: Error, CustomStringConvertible {
    let description: String
    init(_ message: String) { description = message }
}

func requireStatus(_ status: OSStatus, _ step: String) throws {
    guard status == noErr else { throw ProbeFailure("\(step): \(status)") }
}

final class ResultSlot<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value?
    let ready = DispatchSemaphore(value: 0)
    func put(_ value: Value) {
        lock.withLock { self.value = value }
        ready.signal()
    }
    func take(_ step: String) throws -> Value {
        guard ready.wait(timeout: .now() + 3) == .success,
              let result = lock.withLock({ value })
        else { throw ProbeFailure("\(step): no output within 3 seconds; not retried") }
        return result
    }
}

struct EncodedPacket {
    let bytes: Data
    let description: Data?
    var isKeyframe = false
}

final class ProbeVideoDecoder {
    var session: VTDecompressionSession?
    var format: CMVideoFormatDescription?
    let fixtureColorimetry: Bool
    init(fixtureColorimetry: Bool = true) { self.fixtureColorimetry = fixtureColorimetry }
    deinit { if let session { VTDecompressionSessionInvalidate(session) } }

    func decode(_ packet: EncodedPacket, width: Int, height: Int) throws -> CVPixelBuffer {
        if session == nil {
          if format == nil {
            guard let description = packet.description else {
                throw ProbeFailure("First frame has no avcC configuration")
            }
            var extensions: [String: Any] = [
                kCMFormatDescriptionExtension_SampleDescriptionExtensionAtoms as String:
                    ["avcC": description]
            ]
                // avcC alone omits the container color description. Match the
                // known fixture input rather than measuring an implicit 601/709
                // decoder conversion mismatch as H.264 compression loss.
            if fixtureColorimetry {
                extensions[kCMFormatDescriptionExtension_ColorPrimaries as String] = kCVImageBufferColorPrimaries_ITU_R_709_2
                extensions[kCMFormatDescriptionExtension_TransferFunction as String] = kCVImageBufferTransferFunction_sRGB
                extensions[kCMFormatDescriptionExtension_YCbCrMatrix as String] = kCVImageBufferYCbCrMatrix_ITU_R_709_2
            }
            try requireStatus(CMVideoFormatDescriptionCreate(
                allocator: kCFAllocatorDefault, codecType: kCMVideoCodecType_H264,
                width: Int32(width), height: Int32(height), extensions: extensions as CFDictionary,
                formatDescriptionOut: &format
            ), "Create decode format")
          }
            try requireStatus(VTDecompressionSessionCreate(
                allocator: kCFAllocatorDefault, formatDescription: format!,
                decoderSpecification: nil,
                imageBufferAttributes: [kCVPixelBufferPixelFormatTypeKey:
                    kCVPixelFormatType_32BGRA] as CFDictionary,
                outputCallback: nil, decompressionSessionOut: &session
            ), "Create decoder")
        }
        var block: CMBlockBuffer?
        try requireStatus(CMBlockBufferCreateWithMemoryBlock(
            allocator: kCFAllocatorDefault, memoryBlock: nil,
            blockLength: packet.bytes.count, blockAllocator: kCFAllocatorDefault,
            customBlockSource: nil, offsetToData: 0, dataLength: packet.bytes.count,
            flags: 0, blockBufferOut: &block
        ), "Create encoded buffer")
        try packet.bytes.withUnsafeBytes { pointer in
            try requireStatus(CMBlockBufferReplaceDataBytes(
                with: pointer.baseAddress!, blockBuffer: block!, offsetIntoDestination: 0,
                dataLength: packet.bytes.count
            ), "Copy encoded bytes")
        }
        var sample: CMSampleBuffer?
        var size = packet.bytes.count
        try requireStatus(CMSampleBufferCreateReady(
            allocator: kCFAllocatorDefault, dataBuffer: block,
            formatDescription: format, sampleCount: 1, sampleTimingEntryCount: 0,
            sampleTimingArray: nil, sampleSizeEntryCount: 1, sampleSizeArray: &size,
            sampleBufferOut: &sample
        ), "Create compressed sample")
        let output = ResultSlot<(OSStatus, CVPixelBuffer?)>()
        try requireStatus(VTDecompressionSessionDecodeFrame(
            session!, sampleBuffer: sample!, flags: [], infoFlagsOut: nil,
            outputHandler: { status, _, image, _, _ in output.put((status, image)) }
        ), "Decode")
        let (status, image) = try output.take("Decode")
        try requireStatus(status, "Decode callback")
        guard let image else { throw ProbeFailure("Decoder returned no image") }
        return image
    }
}

let rgbSpace = CGColorSpace(name: CGColorSpace.sRGB)!
let imageContext = CIContext(options: [.workingColorSpace: rgbSpace, .outputColorSpace: rgbSpace])

func rgbBytes(_ image: CIImage, width: Int, height: Int) -> [UInt8] {
    var bytes = [UInt8](repeating: 0, count: width * height * 4)
    bytes.withUnsafeMutableBytes {
        imageContext.render(image, toBitmap: $0.baseAddress!, rowBytes: width * 4,
            bounds: CGRect(x: 0, y: 0, width: width, height: height),
            format: .RGBA8, colorSpace: rgbSpace)
    }
    return bytes
}

func metrics(_ a: [UInt8], _ b: [UInt8], width: Int, height: Int) -> [String: Any] {
    var error = 0.0
    for i in stride(from: 0, to: a.count, by: 4) {
        for c in 0..<3 { let d = Double(a[i+c]) - Double(b[i+c]); error += d*d }
    }
    let mse = error / Double(width * height * 3)
    // Non-overlapping 8x8 luminance SSIM, population moments, no Gaussian window.
    // Explicitly named: not interchangeable with other libraries' SSIM scores.
    var ssim = 0.0
    var blocks = 0
    for y in stride(from: 0, to: height - 7, by: 8) {
        for x in stride(from: 0, to: width - 7, by: 8) {
            var sa = 0.0, sb = 0.0, aa = 0.0, bb = 0.0, ab = 0.0
            for dy in 0..<8 { for dx in 0..<8 {
                let i = ((y + dy) * width + x + dx) * 4
                let va = 0.2126 * Double(a[i]) + 0.7152 * Double(a[i+1]) + 0.0722 * Double(a[i+2])
                let vb = 0.2126 * Double(b[i]) + 0.7152 * Double(b[i+1]) + 0.0722 * Double(b[i+2])
                sa += va; sb += vb; aa += va*va; bb += vb*vb; ab += va*vb
            } }
            let ma = sa / 64, mb = sb / 64
            let va = max(0, aa / 64 - ma*ma), vb = max(0, bb / 64 - mb*mb)
            let covariance = ab / 64 - ma*mb
            ssim += ((2*ma*mb + 6.5025) * (2*covariance + 58.5225)) /
                ((ma*ma + mb*mb + 6.5025) * (va + vb + 58.5225))
            blocks += 1
        }
    }
    return ["rgbRMSE": sqrt(mse), "rgbPSNRdB": mse == 0 ? NSNull() : 10 * log10(65025 / mse),
            "identical": mse == 0, "lumaSSIM8x8": ssim / Double(blocks)]
}

func savePNG(_ image: CIImage, at url: URL) throws {
    try imageContext.writePNGRepresentation(of: image, to: url, format: .RGBA8,
        colorSpace: rgbSpace, options: [:])
}

@main struct QualityProbe {
    static func main() throws {
        let args = CommandLine.arguments
        if args.count == 3, args[1] == "--color" {
            try generateColorFrame(to: URL(fileURLWithPath: args[2], isDirectory: true))
            return
        }
        if args.count == 4, args[1] == "--sample" {
            try decodeSnapshot(from: URL(fileURLWithPath: args[2]), to: URL(fileURLWithPath: args[3]))
            return
        }
        if args.count == 4, args[1] == "--motion" {
            try probeMotion(from: URL(fileURLWithPath: args[2]), to: URL(fileURLWithPath: args[3]))
            return
        }
        guard args.count == 3 else { throw ProbeFailure("Usage: quality-probe INPUT_PNG NEW_OUTPUT_DIR") }
        let directory = URL(fileURLWithPath: args[2], isDirectory: true)
        guard !FileManager.default.fileExists(atPath: directory.path) else {
            throw ProbeFailure("Output directory already exists; will not overwrite")
        }
        guard let source = CIImage(contentsOf: URL(fileURLWithPath: args[1]), options: [.applyOrientationProperty: true]) else {
            throw ProbeFailure("Cannot read reference image")
        }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let width = 960
        let height = Int((source.extent.height * Double(width) / source.extent.width / 2).rounded()) * 2
        let scaled = source.transformed(by: CGAffineTransform(scaleX: Double(width)/source.extent.width,
            y: Double(height)/source.extent.height))
        let reference = rgbBytes(scaled, width: width, height: height)
        // Check the metric on identity and a deliberately destroyed reference.
        let identity = metrics(reference, reference, width: width, height: height)
        let destroyed = metrics(reference, [UInt8](repeating: 0, count: reference.count), width: width, height: height)
        guard identity["identical"] as? Bool == true,
              abs((identity["lumaSSIM8x8"] as? Double ?? 0) - 1) < 1e-9,
              (destroyed["rgbRMSE"] as? Double ?? 0) > 1 else {
            throw ProbeFailure("Metric self-check failed")
        }
        var pixelBuffer: CVPixelBuffer?
        try requireStatus(CVPixelBufferCreate(kCFAllocatorDefault, width, height,
            kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
            [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &pixelBuffer), "Create NV12 input")
        CVBufferSetAttachment(pixelBuffer!, kCVImageBufferColorPrimariesKey,
            kCVImageBufferColorPrimaries_ITU_R_709_2, .shouldPropagate)
        CVBufferSetAttachment(pixelBuffer!, kCVImageBufferTransferFunctionKey,
            kCVImageBufferTransferFunction_sRGB, .shouldPropagate)
        CVBufferSetAttachment(pixelBuffer!, kCVImageBufferYCbCrMatrixKey,
            kCVImageBufferYCbCrMatrix_ITU_R_709_2, .shouldPropagate)
        imageContext.render(scaled, to: pixelBuffer!, bounds: CGRect(x: 0, y: 0, width: width, height: height), colorSpace: rgbSpace)
        let inputImage = CIImage(cvPixelBuffer: pixelBuffer!)
        let inputBytes = rgbBytes(inputImage, width: width, height: height)
        try savePNG(scaled, at: directory.appendingPathComponent("reference-960.png"))
        try savePNG(inputImage, at: directory.appendingPathComponent("pre-encode-nv12.png"))
        var results: [[String: Any]] = []
        let cases: [(Int, H264Encoder.Tuning)] = [(5, .speedPriority), (5, .default), (10, .default), (15, .default)]
        for (mbps, tuning) in cases {
            let output = ResultSlot<EncodedPacket>()
            let encoder = H264Encoder(codecOutputHandler: { data, _, _, _, _, description in
                output.put(EncodedPacket(bytes: data, description: description)); return true
            })
            encoder.setTargetFrameRate(60)
            encoder.setTuning(tuning)
            encoder.setBitstreamFormat(.avcc)
            guard !encoder.setAverageBitRate(0), !encoder.setAverageBitRate(20_000_001),
                  encoder.setAverageBitRate(mbps * 1_000_000) else { throw ProbeFailure("Bitrate validation failed") }
            let decoder = ProbeVideoDecoder()
            var totalBytes = 0
            var elapsedMs: [Double] = []
            var frames: [[String: Any]] = []
            for frame in 0..<120 {
                let start = ProcessInfo.processInfo.systemUptime
                let timing = H264FrameTiming(frameId: Int64(frame), captureAtMs: 0, callbackAtMs: 0,
                    encodeStartedAtMs: 0, width: width, height: height, orientation: "portrait",
                    captureContentStatus: "complete", freshContent: true, captureStreamGeneration: 1, h264PipelineEpoch: 1)
                guard encoder.encode(pixelBuffer: pixelBuffer!, timing: timing) else {
                    throw ProbeFailure("Encoder rejected frame \(frame): \(encoder.diagnosticState().status)")
                }
                let packet = try output.take("Encode")
                elapsedMs.append((ProcessInfo.processInfo.systemUptime - start) * 1000)
                totalBytes += packet.bytes.count
                let decoded = try decoder.decode(packet, width: width, height: height)
                if frame == 0 || frame == 59 || frame == 119 {
                    let image = CIImage(cvPixelBuffer: decoded)
                    let bytes = rgbBytes(image, width: width, height: height)
                    let filename = "\(mbps)mbps-\(tuning.rawValue)-frame\(frame).png"
                    try savePNG(image, at: directory.appendingPathComponent(filename))
                    frames.append(["frame": frame, "image": filename,
                        "vsScaledOriginal": metrics(reference, bytes, width: width, height: height),
                        "vsPreEncode": metrics(inputBytes, bytes, width: width, height: height)])
                }
            }
            let state = encoder.diagnosticState()
            guard state.activeTuning == tuning.rawValue, state.propertyStatuses["AverageBitRate"] == 0,
                  state.propertyStatuses["DataRateLimits"] == 0 else { throw ProbeFailure("Requested configuration not applied") }
            elapsedMs.sort()
            results.append(["targetMbps": mbps, "tuning": tuning.rawValue,
                "hardwareEncoder": state.usingHardwareEncoder ?? false,
                "codec": state.rfc6381Codec ?? "unknown", "propertyStatuses": state.propertyStatuses,
                "encodedBytes": totalBytes, "mediaDurationSeconds": 2,
                "effectiveMediaMbps": Double(totalBytes * 8) / 2_000_000,
                "macEncodeCallbackP50Ms": elapsedMs[60], "macEncodeCallbackP95Ms": elapsedMs[114],
                "frames": frames])
            encoder.invalidate()
            print("Completed \(mbps) Mbps \(tuning.rawValue)")
        }
        let report: [String: Any] = ["evidence": "Mac offline static replay of production H264Encoder; not iPhone or wireless validation",
            "width": width, "height": height, "frameCount": 120, "targetFps": 60,
            "pacing": "unpaced, serialized encode/decode; source PTS is 60 Hz; not a throughput or latency benchmark",
            "inputFormat": "NV12 full range, sRGB transfer, BT709 matrix",
            "decoderColorimetry": "Explicit fixture sRGB/BT709 format extensions; this isolates compression, not browser color-metadata behavior",
            "bitstream": "AVCC for local decoding; same compressed picture payload as Annex-B",
            "metricNotes": "RGB RMSE/PSNR in 8-bit sRGB; null PSNR means identical; SSIM uses non-overlapping 8x8 luma blocks. Still reference includes status area unchanged across all variants.",
            "preEncodeVsScaledOriginal": metrics(reference, inputBytes, width: width, height: height),
            "results": results]
        try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
            .write(to: directory.appendingPathComponent("metrics.json"), options: .atomic)
        print("Report: \(directory.appendingPathComponent("metrics.json").path)")
    }

    // Deterministic vertical wrap, with exactly the same 60 input pictures and
    // 20 Hz capture timestamps in before/after production-encoder builds.
    // Unpaced: this isolates media-time rate control, not wireless performance.
    static func probeMotion(from sourceURL: URL, to directory: URL) throws {
        guard !FileManager.default.fileExists(atPath: directory.path),
              let source = CIImage(contentsOf: sourceURL, options: [.applyOrientationProperty: true]),
              source.extent.width > 0 else { throw ProbeFailure("Invalid input or existing output") }
        let width = 960
        let height = Int((source.extent.height * Double(width) / source.extent.width / 2).rounded()) * 2
        guard height >= 8, width * height <= 8_000_000 else { throw ProbeFailure("Invalid dimensions") }
        let bounds = CGRect(x: 0, y: 0, width: width, height: height)
        let scaled = source.transformed(by: CGAffineTransform(
            translationX: -source.extent.minX, y: -source.extent.minY))
            .transformed(by: CGAffineTransform(scaleX: Double(width) / source.extent.width,
                y: Double(height) / source.extent.height))
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let output = ResultSlot<EncodedPacket>()
        let encoder = H264Encoder(codecOutputHandler: { data, _, key, _, _, description in
            output.put(EncodedPacket(bytes: data, description: description, isKeyframe: key)); return true
        })
        encoder.setTargetFrameRate(60)
        encoder.setTuning(.speedPriority)
        encoder.setBitstreamFormat(.avcc)
        guard encoder.setAverageBitRate(15_000_000) else { throw ProbeFailure("Invalid bitrate") }
        defer { encoder.invalidate() }
        let decoder = ProbeVideoDecoder()
        var totalBytes = 0
        var keys: [Int] = []
        var sizes: [Int] = []
        var selected: [(Int, [UInt8], CVPixelBuffer)] = []
        let selectedFrames: Set<Int> = [0, 9, 19, 29, 39, 49, 59]
        let started = ProcessInfo.processInfo.systemUptime
        for frame in 0..<60 {
            var buffer: CVPixelBuffer?
            try requireStatus(CVPixelBufferCreate(kCFAllocatorDefault, width, height,
                kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
                [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &buffer), "Motion input")
            CVBufferSetAttachment(buffer!, kCVImageBufferColorPrimariesKey,
                kCVImageBufferColorPrimaries_ITU_R_709_2, .shouldPropagate)
            CVBufferSetAttachment(buffer!, kCVImageBufferTransferFunctionKey,
                kCVImageBufferTransferFunction_sRGB, .shouldPropagate)
            CVBufferSetAttachment(buffer!, kCVImageBufferYCbCrMatrixKey,
                kCVImageBufferYCbCrMatrix_ITU_R_709_2, .shouldPropagate)
            let shift = Double((frame * 103) % height)
            let picture = scaled.transformed(by: CGAffineTransform(translationX: 0, y: shift))
                .composited(over: scaled.transformed(by: CGAffineTransform(translationX: 0, y: shift - Double(height))))
                .cropped(to: bounds)
            imageContext.render(picture, to: buffer!, bounds: bounds, colorSpace: rgbSpace)
            // Request before the encoder's automatic two-second GOP boundary
            // so both timestamp variants have exactly the same recovery frames.
            if frame % 30 == 0 { encoder.requestKeyframe() }
            let at = Int64(1_000_000 + frame * 50)
            let timing = H264FrameTiming(frameId: Int64(frame), captureAtMs: at,
                callbackAtMs: at, encodeStartedAtMs: at, width: width, height: height,
                orientation: "portrait", captureContentStatus: "complete", freshContent: true,
                captureStreamGeneration: 1, h264PipelineEpoch: 1)
            guard encoder.encode(pixelBuffer: buffer!, timing: timing) else { throw ProbeFailure("Motion admission \(frame)") }
            let packet = try output.take("Motion encode")
            totalBytes += packet.bytes.count
            sizes.append(packet.bytes.count)
            if packet.isKeyframe { keys.append(frame) }
            let decoded = try decoder.decode(packet, width: width, height: height)
            if selectedFrames.contains(frame) {
                selected.append((frame, rgbBytes(CIImage(cvPixelBuffer: buffer!), width: width, height: height), decoded))
            }
        }
        let encodeLoopSeconds = ProcessInfo.processInfo.systemUptime - started
        guard keys == [0, 30] else { throw ProbeFailure("Unexpected GOP: \(keys); cannot compare") }
        var frames: [[String: Any]] = []
        for (frame, reference, decoded) in selected {
            let image = CIImage(cvPixelBuffer: decoded)
            let filename = "decoded-\(frame).png"
            try savePNG(image, at: directory.appendingPathComponent(filename))
            let input = CIImage(bitmapData: Data(reference), bytesPerRow: width * 4,
                size: CGSize(width: width, height: height), format: .RGBA8, colorSpace: rgbSpace)
            try savePNG(input, at: directory.appendingPathComponent("input-\(frame).png"))
            frames.append(["frame": frame, "image": filename,
                "vsPreEncode": metrics(reference, rgbBytes(image, width: width, height: height), width: width, height: height)])
        }
        let state = encoder.diagnosticState()
        guard state.activeTuning == "speed-priority", state.propertyStatuses["AverageBitRate"] == 0,
              state.propertyStatuses["DataRateLimits"] == 0 else { throw ProbeFailure("Motion configuration not applied") }
        let report: [String: Any] = ["evidence": "Mac unpaced synthetic scrolling through production encoder; not iPhone or wireless validation",
            "width": width, "height": height, "targetFps": 60, "admittedFps": 20,
            "captureDurationSeconds": 3, "targetMbps": 15, "encodedBytes": totalBytes,
            "effectiveCaptureMbps": Double(totalBytes * 8) / 3_000_000,
            "keyframes": keys, "payloadBytes": sizes, "frames": frames,
            "encodeLoopSeconds": encodeLoopSeconds, "hardwareEncoder": state.usingHardwareEncoder ?? false]
        try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
            .write(to: directory.appendingPathComponent("metrics.json"), options: .atomic)
        print("Motion probe: \(totalBytes) bytes over 3 source seconds; keys \(keys); \(directory.path)")
    }

    // Exact byte-defined color bars/gradients: no screenshot content and no
    // timing claim. Run once with the baseline encoder and once with candidate.
    static func generateColorFrame(to directory: URL) throws {
        guard !FileManager.default.fileExists(atPath: directory.path) else {
            throw ProbeFailure("Output directory exists; no overwrite")
        }
        let width = 640, height = 384
        let colors: [[UInt8]] = [[255,0,0], [0,255,0], [0,0,255], [255,255,0],
            [0,255,255], [255,0,255], [255,255,255], [0,0,0], [128,128,128], [64,128,192]]
        var rgba = [UInt8](repeating: 255, count: width * height * 4)
        for y in 0..<height { for x in 0..<width {
            let index = (y * width + x) * 4
            let values: [UInt8]
            if y < 256 { values = colors[x / 64] }
            else {
                let level = UInt8((Double(x) * 255 / Double(width - 1)).rounded())
                values = y < 320 ? [level, level, level] : [level, 128, 255 - level]
            }
            for channel in 0..<3 { rgba[index + channel] = values[channel] }
        } }
        let picture = CIImage(bitmapData: Data(rgba), bytesPerRow: width * 4,
            size: CGSize(width: width, height: height), format: .RGBA8, colorSpace: rgbSpace)
        var buffer: CVPixelBuffer?
        try requireStatus(CVPixelBufferCreate(kCFAllocatorDefault, width, height,
            kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
            [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &buffer), "Create color NV12")
        CVBufferSetAttachment(buffer!, kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_ITU_R_709_2, .shouldPropagate)
        CVBufferSetAttachment(buffer!, kCVImageBufferTransferFunctionKey, kCVImageBufferTransferFunction_sRGB, .shouldPropagate)
        CVBufferSetAttachment(buffer!, kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_709_2, .shouldPropagate)
        imageContext.render(picture, to: buffer!, bounds: picture.extent, colorSpace: rgbSpace)
        let output = ResultSlot<EncodedPacket>()
        let encoder = H264Encoder(codecOutputHandler: { data, _, key, _, _, description in
            output.put(EncodedPacket(bytes: data, description: description, isKeyframe: key)); return true
        })
        encoder.setTargetFrameRate(60); encoder.setTuning(.speedPriority)
        encoder.setBitstreamFormat(.annexB)
        guard encoder.setAverageBitRate(15_000_000) else { throw ProbeFailure("Bitrate rejected") }
        let timing = H264FrameTiming(frameId: 0, captureAtMs: 0, callbackAtMs: 0,
            encodeStartedAtMs: 0, width: width, height: height, orientation: "landscape",
            captureContentStatus: "complete", freshContent: true, captureStreamGeneration: 1,
            h264PipelineEpoch: 1, sourcePresentationSeconds: 0)
        guard encoder.encode(pixelBuffer: buffer!, timing: timing) else { throw ProbeFailure("Color frame rejected") }
        let packet = try output.take("Encode color frame")
        guard packet.isKeyframe else { throw ProbeFailure("Color frame is not IDR") }
        let state = encoder.diagnosticState()
        let manifest: [String: Any] = ["reference": "Mac byte-defined RGB fixture converted to tagged BT709/sRGB NV12; not physical iPhone evidence",
            "runId": UUID().uuidString, "frameId": 0, "width": width, "height": height,
            "isKeyframe": true, "bitstreamFormat": "annex-b", "encodedBytes": packet.bytes.count,
            "averageBitRate": 15_000_000, "hardwareEncoder": state.usingHardwareEncoder ?? false,
            "propertyStatuses": state.propertyStatuses,
            "inputColorAttachments": String(describing: CVBufferCopyAttachments(buffer!, .shouldPropagate))]
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try savePNG(picture, at: directory.appendingPathComponent("rgb-fixture.png"))
        try savePNG(CIImage(cvPixelBuffer: buffer!), at: directory.appendingPathComponent("pre-encode.png"))
        try packet.bytes.write(to: directory.appendingPathComponent("encoded.bin"), options: .withoutOverwriting)
        try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
            .write(to: directory.appendingPathComponent("manifest.json"), options: .withoutOverwriting)
        encoder.invalidate()
        try decodeSnapshot(from: directory, to: directory.appendingPathComponent("native-decoded", isDirectory: true))
        print("Color fixture saved: \(directory.path)")
    }

    static func decodeSnapshot(from source: URL, to directory: URL) throws {
        let manifest = try JSONSerialization.jsonObject(with: Data(contentsOf: source.appendingPathComponent("manifest.json"))) as? [String: Any]
        guard let manifest, let width = manifest["width"] as? Int, let height = manifest["height"] as? Int,
              width >= 8, height >= 8, width * height <= 8_000_000,
              manifest["isKeyframe"] as? Bool == true else { throw ProbeFailure("Invalid snapshot manifest") }
        guard !FileManager.default.fileExists(atPath: directory.path) else { throw ProbeFailure("Output directory already exists") }
        let data = try Data(contentsOf: source.appendingPathComponent("encoded.bin"))
        guard data.count <= 8 * 1024 * 1024 else { throw ProbeFailure("Encoded sample too large") }
        let decoder = ProbeVideoDecoder(fixtureColorimetry: false)
        let packet: EncodedPacket
        if manifest["bitstreamFormat"] as? String == "annex-b" {
            let bytes = [UInt8](data)
            var starts: [(Int, Int)] = []
            var i = 0
            while i + 2 < bytes.count {
                if bytes[i] == 0, bytes[i+1] == 0, bytes[i+2] == 1 {
                    starts.append((i, i+3)); i += 3
                } else if i + 3 < bytes.count, bytes[i] == 0, bytes[i+1] == 0,
                          bytes[i+2] == 0, bytes[i+3] == 1 {
                    starts.append((i, i+4)); i += 4
                } else { i += 1 }
            }
            let nals = starts.enumerated().compactMap { index, start -> [UInt8]? in
                let end = index + 1 < starts.count ? starts[index+1].0 : bytes.count
                return end > start.1 ? Array(bytes[start.1..<end]) : nil
            }
            guard let sps = nals.first(where: { $0[0] & 31 == 7 }),
                  let pps = nals.first(where: { $0[0] & 31 == 8 }),
                  nals.contains(where: { $0[0] & 31 == 5 }) else { throw ProbeFailure("Missing SPS/PPS/IDR in snapshot") }
            try sps.withUnsafeBufferPointer { s in
                try pps.withUnsafeBufferPointer { p in
                    let pointers = [s.baseAddress!, p.baseAddress!]
                    let sizes = [s.count, p.count]
                    try requireStatus(CMVideoFormatDescriptionCreateFromH264ParameterSets(
                        allocator: kCFAllocatorDefault, parameterSetCount: 2,
                        parameterSetPointers: pointers, parameterSetSizes: sizes, nalUnitHeaderLength: 4,
                        formatDescriptionOut: &decoder.format), "Parse actual H264 parameter sets")
                }
            }
            var avcc = Data()
            for nal in nals {
                var length = UInt32(nal.count).bigEndian
                withUnsafeBytes(of: &length) { avcc.append(contentsOf: $0) }
                avcc.append(contentsOf: nal)
            }
            packet = EncodedPacket(bytes: avcc, description: nil)
        } else if manifest["bitstreamFormat"] as? String == "avcc" {
            packet = EncodedPacket(bytes: data, description: try Data(contentsOf: source.appendingPathComponent("avcc-description.bin")))
        } else { throw ProbeFailure("Unsupported bitstream") }
        let buffer = try decoder.decode(packet, width: width, height: height)
        guard CVPixelBufferGetWidth(buffer) == width, CVPixelBufferGetHeight(buffer) == height,
              let reference = CIImage(contentsOf: source.appendingPathComponent("pre-encode.png")),
              Int(reference.extent.width) == width, Int(reference.extent.height) == height else {
            throw ProbeFailure("Reference, encoded, and manifest dimensions disagree")
        }
        let image = CIImage(cvPixelBuffer: buffer)
        let report: [String: Any] = ["evidence": "Actual iPhone pre-encode buffer paired with its production H264 IDR; decoded locally on Mac, not in browser",
            "manifest": manifest, "colorHandling": "Actual SPS/PPS format for Annex-B; no fixture color override; RGB error may include color handling as well as compression",
            "encodedFormatExtensions": String(describing: decoder.format.map { CMFormatDescriptionGetExtensions($0) }),
            "decodedColorAttachments": String(describing: CVBufferCopyAttachments(buffer, .shouldPropagate)),
            "metrics": metrics(rgbBytes(reference, width: width, height: height), rgbBytes(image, width: width, height: height), width: width, height: height)]
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try savePNG(image, at: directory.appendingPathComponent("decoded.png"))
        try savePNG(reference, at: directory.appendingPathComponent("pre-encode.png"))
        try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
            .write(to: directory.appendingPathComponent("metrics.json"), options: .atomic)
        print("Decoded same-frame snapshot: \(directory.path)")
    }
}
