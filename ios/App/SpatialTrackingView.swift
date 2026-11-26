import SwiftUI

struct SpatialTrackingView: View {
    @ObservedObject var controller: SpatialTrackingController

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            StudioPageHeading(title: "Spatial tracking",
                subtitle: "Tracking powers Marble and Tracking on your Mac.")

            VStack(alignment: .leading, spacing: 18) {
                StudioStatus(title: statusTitle,
                    color: controller.requested && controller.connection == "Connected" && controller.running && controller.trackingState == "normal" ? StudioColors.accent : .secondary)
                Text(nextStep)
                    .font(.subheadline).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if controller.requested {
                    StudioValueRow(title: "Mac", value: controller.connection)
                }
                Button {
                    if controller.requested { controller.stop() } else { controller.start() }
                } label: {
                    StudioActionLabel(controller.requested ? "Stop tracking" : "Start tracking",
                        systemImage: controller.requested ? "stop.fill" : "play.fill")
                }
                .buttonStyle(StudioActionStyle(prominent: !controller.requested))
            }.studioCard()

            VStack(alignment: .leading, spacing: 18) {
                Text("Get into position").font(.subheadline.weight(.semibold))
                StudioInstruction(number: "1", title: "Hold your phone flat",
                    detail: "Screen up, top toward your Mac. Keep the rear camera above a textured surface.")
                StudioInstruction(number: "2", title: "Start on your Mac",
                    detail: "In Marble, choose Start round. In Tracking, choose Set origin.")
            }.studioCard()

            DisclosureGroup {
                VStack(alignment: .leading, spacing: 14) {
                    StudioValueRow(title: "Tracking", value: controller.trackingState.capitalized)
                    StudioValueRow(title: "Position", value: String(format: "%.3f, %.3f, %.3f m",
                        controller.cameraPosition[0], controller.cameraPosition[1], controller.cameraPosition[2]))
                    StudioValueRow(title: "Frames sent", value: "\(controller.sentFrames)")
                    Text("The grid is a relative workspace. Its height is not a measured tabletop.")
                        .font(.footnote).foregroundStyle(.secondary)
                }.padding(.top, 16)
            } label: { Text("Tracking details").font(.subheadline.weight(.semibold)).foregroundStyle(.primary) }
                .tint(.secondary)
            Text("Only motion and tracking status are sent to your Mac. Camera images stay on this iPhone.")
                .font(.footnote).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var statusTitle: String {
        guard BridgeEndpointStore.current != nil else { return "Pair with Mac" }
        guard controller.requested else { return "Ready to connect" }
        guard controller.connection == "Connected" else {
            return controller.connection == "Connecting" ? "Connecting to Mac" : "Waiting for Mac"
        }
        if controller.trackingState == "normal" && controller.running { return "Tracking ready" }
        return controller.trackingState == "paused" ? "Tracking paused" : "Tracking not ready"
    }

    private var nextStep: String {
        guard BridgeEndpointStore.current != nil else { return "On your Mac, click Connect iPhone. Scan the code here, then tap Start tracking." }
        guard controller.requested else { return "Tap Start tracking. This saved address has not connected yet." }
        guard controller.connection == "Connected" else {
            if ["denied", "unsupported", "error"].contains(controller.trackingState) { return controller.guidance }
            return "Keep both devices on the same Wi-Fi. If the Mac address changed, scan its current code."
        }
        guard controller.trackingState == "normal" && controller.running else { return controller.guidance + " When tracking recovers, set a new origin or start a new round on your Mac." }
        return "Tracking is ready. On your Mac, choose Start round in Marble or Set origin in Tracking."
    }
}
