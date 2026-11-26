import SwiftUI
import UIKit

struct MarbleView: View {
    @ObservedObject var controller: SpatialTrackingController
    private let background = Color(red: 17/255, green: 25/255, blue: 35/255)
    private var guidance: String {
        guard controller.marbleBuffer.needsRestart || controller.marbleStatus == "Paused" else { return controller.marbleGuidance }
        return controller.connection == "Connected" && controller.trackingState == "normal"
            ? "Tracking ready again. Start a new round on your Mac to recalibrate and clear the old balls."
            : "Restore tracking, then start a new round on your Mac. This recalibrates and clears the old balls."
    }
    var body: some View {
        ZStack {
            background.ignoresSafeArea()
            TimelineView(.animation(minimumInterval: 1.0 / 60)) { timeline in
                let state = controller.marbleFrame(at: timeline.date)
                Canvas { context, size in
                    let bounds = CGRect(origin: .zero, size: size)
                    context.fill(Path(bounds), with: .linearGradient(Gradient(colors: [
                        Color(red: 41/255, green: 55/255, blue: 65/255),
                        Color(red: 27/255, green: 41/255, blue: 51/255), background
                    ]), startPoint: .zero, endPoint: CGPoint(x: size.width, y: size.height)))
                    context.fill(Path(bounds), with: .radialGradient(Gradient(colors: [
                        Color(red: 96/255, green: 130/255, blue: 137/255).opacity(0.24), .clear
                    ]), center: CGPoint(x: size.width / 2, y: size.height / 2), startRadius: 0, endRadius: size.height * 0.55))
                    let ringSize = size.width * 0.66
                    let ring = Path(ellipseIn: CGRect(x: (size.width - ringSize) / 2, y: (size.height - ringSize) / 2, width: ringSize, height: ringSize))
                    context.stroke(ring, with: .color(Color(red: 182/255, green: 211/255, blue: 209/255).opacity(0.32)), style: StrokeStyle(lineWidth: 1.5, dash: [4, 8]))
                    var exitGuide = Path()
                    exitGuide.move(to: CGPoint(x: size.width * 0.6, y: size.height / 2))
                    exitGuide.addLine(to: CGPoint(x: size.width - 5, y: size.height / 2))
                    context.stroke(exitGuide, with: .color(Color(red: 182/255, green: 211/255, blue: 209/255).opacity(0.32)), style: StrokeStyle(lineWidth: 1.5, dash: [4, 8]))
                    guard let state else { return }
                    let g = state.geometry, scale = size.width / g.width
                    let gap = g.exitHalfWidth / g.height * size.height
                    context.clip(to: Path(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: g.cornerRadius * scale))
                    var rails = Path()
                    rails.move(to: CGPoint(x: size.width - 5, y: size.height / 2 - gap))
                    rails.addLines([CGPoint(x: size.width - 5, y: 5), CGPoint(x: 5, y: 5), CGPoint(x: 5, y: size.height - 5), CGPoint(x: size.width - 5, y: size.height - 5), CGPoint(x: size.width - 5, y: size.height / 2 + gap)])
                    context.stroke(rails, with: .color(Color(red: 171/255, green: 209/255, blue: 208/255).opacity(0.62)), lineWidth: 2)
                    context.draw(Text("→").font(.system(size: 13, weight: .semibold)).foregroundColor(Color(red: 169/255, green: 213/255, blue: 210/255)), at: CGPoint(x: size.width - 20, y: size.height / 2))
                    guard let phone = state.phone, let ball = state.activeBall else { return }
                    let p = WorldMath.projection(ball, phone, g), r = p.radius * scale
                    guard r > 0 else { return }
                    let center = CGPoint(x: p.u * size.width, y: p.v * size.height), full = ball.radius * scale
                    let shape = Path(ellipseIn: CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2))
                    context.clip(to: shape)
                    context.fill(shape, with: .radialGradient(Gradient(stops: [
                        .init(color: Color(red: 213/255, green: 255/255, blue: 192/255), location: 0),
                        .init(color: Color(red: 164/255, green: 223/255, blue: 131/255), location: 0.45),
                        .init(color: Color(red: 67/255, green: 140/255, blue: 98/255), location: 1)]),
                        center: CGPoint(x: center.x - full * 0.3, y: center.y - full * 0.35), startRadius: full * 0.05, endRadius: full))
                    if p.marker.z > 0 {
                        let mr = full * 0.13, mh = mr * max(0.12, p.marker.z)
                        let marker = Path(ellipseIn: CGRect(x: center.x + p.marker.x * full * 0.95 - mr,
                            y: center.y - p.marker.y * full * 0.95 - mh, width: mr * 2, height: mh * 2))
                        context.fill(marker, with: .color(Color(red: 38/255, green: 75/255, blue: 57/255)))
                    }
                }
            }.ignoresSafeArea()
            VStack {
                HStack {
                    Text(controller.marbleBuffer.needsRestart ? "Paused" : controller.marbleStatus).font(.caption.weight(.medium)).lineLimit(1)
                    Text("\(controller.marbleContacts) contacts").font(.caption2).opacity(0.7)
                    Spacer()
                    Button("Exit") { controller.exitMarble() }
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 16).frame(minHeight: 44)
                        .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                        .fixedSize(horizontal: true, vertical: false)
                        .accessibilityLabel("Exit Marble")
                }.padding(.horizontal, 24).padding(.top, 8)
                Spacer()
                VStack(spacing: 12) {
                    if controller.marbleNeedsBall {
                        Button("Add ball") { controller.addMarble() }
                            .font(.headline).padding(.horizontal, 30).padding(.vertical, 12)
                            .background(Color(red: 154/255, green: 228/255, blue: 193/255), in: RoundedRectangle(cornerRadius: 12))
                            .foregroundStyle(background)
                            .disabled(!controller.marbleCanAddBall)
                            .opacity(controller.marbleCanAddBall ? 1 : 0.45)
                    }
                    Text(guidance).font(.caption).multilineTextAlignment(.center)
                    Text("S2.1 · slow demo · 1.5 m/s²").font(.system(size: 10))
                }.padding(.horizontal, 25).padding(.bottom, 16)
            }.foregroundStyle(Color(red: 154/255, green: 228/255, blue: 193/255))
        }
    }
}

final class MarblePortraitController: UIHostingController<MarbleView> {
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }
    override var preferredInterfaceOrientationForPresentation: UIInterfaceOrientation { .portrait }
    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        setNeedsUpdateOfSupportedInterfaceOrientations()
        view.window?.windowScene?.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait))
    }
    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        presentingViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
    }
}
struct MarblePortraitHost: UIViewControllerRepresentable {
    let controller: SpatialTrackingController
    func makeUIViewController(context: Context) -> MarblePortraitController { MarblePortraitController(rootView: MarbleView(controller: controller)) }
    func updateUIViewController(_ uiViewController: MarblePortraitController, context: Context) {}
}
