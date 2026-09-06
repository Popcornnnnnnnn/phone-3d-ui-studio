import SwiftUI

struct SpatialTrackingView: View {
    @ObservedObject var controller: SpatialTrackingController
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Your phone, in space").font(.title2.bold())
            Text("Move your iPhone to move its counterpart in the Web workspace.")
                .foregroundStyle(.secondary)
            Label(controller.connection, systemImage: "network")
            if controller.requested && controller.connection != "Connected" {
                Text("Keep this iPhone and your Mac on the same network, and start the local bridge on the Mac. Connection retries automatically.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Label(controller.trackingState.capitalized,
                  systemImage: controller.trackingState == "normal" ? "checkmark.circle" : "viewfinder")
                .foregroundStyle(controller.trackingState == "normal" ? .green : .secondary)
            Text(controller.guidance).font(.subheadline).fixedSize(horizontal: false, vertical: true)
            Button {
                if controller.requested { controller.stop() } else { controller.start() }
            } label: {
                Label(controller.requested ? "Stop tracking" : "Start tracking",
                      systemImage: controller.requested ? "stop.fill" : "viewfinder")
                    .frame(maxWidth: .infinity).padding(.vertical, 12)
            }
            .buttonStyle(.borderedProminent).tint(controller.requested ? .gray : .green)
            Divider()
            Text("Set your origin").font(.headline)
            Text("Hold the phone above a textured desk, screen facing up and top pointing toward the Mac. Keep the rear camera clear. In the Web workspace, click Set origin.")
                .font(.subheadline).foregroundStyle(.secondary)
            Text("The grid is a relative workspace. Its height is not a measured tabletop.")
                .font(.caption).foregroundStyle(.secondary)
            DisclosureGroup("Tracking details") {
                VStack(alignment: .leading, spacing: 8) {
                    Text(String(format: "Camera XYZ: %.3f, %.3f, %.3f m",
                                controller.cameraPosition[0], controller.cameraPosition[1], controller.cameraPosition[2]))
                    Text("Sequence: \(controller.sentFrames)")
                    Text("Only position, orientation and tracking status leave this device. Camera images are never streamed or saved.")
                }.font(.caption).padding(.top, 8)
            }
        }
        .padding(20)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 24))
    }
}
