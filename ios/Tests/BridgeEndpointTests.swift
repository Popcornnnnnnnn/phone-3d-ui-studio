import XCTest
@testable import Phone3DClockSync

final class BridgeEndpointTests: XCTestCase {
    func testNormalizesMacAddressesAndRemovesLegacyRole() throws {
        XCTAssertEqual(try BridgeEndpoint(" ws://Mac.local:4319?role=phone\n").url.absoluteString,
                       "ws://mac.local:4319/")
        XCTAssertEqual(try BridgeEndpoint("wss://192.168.1.20:443/").url.absoluteString,
                       "wss://192.168.1.20:443/")
        XCTAssertEqual(try BridgeEndpoint("ws://[::1]:4319/").url.absoluteString,
                       "ws://[::1]:4319/")
    }

    func testRejectsIncompleteAndAmbiguousEndpoints() {
        for value in ["", "mac.local:4319", "http://mac.local:4319/", "ws://mac.local/",
                      "ws://mac.local:0/", "ws://mac.local:65536/", "ws://mac.local:abc/",
                      "ws://999.1.1.1:4319/", "ws://not!a-host:4319/", "ws://-mac.local:4319/",
                      "ws://mac..local:4319/", "ws://[invalid]:4319/", "ws://mac.local%20:4319/",
                      "ws://:4319/", "ws://mac local:4319/", "ws://user@mac.local:4319/",
                      "ws://user:password@mac.local:4319/", "ws://mac.local:4319/other",
                      "ws://mac.local:4319/%2f", "ws://mac.local:4319/#fragment",
                      "ws://mac.local:4319/?token=secret", "ws://mac.local:4319/?role=viewer",
                      "ws://mac.local:4319/?role=phone&role=phone-spatial", "ws://mac.local:4319/?"] {
            XCTAssertThrowsError(try BridgeEndpoint(value), value)
        }
    }

    func testDecodesMacPairingLinkOnceAndPreservesItsPort() throws {
        let endpoint = try BridgeEndpoint.pairingLink(
            "phone3dstudio://pair?bridge=ws%3A%2F%2F192.168.1.10%3A4321%2F")
        XCTAssertEqual(endpoint.url.absoluteString, "ws://192.168.1.10:4321/")
        let socket = endpoint.socketURL(role: "phone-spatial", extra: [
            URLQueryItem(name: "sessionId", value: "session-one"),
            URLQueryItem(name: "deviceModel", value: "iPhone17,3")
        ])
        let parts = try XCTUnwrap(URLComponents(url: socket, resolvingAgainstBaseURL: false))
        XCTAssertEqual(parts.queryItems?.first?.value, "phone-spatial")
        XCTAssertEqual(parts.queryItems?.last?.value, "iPhone17,3")
        XCTAssertEqual(parts.port, 4321)
    }

    func testRejectsUnrelatedOrModifiedPairingLinks() {
        for value in ["https://example.com", "phone3dstudio://other?bridge=ws://mac.local:4319/",
                      "phone3dstudio://pair/path?bridge=ws://mac.local:4319/",
                      "phone3dstudio://pair?bridge=ws://mac.local:4319/&other=yes",
                      "phone3dstudio://pair?bridge=ws://mac.local:4319/&bridge=ws://other:4319/",
                      "phone3dstudio://pair?bridge=ws://mac.local:4319/#fragment",
                      "phone3dstudio://pair?bridge=ws%253A%252F%252Fmac.local%253A4319%252F",
                      "phone3dstudio://user@pair?bridge=ws://mac.local:4319/"] {
            XCTAssertThrowsError(try BridgeEndpoint.pairingLink(value), value)
        }
    }
}
