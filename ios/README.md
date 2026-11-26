# iPhone input modes

For a fresh installation, use [the current setup guide](../docs/QUICKSTART.zh-CN.md). Live tracking and screen sharing require Xcode 27, an iOS 27 physical device and your own signing team. The app can scan the Mac app's QR code or save a runtime address in **Mac connection**; changing the embedded hostname is optional. There is no public TestFlight installation. Historical candidate notes below describe earlier runs, not the installation state of a new clone. See [Mac pairing](../docs/MAC_APP.zh-CN.md).

The app opens in **Tracking** without starting the camera. Tap **Start tracking**, allow Camera, hold the phone over a textured surface, and wait for the Mac connection and normal tracking. On Mac, choose **Start round** in Marble or **Set origin** in Tracking. Camera images remain on the device. Saving a Mac address alone does not establish a connection.

**Screen mirroring** keeps the previous live-screen workflow below. Switching modes stops the previous controller first; switching into screen mirroring does not automatically start sharing. Spatial tracking pauses in the background and requires recalibration after returning.

For the current one-ball toss/catch experience and wireless checklist, see [S2.1 Elastic Tray](../docs/ELASTIC_TRAY.md).

See [S1 setup and acceptance](../docs/SPATIAL_S1.md) for metric workspace calibration and limits.

# iPhone live input

### Color-metadata candidate (2026-09-06)

The encoder now forwards explicit source pixel-buffer color primaries, transfer
function and YCbCr matrix into the compression session. Color-tag changes are a
session/keyframe boundary; absent tags are not replaced with guessed defaults.
Actual Annex-B metadata and picture effect must be verified after device
installation, not inferred from property status alone. Current source and the
saved candidate include this repair and incremental trace v2; the connected
phone is still on the prior stable build. Evidence and install gate:
`experiments/live-screen-latency/QUALITY_FINDINGS.md` (repository root).

The bounded Mac color control is `node scripts/quality-probe.mjs --color NEW_DIR`
from the repository root. `scripts/color-metadata-selfcheck.swift` compiles with
`ios/Shared/H264Encoder.swift` and `ios/Shared/LiveProtocol.swift` to exercise
tag/session transitions. These are diagnostics, not physical quality or timing
acceptance.

This local prototype streams two inputs from an iPhone to the Mac bridge:

- ScreenCaptureKit full-display video encoded as low-delay H.264. The measured
  production configuration targets 60 fps at a 960-pixel short edge and uses
  the legacy VideoToolbox profile with speed-priority tuning.
- Core Motion attitude quaternions and rotation rate at 60 Hz. Ultra mode asks
  Core Motion for 200 Hz; iOS clamps that request to the device ceiling and the
  web UI reports the measured callback rate.

Both remain in memory and are sent to the configured local WebSocket. The app
does not save a screen recording.

## Generate and build

```sh
cd ios
xcodegen generate
DEVELOPER_DIR=/Applications/Xcode-27-beta.app/Contents/Developer xcodebuild -project Phone3DUIStudio.xcodeproj \
  -scheme Phone3DUIStudio \
  -sdk iphoneos \
  CODE_SIGNING_ALLOWED=NO \
  build
```

ScreenCaptureKit is present in the iOS 27 device SDK but not the simulator SDK.
The app now also builds for Simulator to review the same SwiftUI interface.
The simulator controller explicitly reports screen sharing as unavailable; it
never simulates a live connection. AR tracking, QR camera input and real capture
still require an iPhone.

For UI validation on an already booted simulator:

```sh
DEVELOPER_DIR=/Applications/Xcode-27-beta.app/Contents/Developer xcodebuild test \
  -project Phone3DUIStudio.xcodeproj -scheme Phone3DUIStudio \
  -destination 'platform=iOS Simulator,id=SIMULATOR_UDID' \
  -derivedDataPath build/SimulatorUI CODE_SIGNING_ALLOWED=NO
```

The UI smoke test exercises connection disclosure, address validation, mode
switching, and light/dark appearance, and saves screenshot attachments. It
cancels address changes and restores System appearance. `simslim` can manage
these simulators; it is an optional local tool, not an app dependency.

The phone interface uses **Tracking** and **Screen mirroring**, a collapsible
**Mac connection** card, and an appearance control in the navigation bar.
**Start tracking** works with both Marble and Tracking on the Mac. Screen
mirroring uses **Start sharing**, followed by **Full Display** in the system UI.

## Run on a physical iPhone

1. Connect the iPhone by USB for installation if needed. The app uses
   `forge.local` for discovery. The experimental video transport now defaults
   to **Wi-Fi only**, even with USB attached; wired-preferred is an explicit
   diagnostic control. The separate pose socket still follows system routing,
   so unplug USB for a pure wireless video-and-pose comparison.
2. Update `LiveBridgeURL` in the app target in `project.yml` only if the Mac's
   local hostname is not `forge.local`, then regenerate.
3. Open the generated project in Xcode 27. Select your Team for the app target;
   change the bundle identifier if Xcode asks.
4. Run the app on the iPhone and accept Local Network and Motion permissions.
5. Start the bridge, open the Mac web app, and select **Live iPhone**.
6. On iPhone tap **Start sharing**, then choose **Full Display** in the
   system sheet. Keep the companion app in the foreground for a controlled
   latency benchmark.

ScreenCaptureKit in the app is the measured low-latency path. The unsupported
ReplayKit broadcast extension has been removed from the iOS 27 target.

## Transport and benchmark controls

- Pose/control: WebSocket on port `4319`.
- H.264 frames: raw TCP with `TCP_NODELAY` and a bounded **two-frame ACK
  window** on port `4320`. Independent exact-frame ACK accounting is retained;
  admission stops at 512 KiB outstanding or 100 ms oldest-frame age. Windows
  1 and 3 remain diagnostic controls, not automatic adaptation.
- Browser decoder default: software WebCodecs with Annex-B input. Hardware
  acceleration remains diagnostic-only because it has failed to render valid
  frames on tested Chromium builds.
- Renderer default: display-matched DPR (1–2), MSAA enabled, shadows disabled,
  and phase-aware scheduling at 120 Hz. Append `?renderDpr=1` to reproduce the
  previous low-resolution baseline, `?render=quality` to additionally enable
  shadows, or `?renderSchedule=vsync` for the native R3F control. The recorded
  USB latency results used DPR 1; they do not establish the new DPR 2 timing.

Run the current three-way encoder control matrix:

```sh
npm run benchmark:sweep
```

Run three repetitions of the measured production candidate:

```sh
BENCHMARK_OUTPUT_PATH=/tmp/phone3d-production.json npm run benchmark:sweep -- \
  60:legacy:speed-priority:software:960 \
  60:legacy:speed-priority:software:960 \
  60:legacy:speed-priority:software:960
```

The iPhone benchmark stimulus uses a `CADisplayLink` with an explicit target
range. This prevents SwiftUI's adaptive animation cadence from silently turning
a requested 60 fps run into a 30 fps source run during sustained testing.

The wireless runner also requires foreground/visible stimulus telemetry with
the active benchmark ID. Backgrounding the app cancels the benchmark, not
screen sharing. Use one visible regular Chrome receiver in FRONT view:

```sh
node scripts/wireless-window-sweep.mjs captures/wireless-new-run 2
```

Each configuration has a two-second warmup and ten-second measurement by
default. `WIRELESS_DURATION_MS=60000` selects a bounded 60-second short stability
check; it does not constitute the planned 30-minute sustained acceptance.

Transport timing uses a bounded metadata-only phone ring and a separate
loopback-only `GET /transport/trace?after=CURSOR` endpoint. The runner saves
trace samples, failures, and phase summaries alongside each accepted or failed
run. Trace summaries include preparation and a bounded post-run drain; they
are not the benchmark's measured FPS window. Same-host intervals are monotonic.
Forward/return estimates are gated on clock quality and include network-stack
and scheduling delays; neither these estimates nor CPU render submission
measure visible photon latency. A bridge ACK-issued record does not prove
that the ACK reached the phone.

The v2 diagnostic candidate exports only unacknowledged record revisions and
accepts delivery ACKs tied to the producer and export generation. Idle batches
become empty after confirmation; reconnect replays retained evidence and bounded
offline loss is reported explicitly. This reduces repeated diagnostic traffic,
not video resolution. Late record updates are deduplicated in summaries. Run
`node scripts/transport-trace-selfcheck.mjs` for isolated loopback integration;
physical v1/v2 performance comparison is a separate gate. See the wireless plan
for the actual installed version (the v2 candidate is not yet installed as of
2026-09-06 01:45).

For a valid USB result, `/diagnostics` must show both `phone-pose` and
`raw-frame` on IPv6 link-local addresses, the browser must remain visible, and
the run must report no thermal contamination, decoder resets, or dropped
frames. The 120 fps source option is retained only for ceiling diagnosis; on
the tested iPhone it did not exceed the approximately 60 fps ScreenCaptureKit
ceiling and overloaded the decoder.
