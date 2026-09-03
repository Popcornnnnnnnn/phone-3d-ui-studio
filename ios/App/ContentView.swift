import SwiftUI

struct ContentView: View {
    @StateObject private var capture = ScreenCaptureController()

    private let bridgeURL = Bundle.main.object(
        forInfoDictionaryKey: "LiveBridgeURL"
    ) as? String ?? "Bridge URL missing"

    var body: some View {
        ZStack {
            NavigationStack {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Live iPhone input")
                        .font(.largeTitle.bold())
                    Text("Your screen and physical pose are sent directly to the Mac over the local network. No recording is saved by this app.")
                        .foregroundStyle(.secondary)
                }

                VStack(alignment: .leading, spacing: 8) {
                    Label("Mac bridge", systemImage: "network")
                        .font(.headline)
                    Text(bridgeURL)
                        .font(.system(.footnote, design: .monospaced))
                        .textSelection(.enabled)
                        .foregroundStyle(.secondary)
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))

                VStack(alignment: .leading, spacing: 12) {
                    Picker("Stream codec", selection: $capture.streamCodec) {
                        ForEach(ScreenCodec.allCases) { codec in
                            Text(codec.rawValue).tag(codec)
                        }
                    }
                    .pickerStyle(.segmented)
                    .disabled(capture.captureState.isActive)

                    Text(codecDescription)
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    Button {
                        capture.chooseFullDisplay()
                    } label: {
                        Label("Choose Full Display", systemImage: "rectangle.inset.filled.and.person.filled")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(capture.captureState.isActive)

                    if capture.captureState.isActive {
                        Button("Stop live capture", role: .destructive) {
                            capture.stop()
                        }
                        .buttonStyle(.bordered)

                        Button {
                            capture.startBenchmark()
                        } label: {
                            Label("Run 15s benchmark", systemImage: "gauge.with.dots.needle.67percent")
                                .font(.headline)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 10)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.indigo)
                        .disabled(
                            capture.webRTCState != .connected ||
                                capture.benchmarkRun != nil
                        )

                        Text("Connect the Mac receiver first, then tap once. The app generates motion for 15 seconds, so no manual scrolling is needed.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }

                    Label(capture.captureState.label, systemImage: capture.captureState.isActive ? "dot.radiowaves.left.and.right" : "circle")
                        .font(.subheadline.weight(.semibold))

                    HStack(spacing: 6) {
                        Circle()
                            .fill(socketColor)
                            .frame(width: 8, height: 8)
                        Text("Mac bridge: \(capture.socketState.rawValue)")
                            .font(.footnote.monospaced())
                            .foregroundStyle(.secondary)
                    }

                    if capture.streamCodec == .webrtc {
                        HStack(spacing: 6) {
                            Circle()
                                .fill(webRTCColor)
                                .frame(width: 8, height: 8)
                            Text("WebRTC video: \(capture.webRTCState.rawValue)")
                                .font(.footnote.monospaced())
                                .foregroundStyle(.secondary)
                        }
                    }

                    Text("Choose Full Display in the system sheet. After capture starts, leave this app and use the phone normally.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Text("Prototype: use only on a trusted local network. Protected video content may be omitted by iOS.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding(24)
            .navigationTitle("Phone 3D Studio")
            .navigationBarTitleDisplayMode(.inline)
            }

            if let benchmarkRun = capture.benchmarkRun {
                StreamBenchmarkView(
                    run: benchmarkRun,
                    cancel: capture.cancelBenchmark
                )
                .transition(.opacity)
                .zIndex(1)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: capture.benchmarkRun)
    }

    private var socketColor: Color {
        switch capture.socketState {
        case .connected:
            return .green
        case .connecting:
            return .orange
        case .failed:
            return .red
        case .idle:
            return .secondary
        }
    }

    private var webRTCColor: Color {
        switch capture.webRTCState {
        case .connected:
            return .green
        case .signaling, .connecting:
            return .orange
        case .failed:
            return .red
        case .idle:
            return .secondary
        }
    }

    private var codecDescription: String {
        switch capture.streamCodec {
        case .webrtc:
            return "WebRTC sends adaptive video directly to the Mac and is the lowest-latency mode."
        case .h264:
            return "H.264 uses a high-detail 960 px short edge through the fallback WebSocket path."
        case .jpeg:
            return "JPEG keeps every frame independent and drops stale queued frames."
        }
    }
}

#Preview {
    ContentView()
}
