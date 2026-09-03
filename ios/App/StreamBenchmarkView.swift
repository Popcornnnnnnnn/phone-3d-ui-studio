import SwiftUI

struct StreamBenchmarkView: View {
    let run: ScreenCaptureController.BenchmarkRun
    let cancel: () -> Void

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60.0)) { timeline in
            let elapsed = max(0, timeline.date.timeIntervalSince(run.startedAt))
            let remaining = max(0, run.endsAt.timeIntervalSince(timeline.date))

            GeometryReader { proxy in
                Canvas(rendersAsynchronously: true) { context, size in
                    drawPattern(
                        context: &context,
                        size: size,
                        elapsed: elapsed
                    )
                }
                .overlay(alignment: .top) {
                    VStack(spacing: 8) {
                        Text("15-second stream benchmark")
                            .font(.title2.bold())
                        Text("Automatic motion · \(remaining, format: .number.precision(.fractionLength(1)))s")
                            .font(.system(.body, design: .monospaced).weight(.semibold))
                        Text("Keep the Mac receiver connected. No screen recording is saved.")
                            .font(.footnote)
                            .multilineTextAlignment(.center)
                            .foregroundStyle(.white.opacity(0.8))
                    }
                    .foregroundStyle(.white)
                    .padding(.top, max(24, proxy.safeAreaInsets.top + 8))
                    .padding(.horizontal, 24)
                }
                .overlay(alignment: .bottom) {
                    Button("Cancel benchmark", action: cancel)
                        .buttonStyle(.borderedProminent)
                        .tint(.white.opacity(0.2))
                        .foregroundStyle(.white)
                        .padding(.bottom, max(24, proxy.safeAreaInsets.bottom + 8))
                }
            }
        }
        .background(.black)
        .ignoresSafeArea()
    }

    private func drawPattern(
        context: inout GraphicsContext,
        size: CGSize,
        elapsed: TimeInterval
    ) {
        let columns = 8
        let rows = 16
        let cellWidth = size.width / CGFloat(columns)
        let cellHeight = size.height / CGFloat(rows)
        let phase = elapsed * 1.8

        context.fill(
            Path(CGRect(origin: .zero, size: size)),
            with: .color(.black)
        )

        for row in 0..<rows {
            for column in 0..<columns {
                let index = row * columns + column
                let hue = (Double(index) / Double(columns * rows) + phase * 0.08)
                    .truncatingRemainder(dividingBy: 1)
                let pulse = 0.55 + 0.35 * sin(phase * 2.4 + Double(index) * 0.31)
                let rect = CGRect(
                    x: CGFloat(column) * cellWidth,
                    y: CGFloat(row) * cellHeight,
                    width: cellWidth + 1,
                    height: cellHeight + 1
                )
                context.fill(
                    Path(rect),
                    with: .color(
                        Color(
                            hue: hue,
                            saturation: 0.82,
                            brightness: pulse
                        )
                    )
                )
            }
        }

        let sweepWidth = max(42, size.width * 0.16)
        let travel = size.width + sweepWidth * 2
        let sweepX = CGFloat((elapsed * 260).truncatingRemainder(dividingBy: travel))
            - sweepWidth
        context.fill(
            Path(
                CGRect(
                    x: sweepX,
                    y: 0,
                    width: sweepWidth,
                    height: size.height
                )
            ),
            with: .color(.white.opacity(0.5))
        )

        let bandHeight = max(30, size.height * 0.045)
        let bandTravel = size.height + bandHeight * 2
        let bandY = CGFloat((elapsed * 190).truncatingRemainder(dividingBy: bandTravel))
            - bandHeight
        context.fill(
            Path(
                CGRect(
                    x: 0,
                    y: bandY,
                    width: size.width,
                    height: bandHeight
                )
            ),
            with: .color(.black.opacity(0.6))
        )
    }
}
