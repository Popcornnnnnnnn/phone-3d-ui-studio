import Foundation
import WebRTC

/// Sends ScreenCaptureKit frames over a native WebRTC video track. WebSocket
/// remains signaling-only; RTP media travels directly between iPhone and Mac.
final class WebRTCStreamer: NSObject {
    enum State: String {
        case idle
        case signaling
        case connecting
        case connected
        case failed
    }

    var onStateChange: ((State) -> Void)?

    private static let factory: RTCPeerConnectionFactory = {
        RTCInitializeSSL()
        let encoderFactory = RTCDefaultVideoEncoderFactory()
        return RTCPeerConnectionFactory(
            encoderFactory: encoderFactory,
            decoderFactory: RTCDefaultVideoDecoderFactory()
        )
    }()

    private let signalingSocket = LiveSocket()
    private let videoSource: RTCVideoSource
    private let capturer: RTCVideoCapturer
    private let videoTrack: RTCVideoTrack
    private var peerConnection: RTCPeerConnection?
    private var pendingRemoteCandidates: [RTCIceCandidate] = []
    private var hasRemoteDescription = false
    private var h264PreferenceApplied = false
    private var h264PreferenceCodecCount = 0
    private var h264PreferenceError: String?
    private(set) var state: State = .idle {
        didSet {
            guard state != oldValue else { return }
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.onStateChange?(self.state)
            }
        }
    }

    override init() {
        let source = Self.factory.videoSource(forScreenCast: true)
        source.adaptOutputFormat(toWidth: 960, height: 2_088, fps: 30)
        videoSource = source
        capturer = RTCVideoCapturer(delegate: source)
        videoTrack = Self.factory.videoTrack(with: source, trackId: "iphone-screen")
        super.init()

        signalingSocket.onStateChange = { [weak self] socketState in
            guard let self else { return }
            switch socketState {
            case .connecting:
                self.state = .signaling
            case .connected:
                self.state = .connecting
            case .failed:
                self.state = .failed
            case .idle:
                if self.state != .failed { self.state = .idle }
            }
        }
        signalingSocket.onTextMessage = { [weak self] text in
            self?.handleSignalingMessage(text)
        }
    }

    func connect(to signalingURL: URL) {
        disconnect()
        guard replacePeerConnection() != nil else {
            state = .failed
            return
        }
        signalingSocket.connect(to: signalingURL)
    }

    @discardableResult
    private func replacePeerConnection() -> RTCPeerConnection? {
        let previousPeer = peerConnection
        peerConnection = nil
        previousPeer?.close()
        pendingRemoteCandidates.removeAll(keepingCapacity: true)
        hasRemoteDescription = false
        let configuration = RTCConfiguration()
        configuration.sdpSemantics = .unifiedPlan
        configuration.continualGatheringPolicy = .gatherContinually
        configuration.iceTransportPolicy = .all
        configuration.iceServers = []
        configuration.enableDscp = true

        let constraints = RTCMediaConstraints(
            mandatoryConstraints: nil,
            optionalConstraints: ["DtlsSrtpKeyAgreement": "true"]
        )
        guard let peerConnection = Self.factory.peerConnection(
            with: configuration,
            constraints: constraints,
            delegate: self
        ) else {
            return nil
        }
        self.peerConnection = peerConnection
        if let sender = peerConnection.add(
            videoTrack,
            streamIds: ["iphone-screen"]
        ) {
            let parameters = sender.parameters
            for encoding in parameters.encodings {
                encoding.minBitrateBps = 1_500_000
                // Keep the full 960 x 2088 surface, but avoid the 7–8 Mbps
                // bursts that caused retransmissions and a growing receiver
                // jitter target on the local Wi-Fi path.
                encoding.maxBitrateBps = 6_000_000
                encoding.maxFramerate = 30
                encoding.bitratePriority = 2
                encoding.networkPriority = .high
            }
            parameters.degradationPreference = NSNumber(
                value: RTCDegradationPreference.maintainFramerate.rawValue
            )
            sender.parameters = parameters
        }
        // WebRTC 152's forced H.264/VideoToolbox path negotiates successfully
        // on iOS 27 beta but silently emits zero encoded frames. Leave codec
        // selection at the proven default (VP8) until that native path can be
        // validated independently; a working software path is preferable to
        // an apparently connected black screen.
        h264PreferenceApplied = false
        h264PreferenceCodecCount = 0
        h264PreferenceError = nil
        _ = peerConnection.setBweMinBitrateBps(
            1_500_000,
            currentBitrateBps: 4_000_000,
            maxBitrateBps: 6_000_000
        )
        return peerConnection
    }

    func disconnect() {
        signalingSocket.disconnect()
        peerConnection?.close()
        peerConnection = nil
        pendingRemoteCandidates.removeAll(keepingCapacity: true)
        hasRemoteDescription = false
        state = .idle
    }

    func push(pixelBuffer: CVPixelBuffer, timestamp: CMTime) {
        guard peerConnection != nil else { return }
        let timestampNs: Int64
        if timestamp.isValid {
            timestampNs = Int64((CMTimeGetSeconds(timestamp) * 1_000_000_000).rounded())
        } else {
            timestampNs = Int64(ProcessInfo.processInfo.systemUptime * 1_000_000_000)
        }
        let frame = RTCVideoFrame(
            buffer: RTCCVPixelBuffer(pixelBuffer: pixelBuffer),
            rotation: ._0,
            timeStampNs: timestampNs
        )
        videoSource.capturer(capturer, didCapture: frame)
    }

    func readOutboundDiagnostics(
        completion: @escaping ([String: Any]) -> Void
    ) {
        guard let peerConnection else {
            completion([:])
            return
        }

        peerConnection.statistics { report in
            let selectedKeys = [
                "bytesSent",
                "encoderImplementation",
                "firCount",
                "framesEncoded",
                "framesPerSecond",
                "framesSent",
                "hugeFramesSent",
                "keyFramesEncoded",
                "nackCount",
                "packetsSent",
                "pliCount",
                "qpSum",
                "qualityLimitationReason",
                "qualityLimitationResolutionChanges",
                "retransmittedBytesSent",
                "retransmittedPacketsSent",
                "totalEncodeTime",
                "totalEncodedBytesTarget"
            ]
            var diagnostics: [String: Any] = [:]
            diagnostics["h264PreferenceApplied"] = self.h264PreferenceApplied
            diagnostics["h264PreferenceCodecCount"] = self.h264PreferenceCodecCount
            if let h264PreferenceError = self.h264PreferenceError {
                diagnostics["h264PreferenceError"] = h264PreferenceError
            }

            for statistic in report.statistics.values
            where statistic.type == "outbound-rtp" {
                let kind = statistic.values["kind"] as? String
                    ?? statistic.values["mediaType"] as? String
                guard kind == "video" else { continue }

                for key in selectedKeys {
                    if let value = statistic.values[key] {
                        diagnostics[key] = value
                    }
                }
                break
            }
            completion(diagnostics)
        }
    }

    private func handleSignalingMessage(_ text: String) {
        guard
            let data = text.data(using: .utf8),
            let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let type = message["type"] as? String
        else { return }

        switch type {
        case "webrtc-offer":
            guard let sdp = message["sdp"] as? String else { return }
            acceptOffer(sdp)
        case "webrtc-candidate":
            guard
                let sdp = message["candidate"] as? String,
                let lineIndex = message["sdpMLineIndex"] as? Int
            else { return }
            let candidate = RTCIceCandidate(
                sdp: sdp,
                sdpMLineIndex: Int32(lineIndex),
                sdpMid: message["sdpMid"] as? String
            )
            if hasRemoteDescription {
                peerConnection?.add(candidate) { _ in }
            } else {
                pendingRemoteCandidates.append(candidate)
            }
        default:
            break
        }
    }

    private func acceptOffer(_ sdp: String) {
        // A browser refresh creates a brand-new DTLS/ICE identity. Reusing the
        // old native peer can leave the phone "connected" to the dead tab, so
        // replace it whenever a negotiated peer receives a fresh offer.
        let peerConnection: RTCPeerConnection?
        if self.peerConnection?.remoteDescription != nil {
            peerConnection = replacePeerConnection()
        } else {
            peerConnection = self.peerConnection
        }
        guard let peerConnection else {
            state = .failed
            return
        }
        let offer = RTCSessionDescription(type: .offer, sdp: sdp)
        peerConnection.setRemoteDescription(offer) { [weak self] error in
            guard let self else { return }
            guard error == nil else {
                self.state = .failed
                return
            }
            self.hasRemoteDescription = true
            for candidate in self.pendingRemoteCandidates {
                peerConnection.add(candidate) { _ in }
            }
            self.pendingRemoteCandidates.removeAll(keepingCapacity: true)

            let constraints = RTCMediaConstraints(
                mandatoryConstraints: [
                    "OfferToReceiveAudio": "false",
                    "OfferToReceiveVideo": "false"
                ],
                optionalConstraints: nil
            )
            peerConnection.answer(for: constraints) { [weak self] answer, error in
                guard let self, let answer, error == nil else {
                    self?.state = .failed
                    return
                }
                peerConnection.setLocalDescription(answer) { [weak self] error in
                    guard let self else { return }
                    guard error == nil else {
                        self.state = .failed
                        return
                    }
                    self.sendJSON([
                        "type": "webrtc-answer",
                        "sdp": answer.sdp
                    ])
                }
            }
        }
    }

    private func sendJSON(_ object: [String: Any]) {
        guard
            let data = try? JSONSerialization.data(withJSONObject: object),
            let json = String(data: data, encoding: .utf8)
        else { return }
        signalingSocket.sendControl(text: json)
    }
}

extension WebRTCStreamer: RTCPeerConnectionDelegate {
    func peerConnection(
        _ peerConnection: RTCPeerConnection,
        didChange stateChanged: RTCSignalingState
    ) {}

    func peerConnection(
        _ peerConnection: RTCPeerConnection,
        didAdd stream: RTCMediaStream
    ) {}

    func peerConnection(
        _ peerConnection: RTCPeerConnection,
        didRemove stream: RTCMediaStream
    ) {}

    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}

    func peerConnection(
        _ peerConnection: RTCPeerConnection,
        didChange newState: RTCIceConnectionState
    ) {
        guard self.peerConnection === peerConnection else { return }
        switch newState {
        case .connected, .completed:
            state = .connected
        case .failed, .closed:
            state = .failed
        case .checking:
            state = .connecting
        default:
            break
        }
    }

    func peerConnection(
        _ peerConnection: RTCPeerConnection,
        didChange newState: RTCIceGatheringState
    ) {}

    func peerConnection(
        _ peerConnection: RTCPeerConnection,
        didGenerate candidate: RTCIceCandidate
    ) {
        guard self.peerConnection === peerConnection else { return }
        sendJSON([
            "type": "webrtc-candidate",
            "candidate": candidate.sdp,
            "sdpMid": candidate.sdpMid ?? NSNull(),
            "sdpMLineIndex": Int(candidate.sdpMLineIndex)
        ])
    }

    func peerConnection(
        _ peerConnection: RTCPeerConnection,
        didRemove candidates: [RTCIceCandidate]
    ) {}

    func peerConnection(
        _ peerConnection: RTCPeerConnection,
        didOpen dataChannel: RTCDataChannel
    ) {}
}
