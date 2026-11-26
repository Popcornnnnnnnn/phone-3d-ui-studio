import Foundation

enum BridgeEndpointStore {
    private static let key = "pairedBridgeEndpoint"

    static var embedded: BridgeEndpoint? {
        (Bundle.main.object(forInfoDictionaryKey: "LiveBridgeURL") as? String)
            .flatMap { try? BridgeEndpoint($0) }
    }

    static var current: BridgeEndpoint? {
        if let saved = UserDefaults.standard.string(forKey: key),
           let endpoint = try? BridgeEndpoint(saved) { return endpoint }
        return embedded
    }

    static func save(_ endpoint: BridgeEndpoint) {
        UserDefaults.standard.set(endpoint.url.absoluteString, forKey: key)
    }
}
