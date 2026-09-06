import SwiftUI

struct ContentView: View {
    @StateObject private var capture = ScreenCaptureController()
    @StateObject private var spatial = SpatialTrackingController()
    @State private var inputMode: StudioInputMode = .spatial
    @State private var switchingMode = false
    @State private var modeError: String?
    @Environment(\.scenePhase) private var scenePhase

    private let bridgeURL = Bundle.main.object(
        forInfoDictionaryKey: "LiveBridgeURL"
    ) as? String ?? "Bridge URL missing"

    var body: some View {
        ZStack {
            NavigationStack {
                ScrollView {
                    VStack(spacing: 18) {
                        Picker("Input mode", selection: Binding(
                            get: { inputMode },
                            set: { switchMode(to: $0) }
                        )) {
                            ForEach(StudioInputMode.allCases) { mode in
                                Text(mode.rawValue).tag(mode)
                            }
                        }.pickerStyle(.segmented).disabled(switchingMode)
                        if let modeError { Text(modeError).foregroundStyle(.red) }
                        if inputMode == .spatial {
                            SpatialTrackingView(controller: spatial).disabled(switchingMode)
                        } else {
                        heroCard
                        captureCard
                        connectionCard

                        if capture.captureState == .streaming {
                            benchmarkCard
                        }

                        privacyNote
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 12)
                    .padding(.bottom, 32)
                }
                .background(Color(uiColor: .systemGroupedBackground))
                .navigationTitle("Phone 3D Studio")
                .navigationBarTitleDisplayMode(.inline)
            }

            if let benchmarkRun = capture.benchmarkStimulusRun {
                StreamBenchmarkView(
                    run: benchmarkRun,
                    cancel: capture.cancelBenchmark
                )
                .onAppear { capture.updateBenchmarkStimulusVisibility(id: benchmarkRun.id, visible: true) }
                .onDisappear { capture.updateBenchmarkStimulusVisibility(id: benchmarkRun.id, visible: false) }
                .transition(.opacity)
                .zIndex(1)
            }

            if capture.transportPreparationID != nil {
                VStack(spacing: 12) {
                    Text("Preparing wireless test")
                        .font(.headline)
                    Text("Keep this app open. The test starts automatically.")
                        .font(.footnote)
                        .multilineTextAlignment(.center)
                    TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { context in
                        let phase = context.date.timeIntervalSinceReferenceDate
                            .truncatingRemainder(dividingBy: 1)
                        Capsule()
                            .fill(.green)
                            .frame(width: 40, height: 8)
                            .offset(x: (phase - 0.5) * 160)
                            .frame(width: 200, height: 8)
                    }
                }
                .padding(24)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
                .padding(24)
                .allowsHitTesting(false)
                .zIndex(2)
            }
        }
        .animation(
            .easeInOut(duration: 0.2),
            value: capture.benchmarkStimulusRun?.id
        )
        .onAppear {
            capture.setInputEnabled(inputMode == .mirroring)
            capture.updateAppForeground(scenePhase == .active && inputMode == .mirroring)
            spatial.updateForeground(scenePhase == .active && inputMode == .spatial)
        }
        .onChange(of: scenePhase) { _, phase in
            capture.updateAppForeground(phase == .active && inputMode == .mirroring)
            spatial.updateForeground(phase == .active && inputMode == .spatial)
        }
    }

    private func switchMode(to next: StudioInputMode) {
        guard next != inputMode, !switchingMode else { return }
        switchingMode = true; modeError = nil
        spatial.stop()
        capture.setInputEnabled(false)
        capture.stop { success in
            switchingMode = false
            guard success else {
                modeError = "Could not stop screen capture. Stop it before switching modes."
                return
            }
            inputMode = next
            capture.setInputEnabled(next == .mirroring)
            capture.updateAppForeground(scenePhase == .active && next == .mirroring)
            spatial.updateForeground(scenePhase == .active && next == .spatial)
        }
    }

    private var heroCard: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 14) {
                Image("BrandMark")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 58, height: 58)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .shadow(color: .black.opacity(0.12), radius: 8, y: 4)

                VStack(alignment: .leading, spacing: 5) {
                    Text("Live iPhone input")
                        .font(.title2.bold())
                    Text("Drive the Mac model with your screen and physical pose.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 0)
            }

            HStack(spacing: 10) {
                Circle()
                    .fill(overallStatusColor)
                    .frame(width: 10, height: 10)
                    .shadow(color: overallStatusColor.opacity(0.4), radius: 5)

                VStack(alignment: .leading, spacing: 2) {
                    Text(overallStatusTitle)
                        .font(.subheadline.weight(.semibold))
                    Text(overallStatusDetail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()
            }
            .padding(14)
            .background(Color(uiColor: .secondarySystemGroupedBackground))
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .padding(20)
        .background(
            LinearGradient(
                colors: [
                    Color(uiColor: .systemBackground),
                    Color.green.opacity(0.07)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(Color.green.opacity(0.12), lineWidth: 1)
        }
    }

    private var captureCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            sectionHeading(
                eyebrow: captureCardEyebrow,
                title: captureCardTitle
            )

            Text(captureCardDetail)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if capture.captureState.isActive {
                Button(role: .destructive) {
                    capture.stop()
                } label: {
                    Label("Stop live capture", systemImage: "stop.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                }
                .buttonStyle(.bordered)
            } else {
                Button {
                    capture.chooseFullDisplay()
                } label: {
                    Label(
                        "Start ScreenCaptureKit",
                        systemImage: "rectangle.on.rectangle.angled"
                    )
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
            }

            DisclosureGroup {
                VStack(alignment: .leading, spacing: 10) {
                    Picker("Stream codec", selection: $capture.streamCodec) {
                        ForEach(ScreenCodec.allCases) { codec in
                            Text(codec.rawValue).tag(codec)
                        }
                    }
                    .pickerStyle(.segmented)
                    .disabled(capture.captureState.isActive)

                    Text(codecDescription)
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Divider()

                    Text("Legacy ReplayKit fallback")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)

                    BroadcastPickerButton()

                    Text("ScreenCaptureKit is the measured low-latency path. ReplayKit remains available only as a compatibility fallback and is not used by performance benchmarks.")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                .padding(.top, 10)
            } label: {
                Label("Capture settings and fallback", systemImage: "slider.horizontal.3")
                    .font(.subheadline.weight(.semibold))
            }
            .tint(.primary)
        }
        .cardStyle()
    }

    private var connectionCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            sectionHeading(eyebrow: "LOCAL CONNECTION", title: "Mac bridge")

            Text(bridgeURL)
                .font(.system(.caption, design: .monospaced))
                .textSelection(.enabled)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(Color(uiColor: .secondarySystemGroupedBackground))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

            statusRow(
                title: "Control & motion",
                value: capture.poseSocketState.rawValue,
                color: capture.poseSocketState == .connected ? .green : .secondary
            )

            if capture.streamCodec == .h264 {
                statusRow(title: "Video route", value: capture.videoRouteDescription,
                    color: socketColor)
            }

            if capture.streamCodec == .webrtc {
                Divider()
                statusRow(
                    title: "Live video",
                    value: capture.webRTCState.rawValue,
                    color: webRTCColor
                )
            }
        }
        .cardStyle()
    }

    private var benchmarkCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionHeading(eyebrow: "DIAGNOSTICS", title: "15-second benchmark")

            Text("The app generates motion automatically, so you do not need to keep scrolling.")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Button {
                capture.startBenchmark()
            } label: {
                Label("Run benchmark", systemImage: "gauge.with.dots.needle.67percent")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
            }
            .buttonStyle(.borderedProminent)
            .tint(.indigo)
            .disabled(
                !capture.videoTransportConnected ||
                    capture.benchmarkStimulusRun != nil
            )
        }
        .cardStyle()
    }

    private var privacyNote: some View {
        Label {
            Text("Use on a trusted local network. Protected video may be omitted by iOS.")
        } icon: {
            Image(systemName: "lock.shield")
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 6)
    }

    private func sectionHeading(eyebrow: String, title: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(eyebrow)
                .font(.caption2.weight(.bold))
                .tracking(1.2)
                .foregroundStyle(.secondary)
            Text(title)
                .font(.title3.bold())
        }
    }

    private func statusRow(title: String, value: String, color: Color) -> some View {
        HStack(spacing: 10) {
            Circle()
                .fill(color)
                .frame(width: 9, height: 9)
            Text(title)
                .font(.subheadline)
            Spacer()
            Text(value.capitalized)
                .font(.caption.monospaced().weight(.medium))
                .foregroundStyle(.secondary)
        }
    }

    private var overallStatusTitle: String {
        if case .failed = capture.captureState {
            return "Needs attention"
        }
        if capture.captureState == .streaming,
           capture.videoTransportConnected {
            return "Live on your Mac"
        }
        if capture.captureState.isActive {
            return "Starting live input"
        }
        if capture.socketState == .connected {
            return "Mac bridge connected"
        }
        return "Ready to connect"
    }

    private var overallStatusDetail: String {
        if case let .failed(message) = capture.captureState {
            return message
        }
        return capture.captureState.label
    }

    private var overallStatusColor: Color {
        if case .failed = capture.captureState {
            return .red
        }
        if capture.captureState == .streaming,
           capture.videoTransportConnected {
            return .green
        }
        if capture.captureState.isActive {
            return .orange
        }
        return .secondary
    }

    private var captureCardEyebrow: String {
        switch capture.captureState {
        case .idle, .failed:
            return "START CAPTURE"
        case .choosing:
            return "SELECT DISPLAY"
        case .starting:
            return "CAPTURE STARTING"
        case .streaming:
            return "CAPTURE ACTIVE"
        }
    }

    private var captureCardTitle: String {
        switch capture.captureState {
        case .idle, .failed:
            return "Share your display"
        case .choosing:
            return "Choose Full Display"
        case .starting:
            return "Starting screen capture"
        case .streaming:
            return "Your display is live"
        }
    }

    private var captureCardDetail: String {
        switch capture.captureState {
        case .idle, .failed:
            return "Tap Start ScreenCaptureKit, then choose Full Display in the system sheet. Nothing is stored by this app."
        case .choosing:
            return "The stream has not started yet. Select Full Display in the system sheet to continue."
        case .starting:
            return "The selected display is opening. Video will appear on the Mac when the first frame arrives."
        case .streaming:
            return "You can leave this app and use your phone normally."
        }
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
            return "Adaptive VP8 fallback when the hardware H.264 path is unavailable."
        case .h264:
            return "Lowest-delay 960 px hardware video. Recommended for normal use."
        case .jpeg:
            return "Independent JPEG frames with stale-frame dropping."
        }
    }
}

private extension View {
    func cardStyle() -> some View {
        padding(18)
            .background(Color(uiColor: .systemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(Color.primary.opacity(0.06), lineWidth: 1)
            }
    }
}

#Preview {
    ContentView()
}
