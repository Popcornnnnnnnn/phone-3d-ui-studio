import Foundation
import Darwin

/// The pairing payload selects only the bridge origin. Socket roles and session
/// identifiers are assigned by this app, never accepted from a QR code.
struct BridgeEndpoint: Equatable {
    let url: URL

    init(_ input: String) throws {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.count <= 2_048,
              var parts = URLComponents(string: value),
              let scheme = parts.scheme?.lowercased(),
              ["ws", "wss"].contains(scheme),
              let host = parts.host, Self.validHost(host),
              let port = parts.port, (1...65_535).contains(port),
              parts.user == nil, parts.password == nil,
              parts.fragment == nil,
              parts.percentEncodedPath.isEmpty || parts.percentEncodedPath == "/"
        else { throw PairingError.invalidEndpoint }

        if let items = parts.queryItems {
            // Accept the old build-time setting only, then discard its role.
            guard items.count == 1, items[0].name == "role",
                  ["phone", "phone-pose", "phone-spatial", "phone-webrtc"].contains(items[0].value ?? "")
            else { throw PairingError.invalidEndpoint }
        }
        parts.scheme = scheme
        parts.host = host.lowercased()
        parts.path = "/"
        parts.query = nil
        guard let url = parts.url else { throw PairingError.invalidEndpoint }
        self.url = url
    }

    private static func validHost(_ host: String) -> Bool {
        if host.hasPrefix("["), host.hasSuffix("]") {
            var address = in6_addr()
            return String(host.dropFirst().dropLast()).withCString {
                inet_pton(AF_INET6, $0, &address) == 1
            }
        }
        let name = host.hasSuffix(".") ? String(host.dropLast()) : host
        guard !name.isEmpty, name.utf8.count <= 253 else { return false }
        if name.allSatisfy({ $0.isNumber || $0 == "." }) {
            var address = in_addr()
            return name.withCString { inet_pton(AF_INET, $0, &address) == 1 }
        }
        let letters = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
        let labelCharacters = letters.union(CharacterSet(charactersIn: "-"))
        return name.split(separator: ".", omittingEmptySubsequences: false).allSatisfy { label in
            let scalars = label.unicodeScalars
            guard !scalars.isEmpty, scalars.count <= 63,
                  let first = scalars.first, let last = scalars.last,
                  letters.contains(first), letters.contains(last) else { return false }
            return scalars.allSatisfy { labelCharacters.contains($0) }
        }
    }

    static func pairingLink(_ value: String) throws -> BridgeEndpoint {
        guard let parts = URLComponents(string: value),
              parts.scheme?.lowercased() == "phone3dstudio",
              parts.host?.lowercased() == "pair",
              parts.user == nil, parts.password == nil, parts.port == nil,
              parts.path.isEmpty, parts.fragment == nil,
              let items = parts.queryItems, items.count == 1,
              items[0].name == "bridge", let endpoint = items[0].value
        else { throw PairingError.invalidLink }
        return try BridgeEndpoint(endpoint)
    }

    func socketURL(role: String, extra: [URLQueryItem] = []) -> URL {
        var parts = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        parts.queryItems = [URLQueryItem(name: "role", value: role)] + extra
        return parts.url!
    }
}

enum PairingError: LocalizedError {
    case invalidEndpoint
    case invalidLink

    var errorDescription: String? {
        switch self {
        case .invalidEndpoint:
            return "Enter the Mac address shown in Phone 3D Studio, such as ws://192.168.1.10:4319/. Use ws or wss, a host and a port, without a username, password or extra path."
        case .invalidLink:
            return "This is not a Phone 3D Studio pairing code. Scan the code shown in the Mac app."
        }
    }
}
