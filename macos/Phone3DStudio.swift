import AppKit
import CoreImage.CIFilterBuiltins
import SwiftUI
import UniformTypeIdentifiers
import WebKit

private enum StudioAppearance: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
    var title: String { rawValue.capitalized }
    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
    var appKitAppearance: NSAppearance? {
        switch self {
        case .system: nil
        case .light: NSAppearance(named: .aqua)
        case .dark: NSAppearance(named: .darkAqua)
        }
    }
}

private enum StudioPalette {
    static func accent(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(red: 0.675, green: 0.847, blue: 0.702) : Color(red: 0.196, green: 0.471, blue: 0.329)
    }
}

private enum StudioWorkspace: String, CaseIterable, Identifiable {
    case marble, tracking, mirroring
    var id: String { rawValue }
    var title: String {
        switch self {
        case .marble: "Marble"
        case .tracking: "Tracking"
        case .mirroring: "Screen mirroring"
        }
    }
}

// A quiet highlight adds pointer feedback while preserving native focus,
// pressed and disabled behavior. No motion means Reduce Motion is respected.
private struct NativeHoverFeedback: ViewModifier {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.colorSchemeContrast) private var contrast
    @State private var hovering = false

    func body(content: Content) -> some View {
        content
            .overlay {
                RoundedRectangle(cornerRadius: 6)
                    .fill(Color.primary.opacity(isEnabled && hovering ? 0.06 : 0))
                    .overlay {
                        RoundedRectangle(cornerRadius: 6)
                            .strokeBorder(Color.primary.opacity(isEnabled && hovering ? (contrast == .increased ? 0.55 : 0.22) : 0), lineWidth: 1)
                    }
                    .allowsHitTesting(false)
            }
            .onHover { hovering = $0 }
    }
}

private extension View {
    func nativeHoverFeedback() -> some View { modifier(NativeHoverFeedback()) }
}

struct PairingEndpoint: Decodable, Identifiable {
    let name: String
    let url: String
    let pairingURL: String
    var id: String { url }
}

private struct RuntimeReady: Decodable {
    let type: String
    let webURL: String
    let bridgePort: Int
    let framePort: Int
    let pairingChanged: Bool
    let endpoints: [PairingEndpoint]
}

@MainActor
final class StudioRuntime: ObservableObject {
    static let shared = StudioRuntime()

    @Published private(set) var webURL: URL?
    @Published private(set) var endpoints: [PairingEndpoint] = []
    @Published private(set) var starting = false
    @Published private(set) var error: String?
    @Published private(set) var logTail = ""
    @Published private(set) var pairingNotice: String?
    @Published var showPairing = false
    @Published var reloadID = UUID()

    private var process: Process?
    private var inputPipe: Pipe?
    private var outputPipe: Pipe?
    private var errorPipe: Pipe?
    private var outputBuffer = Data()
    private var startupTimeout: DispatchWorkItem?
    private var generation = UUID()

    func startIfNeeded() {
        if process == nil && !starting && error == nil { start() }
    }

    func start() {
        let previousProcess = process
        stop()
        let run = UUID()
        generation = run
        error = nil
        logTail = ""
        outputBuffer.removeAll()
        endpoints = []
        webURL = nil
        starting = true

        guard let resourceURL = Bundle.main.resourceURL else {
            fail("The app resources are missing. Rebuild or reinstall Phone 3D Studio.")
            return
        }
        let runtimeURL = resourceURL.appendingPathComponent("runtime", isDirectory: true)
        let nodeURL = runtimeURL.appendingPathComponent("node")
        let serverURL = runtimeURL.appendingPathComponent("scripts/desktop-server.mjs")
        guard FileManager.default.isExecutableFile(atPath: nodeURL.path),
              FileManager.default.fileExists(atPath: serverURL.path) else {
            fail("The local runtime is missing from this app. Rebuild or reinstall Phone 3D Studio.")
            return
        }

        let child = Process()
        let input = Pipe(), output = Pipe(), errors = Pipe()
        child.executableURL = nodeURL
        let previousPort = UserDefaults.standard.integer(forKey: "lastBridgePort")
        child.arguments = [serverURL.path, String(previousPort)]
        child.currentDirectoryURL = runtimeURL
        child.standardInput = input
        child.standardOutput = output
        child.standardError = errors
        // This child belongs only to this window. No service or shell startup files are used.
        process = child
        inputPipe = input
        outputPipe = output
        errorPipe = errors
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            DispatchQueue.main.async { [weak self] in
                guard let self, self.generation == run else { return }
                self.receiveOutput(data)
            }
        }
        errors.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            DispatchQueue.main.async { [weak self] in
                guard let self, self.generation == run else { return }
                self.appendLog(String(decoding: data, as: UTF8.self))
            }
        }
        child.terminationHandler = { [weak self] child in
            let status = child.terminationStatus
            DispatchQueue.main.async { [weak self] in
                guard let self, self.generation == run else { return }
                self.fail("The local session stopped (exit \(status)). Restart the session to reconnect.")
            }
        }
        var launched = false
        let launch = { [weak self] in
            guard let self, self.generation == run, self.starting, self.process === child, !launched else { return }
            launched = true
            do {
                try child.run()
                let timeout = DispatchWorkItem { [weak self] in
                    guard let self, self.generation == run, self.starting else { return }
                    self.fail("The local session did not become ready within 20 seconds. Check the details below and try again.")
                }
                self.startupTimeout = timeout
                DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: timeout)
            } catch {
                self.fail("Could not start the local session: \(error.localizedDescription)")
            }
        }
        if let previousProcess, previousProcess.isRunning {
            previousProcess.terminationHandler = { _ in DispatchQueue.main.async { launch() } }
            if !previousProcess.isRunning { launch() }
        } else {
            launch()
        }
    }

    func stop() {
        generation = UUID()
        startupTimeout?.cancel()
        startupTimeout = nil
        outputPipe?.fileHandleForReading.readabilityHandler = nil
        errorPipe?.fileHandleForReading.readabilityHandler = nil
        // EOF and SIGTERM both request graceful shutdown from desktop-server.mjs.
        try? inputPipe?.fileHandleForWriting.close()
        if let process, process.isRunning { process.terminate() }
        process = nil
        inputPipe = nil
        outputPipe = nil
        errorPipe = nil
        starting = false
    }

    private func fail(_ message: String) {
        stop()
        webURL = nil
        endpoints = []
        error = message
    }

    private func receiveOutput(_ data: Data) {
        outputBuffer.append(data)
        while let newline = outputBuffer.firstIndex(of: 10) {
            let line = outputBuffer.subdata(in: 0..<newline)
            outputBuffer.removeSubrange(0...newline)
            if let ready = try? JSONDecoder().decode(RuntimeReady.self, from: line),
               ready.type == "ready", let url = URL(string: ready.webURL),
               url.scheme == "http", url.host == "127.0.0.1", url.port != nil,
               url.user == nil, url.password == nil {
                startupTimeout?.cancel()
                startupTimeout = nil
                endpoints = ready.endpoints
                webURL = url
                starting = false
                let previousAddresses = UserDefaults.standard.stringArray(forKey: "lastPairingAddresses") ?? []
                let currentAddresses = Set(ready.endpoints.map(\.url))
                if ready.pairingChanged {
                    pairingNotice = "The previous bridge port is in use. Scan the new code on your iPhone before starting tracking."
                } else if !previousAddresses.isEmpty && currentAddresses != Set(previousAddresses) {
                    pairingNotice = "This Mac’s network addresses changed. If your iPhone cannot connect, scan the current code before starting tracking."
                } else {
                    pairingNotice = nil
                }
                UserDefaults.standard.set(ready.bridgePort, forKey: "lastBridgePort")
                UserDefaults.standard.set(ready.endpoints.map(\.url), forKey: "lastPairingAddresses")
                if pairingNotice != nil { showPairing = true }
            } else {
                appendLog(String(decoding: line, as: UTF8.self) + "\n")
            }
        }
        if outputBuffer.count > 65_536 {
            appendLog(String(decoding: outputBuffer.suffix(8_192), as: UTF8.self))
            outputBuffer.removeAll()
        }
    }

    private func appendLog(_ text: String) {
        logTail = String((logTail + text).suffix(12_000))
    }

}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) { StudioRuntime.shared.stop() }
}

@main
struct Phone3DStudioApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var runtime = StudioRuntime.shared
    @AppStorage("appearanceMode") private var appearance = StudioAppearance.system
    @State private var workspace = StudioWorkspace.marble

    var body: some Scene {
        Window("Phone 3D Studio", id: "studio") {
            StudioWindow(runtime: runtime, appearance: appearance, workspace: $workspace)
                .frame(minWidth: 980, minHeight: 680)
                .preferredColorScheme(appearance.colorScheme)
                .onChange(of: appearance, initial: true) { _, mode in
                    // Also updates AppKit titlebars, menus and save panels.
                    NSApp.appearance = mode.appKitAppearance
                }
                .onAppear { runtime.startIfNeeded() }
        }
        .defaultSize(width: 1280, height: 860)
        .windowToolbarStyle(.unifiedCompact)
        .commands {
            CommandMenu("Workspace") {
                Button("Marble") { workspace = .marble }.keyboardShortcut("1", modifiers: .command)
                Button("Tracking") { workspace = .tracking }.keyboardShortcut("2", modifiers: .command)
                Button("Screen mirroring") { workspace = .mirroring }.keyboardShortcut("3", modifiers: .command)
            }
            CommandGroup(after: .newItem) {
                Button("Connect iPhone…") { runtime.showPairing = true }
                    .keyboardShortcut("k", modifiers: .command)
                    .disabled(runtime.webURL == nil)
                Button("Reload Workspace") { runtime.reloadID = UUID() }
                    .keyboardShortcut("r", modifiers: .command)
                    .disabled(runtime.webURL == nil)
            }
        }
        Settings {
            StudioSettings(appearance: $appearance)
                .preferredColorScheme(appearance.colorScheme)
        }
        .windowResizability(.contentSize)
    }
}

private struct StudioSettings: View {
    @Binding var appearance: StudioAppearance

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Label("Appearance", systemImage: "paintpalette").font(.title2.bold())
            VStack(alignment: .leading, spacing: 10) {
                Text("Choose how Phone 3D Studio looks on this Mac.")
                    .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Picker("Appearance", selection: $appearance) {
                    ForEach(StudioAppearance.allCases) { mode in Text(mode.title).tag(mode) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .accessibilityLabel("Appearance")
                .help("System follows your Mac’s appearance. Light and Dark override it for this app.")
            }
            Text("System follows your Mac’s appearance. Your choice is saved for the next launch.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
        .padding(24)
        .frame(width: 420)
    }
}

private struct StudioWindow: View {
    @ObservedObject var runtime: StudioRuntime
    let appearance: StudioAppearance
    @Binding var workspace: StudioWorkspace
    @Environment(\.colorScheme) private var colorScheme
    @State private var pageLoading = true
    @State private var pageError: String?
    @State private var showDiagnostics = false

    var body: some View {
        ZStack {
            Color(nsColor: .windowBackgroundColor)
            if let url = runtime.webURL {
                WorkspaceWebView(url: url, reloadID: runtime.reloadID, appearance: appearance, workspace: workspace, loading: $pageLoading, error: $pageError, connectPhone: { runtime.showPairing = true })
                    .id(url)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                if let pageError {
                    errorCard(title: "The workspace could not load", message: pageError, button: "Reload Workspace") {
                        runtime.reloadID = UUID()
                    }
                } else if pageLoading {
                    loadingCard("Opening your workspace…")
                }
            } else if let error = runtime.error {
                errorCard(title: "The local session needs attention", message: error, button: "Try Again") { runtime.start() }
            } else {
                loadingCard("Starting your local session…")
            }
        }
        .onChange(of: runtime.webURL) { _, _ in
            pageLoading = true
            pageError = nil
        }
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("Workspace", selection: $workspace) {
                    ForEach(StudioWorkspace.allCases) { mode in Text(mode.title).tag(mode) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(width: 372)
                .disabled(runtime.webURL == nil)
                .help("Switch workspace (⌘1, ⌘2, ⌘3)")
            }
            ToolbarItem(placement: .primaryAction) {
                Button { runtime.showPairing = true } label: {
                    Label("Connect iPhone", systemImage: "iphone.gen3.radiowaves.left.and.right")
                        .labelStyle(.titleAndIcon)
                }
                .nativeHoverFeedback()
                .disabled(runtime.webURL == nil)
                .help("Show the pairing code and Mac address (⌘K)")
            }
            ToolbarItem(placement: .automatic) {
                Menu {
                    Button("Reload Workspace") { runtime.reloadID = UUID() }.disabled(runtime.webURL == nil)
                    Button("Restart Local Session") { runtime.start() }
                    Divider()
                    Button("Session Details…") { showDiagnostics = true }
                } label: { Label("Session", systemImage: "ellipsis.circle") }
                .nativeHoverFeedback()
                .help("Session controls")
            }
        }
        .tint(StudioPalette.accent(colorScheme))
        .sheet(isPresented: $runtime.showPairing) { PairingSheet(runtime: runtime, workspace: workspace) }
        .sheet(isPresented: $showDiagnostics) {
            VStack(alignment: .leading, spacing: 16) {
                Text("Session details").font(.title2.bold())
                Text("This app starts a private local session and stops it when you quit. A saved bridge port is reused when available. Your iPhone still needs to connect to this session.")
                    .foregroundStyle(.secondary)
                Text(runtime.webURL?.absoluteString ?? runtime.error ?? "Starting…")
                    .font(.system(.callout, design: .monospaced)).textSelection(.enabled)
                ScrollView {
                    Text(runtime.logTail.isEmpty ? "No runtime errors reported." : runtime.logTail)
                        .font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }.frame(height: 200).padding(12).background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
                HStack { Spacer(); Button("Done") { showDiagnostics = false }.keyboardShortcut(.defaultAction).nativeHoverFeedback() }
            }.padding(24).frame(width: 620)
        }
    }

    private func loadingCard(_ title: String) -> some View {
        VStack(spacing: 16) {
            ProgressView().controlSize(.large)
            Text(title).font(.headline)
            Text("Phone 3D Studio").font(.callout).foregroundStyle(.secondary)
        }.padding(32).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
    }

    private func errorCard(title: String, message: String, button: String, action: @escaping () -> Void) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle").font(.system(size: 34)).foregroundStyle(.orange)
            Text(title).font(.title2.bold())
            Text(message).multilineTextAlignment(.center).foregroundStyle(.secondary)
            HStack {
                Button("Show Details") { showDiagnostics = true }.nativeHoverFeedback()
                Button(button, action: action).buttonStyle(.borderedProminent).nativeHoverFeedback()
            }
        }.frame(maxWidth: 460).padding(32).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
    }
}

private struct PairingSheet: View {
    @ObservedObject var runtime: StudioRuntime
    let workspace: StudioWorkspace
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dismiss) private var dismiss
    @State private var selectedAddress = ""
    @State private var copied = false

    private var endpoint: PairingEndpoint? {
        runtime.endpoints.first(where: { $0.url == selectedAddress }) ?? runtime.endpoints.first
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Connect your iPhone").font(.system(size: 20, weight: .semibold))
                    Text("Keep both devices on the same Wi-Fi network.")
                        .font(.system(size: 13)).foregroundStyle(.secondary)
                }
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark").font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.secondary).frame(width: 28, height: 28)
                        .contentShape(RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain).nativeHoverFeedback().help("Close (Esc)")
                .accessibilityLabel("Close pairing").keyboardShortcut(.cancelAction)
            }
            if let endpoint {
                if let notice = runtime.pairingNotice {
                    Label(notice, systemImage: "exclamationmark.triangle")
                        .font(.callout).foregroundStyle(.orange)
                        .fixedSize(horizontal: false, vertical: true)
                }
                HStack(alignment: .center, spacing: 24) {
                    VStack(spacing: 8) {
                        if let qr = qrImage(endpoint.pairingURL) {
                            Image(nsImage: qr).interpolation(.none).resizable().frame(width: 188, height: 188)
                                .padding(12).background(.white, in: RoundedRectangle(cornerRadius: 10))
                                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color.primary.opacity(0.08)))
                                .accessibilityLabel("Pairing QR code for \(endpoint.url)")
                        }
                        Text("Scan in the iPhone app").font(.system(size: 11)).foregroundStyle(.secondary)
                    }
                    VStack(alignment: .leading, spacing: 18) {
                        instruction("1", title: "Open the iPhone app", detail: "Open Phone 3D Studio on your iPhone.")
                        instruction("2", title: "Scan this code", detail: "In Mac connection, tap Scan QR code to save this Mac’s address.")
                        if workspace == .mirroring {
                            instruction("3", title: "Start screen sharing", detail: "Start screen capture on your iPhone, then choose Full Display.")
                        } else {
                            instruction("3", title: "Start Tracking on iPhone", detail: workspace == .tracking
                                ? "Tracking powers both Mac views. Wait for Mac connected and normal tracking, then choose Set origin in Tracking."
                                : "Tracking powers both Mac views. Wait for Mac connected and normal tracking, then choose Start round in Marble.")
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
                VStack(alignment: .leading, spacing: 9) {
                    Text("Or enter the Mac address manually")
                        .font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary)
                    if runtime.endpoints.count > 1 {
                        Picker("Mac address", selection: Binding(get: { endpoint.url }, set: { selectedAddress = $0; copied = false })) {
                            ForEach(runtime.endpoints) { address in Text("\(address.name) · \(address.url)").tag(address.url) }
                        }
                        Text("Choose your Wi-Fi address.").font(.caption).foregroundStyle(.secondary)
                    }
                    HStack(spacing: 8) {
                        Text(endpoint.url).font(.system(size: 12, design: .monospaced)).textSelection(.enabled)
                            .lineLimit(1).truncationMode(.middle)
                            .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading).padding(.horizontal, 10)
                            .background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 6))
                            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.primary.opacity(0.12)))
                        Button {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(endpoint.url, forType: .string)
                            copied = true
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: copied ? "checkmark" : "doc.on.doc")
                                Text(copied ? "Copied" : "Copy").frame(width: 42)
                            }.font(.system(size: 12, weight: .medium)).frame(minHeight: 20)
                        }
                        .buttonStyle(.bordered).controlSize(.large).tint(.primary).nativeHoverFeedback()
                        .accessibilityLabel(copied ? "Address copied" : "Copy Mac address")
                    }
                }
            } else {
                ContentUnavailableView("No local network address", systemImage: "wifi.slash", description: Text("Connect this Mac to Wi-Fi, then restart the local session to create a pairing code."))
                Button("Restart Local Session") { runtime.start() }
                    .buttonStyle(.bordered).controlSize(.large).nativeHoverFeedback()
            }
            Divider()
            HStack(spacing: 20) {
                Text("Keep this app open while connected.")
                    .font(.system(size: 11)).foregroundStyle(.secondary)
                    .help("The app reuses the saved bridge port when available. Re-scan if the address changes.")
                Spacer()
                Button { dismiss() } label: {
                    Text("Done").font(.system(size: 13, weight: .medium)).frame(minWidth: 60, minHeight: 20)
                }
                .buttonStyle(.borderedProminent).controlSize(.large)
                .keyboardShortcut(.defaultAction).nativeHoverFeedback()
            }
        }
        .padding(24).frame(width: 620)
        .buttonBorderShape(.roundedRectangle(radius: 6))
        .tint(StudioPalette.accent(colorScheme))
    }

    private func instruction(_ number: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text(number).font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary)
                .frame(width: 20, height: 20).background(.quaternary, in: Circle())
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.system(size: 13, weight: .semibold))
                Text(detail).font(.system(size: 12)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func qrImage(_ text: String) -> NSImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)),
              let cgImage = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return NSImage(cgImage: cgImage, size: NSSize(width: cgImage.width, height: cgImage.height))
    }
}

private struct WorkspaceWebView: NSViewRepresentable {
    let url: URL
    let reloadID: UUID
    let appearance: StudioAppearance
    let workspace: StudioWorkspace
    @Binding var loading: Bool
    @Binding var error: String?
    let connectPhone: () -> Void

    private var documentURL: URL {
        guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        var query = (parts.queryItems ?? []).filter { !["desktop", "appearance", "mode", "experience"].contains($0.name) }
        // At the current 960 × 2088 stream, WKWebView needs the existing
        // hardware/AVCC startup window. Keep an explicit decoder choice.
        if !query.contains(where: { $0.name == "decoder" }) {
            query.append(URLQueryItem(name: "decoder", value: "hardware"))
        }
        query += [URLQueryItem(name: "desktop", value: "1"), URLQueryItem(name: "appearance", value: appearance.rawValue), URLQueryItem(name: "mode", value: workspace == .mirroring ? "mirroring" : "spatial"), URLQueryItem(name: "experience", value: workspace.rawValue)]
        parts.queryItems = query
        return parts.url ?? url
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(context.coordinator, name: "studio")
        configuration.preferences.isElementFullscreenEnabled = true
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.appearance = appearance.appKitAppearance
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.load(URLRequest(url: documentURL))
        context.coordinator.loadedURL = url
        context.coordinator.reloadID = reloadID
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        context.coordinator.parent = self
        view.appearance = appearance.appKitAppearance
        if context.coordinator.loadedURL != url || context.coordinator.reloadID != reloadID {
            context.coordinator.loadedURL = url
            context.coordinator.reloadID = reloadID
            view.load(URLRequest(url: documentURL))
        } else {
            if context.coordinator.appliedAppearance != appearance { context.coordinator.applyAppearance(to: view) }
            if context.coordinator.appliedWorkspace != workspace { context.coordinator.applyWorkspace(to: view) }
        }
    }

    static func dismantleNSView(_ view: WKWebView, coordinator: Coordinator) {
        coordinator.loadTimeout?.cancel()
        view.configuration.userContentController.removeScriptMessageHandler(forName: "studio")
        view.stopLoading()
        view.navigationDelegate = nil
        view.uiDelegate = nil
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandler {
        var parent: WorkspaceWebView
        var loadedURL: URL?
        var reloadID: UUID?
        var appliedAppearance: StudioAppearance?
        var appliedWorkspace: StudioWorkspace?
        var loadTimeout: DispatchWorkItem?
        private var savePanel: NSSavePanel?
        private var openPanel: NSOpenPanel?

        init(_ parent: WorkspaceWebView) { self.parent = parent }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "studio", message.body as? String == "connect-phone",
                  message.frameInfo.isMainFrame,
                  let sourceURL = message.frameInfo.request.url, isLocal(sourceURL) else { return }
            parent.connectPhone()
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            parent.loading = true
            parent.error = nil
            loadTimeout?.cancel()
            let timeout = DispatchWorkItem { [weak self, weak webView] in
                guard let self, self.parent.loading else { return }
                webView?.stopLoading()
                self.parent.loading = false
                self.parent.error = "The workspace did not finish loading within 25 seconds. Reload it to try again."
            }
            loadTimeout = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + 25, execute: timeout)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            loadTimeout?.cancel()
            parent.loading = false
            parent.error = nil
            applyAppearance(to: webView)
            applyWorkspace(to: webView)
        }

        func applyWorkspace(to webView: WKWebView) {
            appliedWorkspace = parent.workspace
            guard let data = try? JSONEncoder().encode(parent.workspace.rawValue),
                  let literal = String(data: data, encoding: .utf8) else { return }
            webView.evaluateJavaScript("window.phoneStudioSetWorkspace?.(\(literal))", completionHandler: nil)
        }

        func applyAppearance(to webView: WKWebView) {
            appliedAppearance = parent.appearance
            // JSONEncoder supplies a safe JavaScript string literal. Appearance
            // updates never navigate or replace this WebView's live world client.
            guard let data = try? JSONEncoder().encode(parent.appearance.rawValue),
                  let literal = String(data: data, encoding: .utf8) else { return }
            webView.evaluateJavaScript("window.phoneStudioSetAppearance?.(\(literal))", completionHandler: nil)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(error) }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(error) }

        private func failed(_ error: Error) {
            guard (error as NSError).code != NSURLErrorCancelled else { return }
            loadTimeout?.cancel()
            parent.loading = false
            parent.error = error.localizedDescription
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            loadTimeout?.cancel()
            parent.loading = false
            parent.error = "The 3D renderer stopped. Reload the workspace to restore it."
        }

        private func isLocal(_ url: URL) -> Bool {
            url.scheme == parent.url.scheme && url.host == parent.url.host && url.port == parent.url.port
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
            if navigationAction.shouldPerformDownload && (isLocal(url) || url.scheme == "blob") {
                decisionHandler(.download)
            } else if isLocal(url) {
                decisionHandler(.allow)
            } else {
                if navigationAction.navigationType == .linkActivated, ["http", "https"].contains(url.scheme ?? "") {
                    NSWorkspace.shared.open(url)
                }
                decisionHandler(.cancel)
            }
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url {
                if isLocal(url) { webView.load(URLRequest(url: url)) }
                else if ["http", "https"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
            }
            return nil
        }

        func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
            guard frame.isMainFrame, let sourceURL = frame.request.url, isLocal(sourceURL) else {
                completionHandler(nil)
                return
            }
            let panel = NSOpenPanel()
            panel.allowedContentTypes = [.movie, .video]
            panel.allowsMultipleSelection = parameters.allowsMultipleSelection
            panel.canChooseDirectories = parameters.allowsDirectories
            panel.canChooseFiles = true
            openPanel = panel
            let completed: (NSApplication.ModalResponse) -> Void = { [weak self] result in
                completionHandler(result == .OK ? panel.urls : nil)
                self?.openPanel = nil
            }
            if let window = webView.window { panel.beginSheetModal(for: window, completionHandler: completed) }
            else { panel.begin(completionHandler: completed) }
        }

        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
            download.delegate = self
        }

        func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
            let panel = NSSavePanel()
            panel.nameFieldStringValue = suggestedFilename
            panel.canCreateDirectories = true
            savePanel = panel
            panel.begin { [weak self] result in
                completionHandler(result == .OK ? panel.url : nil)
                self?.savePanel = nil
            }
        }

        func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
            guard (error as NSError).code != NSURLErrorCancelled else { return }
            let alert = NSAlert()
            alert.messageText = "The file could not be saved"
            alert.informativeText = error.localizedDescription
            alert.runModal()
        }
    }
}
