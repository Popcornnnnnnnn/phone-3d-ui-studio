import ReplayKit
import SwiftUI

/// Keeps the required user gesture on ReplayKit's own button while letting the
/// surrounding SwiftUI view provide a full-width, app-styled label.
struct BroadcastPickerButton: View {
    private static let extensionBundleIdentifier =
        "com.phone3dui.studio.broadcast"

    var body: some View {
        ZStack {
            SystemBroadcastPicker(
                preferredExtension: Self.extensionBundleIdentifier
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            Label(
                "Start legacy ReplayKit sharing",
                systemImage: "dot.radiowaves.left.and.right"
            )
            .font(.headline)
            .foregroundStyle(.white)
            .allowsHitTesting(false)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 52)
        .background(Color.secondary)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityLabel("Start legacy ReplayKit screen sharing")
    }
}

private struct SystemBroadcastPicker: UIViewRepresentable {
    let preferredExtension: String

    func makeUIView(context: Context) -> FullSizeBroadcastPickerView {
        let picker = FullSizeBroadcastPickerView(frame: .zero)
        picker.preferredExtension = preferredExtension
        picker.showsMicrophoneButton = false
        // The SwiftUI label above supplies the visible affordance. The native
        // ReplayKit button remains the hit-tested control that opens the
        // system confirmation sheet.
        picker.tintColor = .clear
        picker.backgroundColor = .clear
        return picker
    }

    func updateUIView(
        _ picker: FullSizeBroadcastPickerView,
        context: Context
    ) {
        picker.preferredExtension = preferredExtension
        picker.showsMicrophoneButton = false
        picker.setNeedsLayout()
    }
}

/// RPSystemBroadcastPickerView keeps its private UIButton at the system icon's
/// intrinsic size even when SwiftUI gives the representable a full-width frame.
/// Stretch only that native control so every visible point remains a genuine
/// ReplayKit user gesture.
private final class FullSizeBroadcastPickerView: RPSystemBroadcastPickerView {
    override func layoutSubviews() {
        super.layoutSubviews()
        stretchButtons(in: self)
    }

    private func stretchButtons(in view: UIView) {
        for subview in view.subviews {
            if let button = subview as? UIButton {
                button.frame = view.bounds
                button.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            } else {
                stretchButtons(in: subview)
            }
        }
    }
}
