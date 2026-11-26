#if !canImport(ScreenCaptureKit)
import Combine
import Foundation

// The simulator SDK has no ScreenCaptureKit. Keep the real SwiftUI screens
// available for layout review without claiming a simulated live connection.
final class ScreenCaptureController: ObservableObject {
    @Published private(set) var captureState: CaptureState = .idle
    @Published var streamCodec: ScreenCodec = .h264
    let socketState: LowLatencyFrameSocket.State = .idle
    let poseSocketState: LiveSocket.State = .idle
    let videoRouteDescription = "Requires an iPhone"
    let webRTCState: WebRTCStreamer.State = .idle
    let benchmarkStimulusRun: BenchmarkRun? = nil
    let transportPreparationID: String? = nil
    let videoTransportConnected = false

    func setInputEnabled(_ enabled: Bool) {}
    func updateAppForeground(_ active: Bool) {}
    func updateBenchmarkStimulusVisibility(id: String, visible: Bool) {}
    func cancelBenchmark() {}
    func startBenchmark() {}
    func stop(completion: ((Bool) -> Void)? = nil) {
        captureState = .idle
        completion?(true)
    }
    func chooseFullDisplay() {
        captureState = .failed("Screen sharing requires a physical iPhone. You can review the interface in Simulator.")
    }
}
#endif
