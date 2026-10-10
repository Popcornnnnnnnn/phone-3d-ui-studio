import AVFoundation
import SwiftUI

struct PairingScannerView: View {
    let completed: (Result<String, Error>) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            PairingCameraView(completed: completed)
                .ignoresSafeArea(edges: .bottom)
                .overlay(alignment: .bottom) {
                    Text("Point the camera at the pairing code in the Mac app. Camera images stay on this iPhone.")
                        .font(.subheadline).multilineTextAlignment(.center)
                        .padding(20).background(.regularMaterial)
                }
                .navigationTitle("Scan Mac QR code")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}

private struct PairingCameraView: UIViewControllerRepresentable {
    let completed: (Result<String, Error>) -> Void

    func makeUIViewController(context: Context) -> PairingCameraController {
        PairingCameraController(completed: completed)
    }

    func updateUIViewController(_ controller: PairingCameraController, context: Context) {}
}

private final class PairingCameraController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "studio.pairing-camera")
    private var preview: AVCaptureVideoPreviewLayer?
    private var delivered = false
    private var requested = false
    private let completed: (Result<String, Error>) -> Void

    init(completed: @escaping (Result<String, Error>) -> Void) {
        self.completed = completed
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        view.layer.addSublayer(layer)
        preview = layer
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview?.frame = view.bounds
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !requested else { return }
        requested = true
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: configureCamera()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] allowed in
                DispatchQueue.main.async {
                    guard let self, self.viewIfLoaded?.window != nil else { return }
                    if allowed { self.configureCamera() }
                    else { self.fail("Camera access was denied. Enter the Mac address manually, or enable Camera in Settings.") }
                }
            }
        default: fail("Camera access is unavailable. Enter the Mac address manually, or enable Camera in Settings.")
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        queue.async { [session] in session.stopRunning() }
    }

    private func configureCamera() {
        queue.async { [weak self] in
            guard let self else { return }
            guard let camera = AVCaptureDevice.default(for: .video),
                  let input = try? AVCaptureDeviceInput(device: camera),
                  self.session.canAddInput(input) else {
                DispatchQueue.main.async { self.fail("The camera could not start. Enter the Mac address manually.") }
                return
            }
            self.session.beginConfiguration()
            self.session.addInput(input)
            let output = AVCaptureMetadataOutput()
            guard self.session.canAddOutput(output) else {
                self.session.commitConfiguration()
                DispatchQueue.main.async { self.fail("QR scanning is unavailable. Enter the Mac address manually.") }
                return
            }
            self.session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            guard output.availableMetadataObjectTypes.contains(.qr) else {
                self.session.commitConfiguration()
                DispatchQueue.main.async { self.fail("QR scanning is unavailable. Enter the Mac address manually.") }
                return
            }
            output.metadataObjectTypes = [.qr]
            self.session.commitConfiguration()
            self.session.startRunning()
        }
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput,
                        didOutput metadataObjects: [AVMetadataObject],
                        from connection: AVCaptureConnection) {
        guard let code = metadataObjects.compactMap({ $0 as? AVMetadataMachineReadableCodeObject })
            .first(where: { $0.type == .qr })?.stringValue else { return }
        finish(.success(code))
    }

    private func fail(_ message: String) {
        finish(.failure(NSError(domain: "Phone3DPairing", code: 1,
                                userInfo: [NSLocalizedDescriptionKey: message])))
    }

    private func finish(_ result: Result<String, Error>) {
        guard !delivered else { return }
        delivered = true
        queue.async { [weak self] in
            guard let self else { return }
            self.session.stopRunning()
            DispatchQueue.main.async { self.completed(result) }
        }
    }
}
