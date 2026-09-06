// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "Phone3DClockSync",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "Phone3DClockSync", targets: ["Phone3DClockSync"]),
    ],
    targets: [
        .target(
            name: "Phone3DClockSync",
            path: "Shared",
            exclude: [
                "H264Encoder.swift",
                "LiveSocket.swift",
                "MotionStreamer.swift",
            ],
            sources: ["FrameRateGate.swift", "LiveProtocol.swift", "SpatialProtocol.swift", "WorldProtocol.swift"]
        ),
        .testTarget(
            name: "Phone3DClockSyncTests",
            dependencies: ["Phone3DClockSync"],
            path: "Tests"
        ),
    ]
)
