import Network
import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    let runner = RouteProbeRunner()

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        true
    }

    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(
            name: "Default Configuration",
            sessionRole: connectingSceneSession.role
        )
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard
            let windowScene = scene as? UIWindowScene,
            let appDelegate = UIApplication.shared.delegate as? AppDelegate
        else { return }

        let window = UIWindow(windowScene: windowScene)
        let runner = appDelegate.runner
        let viewController = ProbeViewController(runner: runner)
        window.rootViewController = UINavigationController(rootViewController: viewController)
        window.makeKeyAndVisible()
        self.window = window
    }
}

final class ProbeViewController: UIViewController {
    private let runner: RouteProbeRunner
    private let textView = UITextView()
    private let runButton = UIButton(type: .system)
    private var hasRunAutomatically = false

    init(runner: RouteProbeRunner) {
        self.runner = runner
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "USB Route Probe"
        view.backgroundColor = .systemBackground

        textView.translatesAutoresizingMaskIntoConstraints = false
        textView.isEditable = false
        textView.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        textView.text = "Start the Mac probe server, then tap Run.\n"

        runButton.translatesAutoresizingMaskIntoConstraints = false
        runButton.configuration = .filled()
        runButton.configuration?.title = "Run route matrix"
        runButton.addTarget(self, action: #selector(runMatrix), for: .touchUpInside)

        view.addSubview(textView)
        view.addSubview(runButton)
        NSLayoutConstraint.activate([
            runButton.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            runButton.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
            runButton.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12),
            runButton.heightAnchor.constraint(equalToConstant: 48),
            textView.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            textView.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
            textView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            textView.bottomAnchor.constraint(equalTo: runButton.topAnchor, constant: -12),
        ])

        runner.onLine = { [weak self] line in
            DispatchQueue.main.async {
                guard let self else { return }
                self.textView.text.append(line + "\n")
                let end = NSRange(location: max(0, self.textView.text.count - 1), length: 1)
                self.textView.scrollRangeToVisible(end)
            }
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !hasRunAutomatically else { return }
        hasRunAutomatically = true
        runMatrix()
    }

    @objc private func runMatrix() {
        runButton.isEnabled = false
        textView.text.append("\n--- new run ---\n")
        runner.run { [weak self] in
            DispatchQueue.main.async {
                self?.runButton.isEnabled = true
            }
        }
    }
}

private enum RouteConstraint: String {
    case unconstrained
    case wiredEthernet
    case nonWiFi
    case other

    func apply(to parameters: NWParameters) {
        switch self {
        case .unconstrained:
            break
        case .wiredEthernet:
            parameters.requiredInterfaceType = .wiredEthernet
        case .nonWiFi:
            parameters.prohibitedInterfaceTypes = [.wifi, .cellular]
        case .other:
            parameters.requiredInterfaceType = .other
        }
    }
}

private struct ProbeCase {
    let label: String
    let host: String
    let constraint: RouteConstraint
}

final class RouteProbeRunner: @unchecked Sendable {
    var onLine: ((String) -> Void)?

    private let queue = DispatchQueue(label: "USBRouteProbe", qos: .userInitiated)
    private var activeConnection: NWConnection?
    private var activeWebSocketProbe: WebSocketProbeSession?

    private let cases = [
        ProbeCase(label: "wifi-control", host: "192.168.20.61", constraint: .unconstrained),
        ProbeCase(label: "usb-control", host: "169.254.98.101", constraint: .unconstrained),
        ProbeCase(label: "local-default", host: "forge.local", constraint: .unconstrained),
        ProbeCase(label: "local-wired", host: "forge.local", constraint: .wiredEthernet),
        ProbeCase(label: "local-nonwifi", host: "forge.local", constraint: .nonWiFi),
        ProbeCase(label: "local-other", host: "forge.local", constraint: .other),
    ]

    private let webSocketCases = [
        (label: "ws-wifi-control", host: "192.168.20.61"),
        (label: "ws-usb-control", host: "169.254.98.101"),
        (label: "ws-local-default", host: "forge.local"),
    ]

    func run(completion: @escaping () -> Void) {
        queue.async { [weak self] in
            self?.runCase(at: 0, completion: completion)
        }
    }

    private func runCase(at index: Int, completion: @escaping () -> Void) {
        guard index < cases.count else {
            runWebSocketCase(at: 0, completion: completion)
            return
        }

        let probe = cases[index]
        let tcp = NWProtocolTCP.Options()
        tcp.noDelay = true
        let parameters = NWParameters(tls: nil, tcp: tcp)
        probe.constraint.apply(to: parameters)

        guard let port = NWEndpoint.Port(rawValue: 4_331) else {
            emit("invalid port")
            completion()
            return
        }

        let connection = NWConnection(
            host: NWEndpoint.Host(probe.host),
            port: port,
            using: parameters
        )
        activeConnection = connection
        var finished = false

        func finish(_ detail: String) {
            guard !finished else { return }
            finished = true
            self.emit("\(probe.label): \(detail)")
            connection.cancel()
            if self.activeConnection === connection {
                self.activeConnection = nil
            }
            self.queue.asyncAfter(deadline: .now() + 0.25) {
                self.runCase(at: index + 1, completion: completion)
            }
        }

        connection.stateUpdateHandler = { state in
            self.queue.async {
                switch state {
                case .ready:
                    let path = connection.currentPath
                    let payload: [String: Any] = [
                        "label": probe.label,
                        "host": probe.host,
                        "constraint": probe.constraint.rawValue,
                        "localEndpoint": path?.localEndpoint.map(String.init(describing:)) ?? "missing",
                        "remoteEndpoint": path?.remoteEndpoint.map(String.init(describing:)) ?? "missing",
                        "usesWiFi": path?.usesInterfaceType(.wifi) ?? false,
                        "usesWiredEthernet": path?.usesInterfaceType(.wiredEthernet) ?? false,
                        "usesOther": path?.usesInterfaceType(.other) ?? false,
                        "availableInterfaces": path?.availableInterfaces.map {
                            [
                                "name": $0.name,
                                "index": $0.index,
                                "type": Self.interfaceTypeName($0.type),
                            ]
                        } ?? [],
                        "path": path.map(String.init(describing:)) ?? "missing",
                    ]
                    guard let data = try? JSONSerialization.data(withJSONObject: payload) else {
                        finish("ready, JSON serialization failed")
                        return
                    }
                    connection.send(content: data + Data([0x0A]), completion: .contentProcessed { error in
                        self.queue.async {
                            if let error {
                                finish("send failed: \(error)")
                            } else {
                                finish("ready \(payload["localEndpoint"]!) -> \(payload["remoteEndpoint"]!) path=\(payload["path"]!)")
                            }
                        }
                    })
                case let .waiting(error):
                    finish("waiting: \(error)")
                case let .failed(error):
                    finish("failed: \(error)")
                default:
                    break
                }
            }
        }
        connection.start(queue: queue)

        queue.asyncAfter(deadline: .now() + 4) {
            finish("timeout")
        }
    }

    private func runWebSocketCase(
        at index: Int,
        completion: @escaping () -> Void
    ) {
        guard index < webSocketCases.count else {
            emit("complete")
            completion()
            return
        }

        let probe = webSocketCases[index]
        guard let url = URL(string: "ws://\(probe.host):4332/route-probe") else {
            emit("\(probe.label): invalid URL")
            runWebSocketCase(at: index + 1, completion: completion)
            return
        }

        let session = WebSocketProbeSession(label: probe.label, url: url) {
            [weak self] detail in
            guard let self else { return }
            self.queue.async {
                self.emit("\(probe.label): \(detail)")
                self.activeWebSocketProbe = nil
                self.queue.asyncAfter(deadline: .now() + 0.25) {
                    self.runWebSocketCase(at: index + 1, completion: completion)
                }
            }
        }
        activeWebSocketProbe = session
        session.start()
    }

    private func emit(_ line: String) {
        print("USBROUTE \(line)")
        onLine?(line)
    }

    private static func interfaceTypeName(_ type: NWInterface.InterfaceType) -> String {
        switch type {
        case .wifi: return "wifi"
        case .wiredEthernet: return "wiredEthernet"
        case .cellular: return "cellular"
        case .loopback: return "loopback"
        case .other: return "other"
        @unknown default: return "unknown"
        }
    }
}

private final class WebSocketProbeSession: NSObject, URLSessionWebSocketDelegate,
    URLSessionTaskDelegate, @unchecked Sendable
{
    private let label: String
    private let url: URL
    private let completion: (String) -> Void
    private let queue = DispatchQueue(label: "USBRouteProbe.WebSocket")
    private var session: URLSession?
    private var task: URLSessionWebSocketTask?
    private var metricsSummary = "metrics=missing"
    private var finished = false

    init(label: String, url: URL, completion: @escaping (String) -> Void) {
        self.label = label
        self.url = url
        self.completion = completion
    }

    func start() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 4
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        let task = session.webSocketTask(with: url)
        self.session = session
        self.task = task
        task.resume()
        queue.asyncAfter(deadline: .now() + 5) { [weak self] in
            self?.finish("timeout")
        }
    }

    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        let payload = "{\"label\":\"\(label)\",\"url\":\"\(url.absoluteString)\"}"
        webSocketTask.send(.string(payload)) { [weak self] error in
            guard let self else { return }
            if let error {
                self.finish("send failed: \(error)")
                return
            }
            webSocketTask.cancel(with: .normalClosure, reason: nil)
        }
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didFinishCollecting metrics: URLSessionTaskMetrics
    ) {
        guard let transaction = metrics.transactionMetrics.last else { return }
        metricsSummary = [
            "local=\(transaction.localAddress ?? "missing"): \(transaction.localPort?.description ?? "missing")",
            "remote=\(transaction.remoteAddress ?? "missing"): \(transaction.remotePort?.description ?? "missing")",
            "protocol=\(transaction.networkProtocolName ?? "missing")",
            "cellular=\(transaction.isCellular)",
        ].joined(separator: " ")
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        finish(error.map { "completed with error: \($0) \(metricsSummary)" }
            ?? "completed \(metricsSummary)")
    }

    private func finish(_ detail: String) {
        queue.async { [weak self] in
            guard let self, !self.finished else { return }
            self.finished = true
            self.task?.cancel(with: .goingAway, reason: nil)
            self.session?.invalidateAndCancel()
            self.completion(detail)
        }
    }
}
