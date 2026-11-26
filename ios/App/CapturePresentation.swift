import Foundation

extension ScreenCaptureController {
    struct BenchmarkRun: Identifiable, Equatable {
        let id: String
        let startedAt: Date
        let endsAt: Date
        let durationMs: Int
        let warmupMs: Int
        let targetFps: Int
        let encoderProfile: String
        let encoderProfileActive: String?
        let encoderTuning: String
        let encoderTuningActive: String?
        let requestedShortEdge: Int
        let activeShortEdge: Int?
        let activeWidth: Int?
        let activeHeight: Int?
        let streamGeneration: Int64
        let h264PipelineEpoch: UInt64?
    }

    enum CaptureState: Equatable {
        case idle
        case choosing
        case starting
        case streaming
        case failed(String)

        var label: String {
            switch self {
            case .idle:
                return "Ready"
            case .choosing:
                return "Choose Full Display in the system sheet"
            case .starting:
                return "Starting live capture..."
            case .streaming:
                return "Streaming screen and motion"
            case let .failed(message):
                return message
            }
        }

        var isActive: Bool {
            switch self {
            case .choosing, .starting, .streaming:
                return true
            case .idle, .failed:
                return false
            }
        }

        var diagnosticValue: String {
            switch self {
            case .idle:
                return "idle"
            case .choosing:
                return "choosing"
            case .starting:
                return "starting"
            case .streaming:
                return "streaming"
            case .failed:
                return "failed"
            }
        }
    }

}
