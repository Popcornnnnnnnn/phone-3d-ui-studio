import SwiftUI

struct ContentView: View {
    @StateObject private var capture = ScreenCaptureController()
    @StateObject private var spatial = SpatialTrackingController()
    @State private var inputMode: StudioInputMode = .spatial
    @State private var switchingMode = false
    @State private var modeError: String?
    @State private var pairedEndpoint = BridgeEndpointStore.current
    @State private var addressDraft = ""
    @State private var showAddressEditor = false
    @State private var showPairingScanner = false
    @State private var pairingMessage: String?
    @State private var pairingFailed = false
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("studioAppearance") private var appearance = "system"
    @State private var showSettings = false
    @State private var showConnectionControls = false

    var body: some View {
        ZStack {
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        Picker("Input mode", selection: Binding(
                            get: { inputMode },
                            set: { switchMode(to: $0) }
                        )) {
                            Text("Tracking").tag(StudioInputMode.spatial)
                            Text("Screen mirroring").tag(StudioInputMode.mirroring)
                        }
                        .pickerStyle(.segmented)
                        .disabled(switchingMode)

                        pairingCard
                        if let modeError {
                            Text(modeError).font(.footnote).foregroundStyle(.red)
                        }
                        if inputMode == .spatial {
                            SpatialTrackingView(controller: spatial).disabled(switchingMode)
                        } else {
                            StudioPageHeading(title: "Screen mirroring",
                                subtitle: "Your screen and motion, together on your Mac.")
                            captureCard
                            mirroringDetails
                            privacyNote
                        }
                    }
                    .frame(maxWidth: 560)
                    .padding(.horizontal, 20)
                    .padding(.top, 16)
                    .padding(.bottom, 28)
                    .frame(maxWidth: .infinity)
                }
                .background(Color(uiColor: .systemGroupedBackground))
                .navigationTitle("Phone 3D Studio")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { showSettings = true } label: {
                            Image(systemName: "gearshape")
                                .font(.system(size: 18, weight: .regular))
                                .frame(width: 32, height: 32)
                        }
                        .foregroundStyle(.primary)
                        .accessibilityLabel("Appearance settings")
                    }
                }
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
        .preferredColorScheme(appearance == "light" ? .light : appearance == "dark" ? .dark : nil)
        .tint(StudioColors.accent)
        .sheet(isPresented: $showSettings) { appearanceSettings }
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
        .onOpenURL { url in
            showAddressEditor = false
            showPairingScanner = false
            receivePairingLink(url.absoluteString)
        }
        .sheet(isPresented: $showAddressEditor) { addressEditor }
        .sheet(isPresented: $showPairingScanner) {
            PairingScannerView { result in
                showPairingScanner = false
                switch result {
                case .success(let value): receivePairingLink(value)
                case .failure(let error): reportPairing(error.localizedDescription, failed: true)
                }
            }
        }
        .fullScreenCover(isPresented: Binding(get: { spatial.marblePresented }, set: { if !$0 { spatial.exitMarble() } })) {
            MarblePortraitHost(controller: spatial).interactiveDismissDisabled()
        }
    }

    @ViewBuilder private var pairingCard: some View {
        DisclosureGroup(isExpanded: $showConnectionControls) {
            VStack(alignment: .leading, spacing: 14) {
                Text("On your Mac, click Connect iPhone. Keep both devices on the same Wi-Fi network.")
                    .font(.subheadline).foregroundStyle(.secondary)
                Button { prepareScanner() } label: {
                    StudioActionLabel("Scan QR code", systemImage: "qrcode.viewfinder")
                }.buttonStyle(StudioActionStyle(prominent: true))
                Button("Enter address manually") {
                    addressDraft = pairedEndpoint?.url.absoluteString ?? ""
                    showAddressEditor = true
                }.buttonStyle(StudioActionStyle())
            }
            .padding(.top, 16)
            .disabled(switchingMode)
        } label: {
            HStack(spacing: 12) {
                StudioSymbol(name: "laptopcomputer")
                VStack(alignment: .leading, spacing: 4) {
                    Text("Mac connection").font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                    Text(macConnected ? "Connected to Mac" : pairedEndpoint.map { endpoint in
                        let host = endpoint.url.host ?? "Mac"
                        return "Saved address · " + host + (endpoint.url.port.map { ":\($0)" } ?? "")
                    } ?? "Scan a code to pair")
                    .font(.caption).foregroundStyle(.secondary)
                    .lineLimit(1).truncationMode(.middle)
                }
                Spacer(minLength: 0)
                if macConnected {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(StudioColors.accent)
                        .accessibilityLabel("Connected")
                }
            }
        }
        .tint(.secondary)
        .studioCard()
        if switchingMode {
            ProgressView("Stopping the current session…").font(.footnote)
        }
        if let pairingMessage {
            Text(pairingMessage).font(.footnote)
                .foregroundStyle(pairingFailed ? Color.red : Color.secondary)
        }
    }

    private var macConnected: Bool {
        inputMode == .spatial ? spatial.connection == "Connected" : capture.poseSocketState == .connected
    }

    private var appearanceSettings: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Appearance", selection: $appearance) {
                        Text("System").tag("system")
                        Text("Light").tag("light")
                        Text("Dark").tag("dark")
                    }.pickerStyle(.segmented)
                } header: { Text("Appearance") } footer: {
                    Text("System follows your iPhone. Your choice is saved for next time.")
                }
            }
            .navigationTitle("Appearance")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { showSettings = false }
                }
            }
        }
        .presentationDetents([.medium])
        .preferredColorScheme(appearance == "light" ? .light : appearance == "dark" ? .dark : nil)
        .tint(StudioColors.accent)
    }

    private var addressEditor: some View {
        NavigationStack {
            Form {
                Section("Mac address") {
                    TextField("ws://192.168.1.10:4319/", text: $addressDraft)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .keyboardType(.URL)
                    Text("Copy the address shown in the Mac app. Saving stops the current session; tap Start tracking or Start sharing when ready to connect.")
                        .font(.footnote).foregroundStyle(.secondary)
                    if let error = addressValidationError {
                        Text(error).font(.caption).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Connect to Mac")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { showAddressEditor = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        guard let endpoint = try? BridgeEndpoint(addressDraft) else { return }
                        showAddressEditor = false
                        saveEndpoint(endpoint)
                    }.disabled(addressValidationError != nil || addressDraft.isEmpty || switchingMode)
                }
            }
        }.presentationDetents([.medium, .large])
            .tint(StudioColors.accent)
    }

    private var addressValidationError: String? {
        guard !addressDraft.isEmpty else { return nil }
        do { _ = try BridgeEndpoint(addressDraft); return nil }
        catch { return error.localizedDescription }
    }

    private func receivePairingLink(_ value: String) {
        do { saveEndpoint(try BridgeEndpoint.pairingLink(value)) }
        catch { reportPairing(error.localizedDescription, failed: true) }
    }

    private func saveEndpoint(_ endpoint: BridgeEndpoint) {
        stopForPairing {
            BridgeEndpointStore.save(endpoint)
            pairedEndpoint = endpoint
            showConnectionControls = false
            reportPairing(inputMode == .spatial
                ? "Mac saved. Tap Start tracking to connect."
                : "Mac saved. Tap Start sharing to connect.", failed: false)
        }
    }

    private func prepareScanner() {
        stopForPairing { showPairingScanner = true }
    }

    private func stopForPairing(_ completed: @escaping () -> Void) {
        guard !switchingMode else {
            reportPairing("A session is still stopping. Try pairing again in a moment.", failed: true)
            return
        }
        switchingMode = true
        pairingMessage = nil
        spatial.stop()
        capture.setInputEnabled(false)
        capture.stop { success in
            switchingMode = false
            capture.setInputEnabled(inputMode == .mirroring)
            guard success else {
                reportPairing("Could not stop screen capture. Stop it before changing the Mac address.", failed: true)
                return
            }
            completed()
        }
    }

    private func reportPairing(_ message: String, failed: Bool) {
        pairingMessage = message
        pairingFailed = failed
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

    private var captureCard: some View {
        VStack(alignment: .leading, spacing: 18) {
            StudioStatus(title: overallStatusTitle, color: overallStatusColor)
            Text(captureCardDetail)
                .font(.subheadline).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if case .failed = capture.captureState {
                Text(overallStatusDetail).font(.footnote).foregroundStyle(.red)
            }
            if capture.captureState.isActive {
                Button { capture.stop() } label: {
                    StudioActionLabel("Stop sharing", systemImage: "stop.fill")
                }.buttonStyle(StudioActionStyle())
            } else {
                Button { capture.chooseFullDisplay() } label: {
                    StudioActionLabel("Start sharing", systemImage: "play.fill")
                }.buttonStyle(StudioActionStyle(prominent: true))
            }
        }
        .studioCard()
        .disabled(switchingMode)
    }

    private var mirroringDetails: some View {
        VStack(alignment: .leading, spacing: 0) {
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 16) {
                    Picker("Stream codec", selection: $capture.streamCodec) {
                        ForEach(ScreenCodec.allCases) { codec in
                            Text(codec.rawValue).tag(codec)
                        }
                    }
                    .pickerStyle(.segmented)
                    .disabled(capture.captureState.isActive)
                    Text(codecDescription).font(.footnote).foregroundStyle(.secondary)
                }.padding(.top, 16)
            } label: { Text("Capture settings").font(.subheadline.weight(.semibold)).foregroundStyle(.primary) }
            .padding(.vertical, 16)
            Divider()
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 16) {
                    StudioValueRow(title: "Motion", value: capture.poseSocketState.rawValue.capitalized)
                    if capture.streamCodec == .h264 {
                        StudioValueRow(title: "Video", value: capture.videoRouteDescription)
                    }
                    if capture.streamCodec == .webrtc {
                        StudioValueRow(title: "Video", value: capture.webRTCState.rawValue.capitalized)
                    }
                    if capture.captureState == .streaming {
                        Divider()
                        Text("15-second benchmark").font(.subheadline.weight(.semibold))
                        Text("Generates motion to measure streaming performance.")
                            .font(.footnote).foregroundStyle(.secondary)
                        Button { capture.startBenchmark() } label: {
                            StudioActionLabel("Run benchmark", systemImage: "waveform.path.ecg")
                        }
                        .buttonStyle(StudioActionStyle())
                        .disabled(!capture.videoTransportConnected || capture.benchmarkStimulusRun != nil)
                    }
                }.padding(.top, 16)
            } label: { Text("Diagnostics").font(.subheadline.weight(.semibold)).foregroundStyle(.primary) }
            .padding(.vertical, 16)
        }
        .tint(.secondary)
    }

    private var privacyNote: some View {
        Text("Your display is sent directly to your Mac. This app does not save a recording. Protected video may be hidden by iOS.")
            .font(.footnote).foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var overallStatusTitle: String {
        if case .failed = capture.captureState {
            return "Needs attention"
        }
        if pairedEndpoint == nil { return "Pair with Mac" }
        if capture.captureState == .streaming,
           capture.videoTransportConnected {
            return "Live on your Mac"
        }
        if capture.captureState.isActive {
            return "Starting screen sharing"
        }
        if capture.socketState == .connected {
            return "Mac connected"
        }
        return "Ready to share"
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

    private var captureCardDetail: String {
        if pairedEndpoint == nil { return "On your Mac, click Connect iPhone and scan its code here before starting screen sharing." }
        switch capture.captureState {
        case .idle, .failed:
            return "Choose Full Display in the next screen to mirror your iPhone on your Mac."
        case .choosing:
            return "The stream has not started yet. Select Full Display in the system sheet to continue."
        case .starting:
            return "The selected display is opening. Video will appear on the Mac when the first frame arrives."
        case .streaming:
            return "You can leave this app and use your phone normally."
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

#Preview {
    ContentView()
}
