# Roadmap

## Accepted progress

- 2026-09-02 — M0 project foundation accepted ahead of its 2026-09-04 target.
- 2026-09-02 — M1 calibrated iPhone 17 black model accepted ahead of its 2026-09-09 target.
- 2026-09-02 — M2 screen-video texture and orientation slice accepted ahead of its 2026-09-13 target.
- 2026-09-02 — M1 visual acceptance reopened after the geometry-correct render failed recognizable iPhone 17 fidelity review; revised candidate awaits visual sign-off.
- 2026-09-02 — Product direction narrowed to a live physical-device twin: real iPhone screen plus real device attitude drive the rendered phone. The prerecorded studio remains a test harness, not a standalone mockup-editor target.
- 2026-09-02 — M3/M4 physical-device path proved: iOS 27 ScreenCaptureKit sends the live display and timestamped Core Motion pose over Wi-Fi to the local bridge; the browser renders both on the 3D phone and one-click level calibration is verified. Formal latency, reconnection and stability evidence remains open.
- 2026-09-03 — M4 screen/pose alignment implemented: WebRTC frame capture time selects an interpolated pose from bounded history; real-device telemetry observed `frame-clock` alignment at about 131 ms video delay with a 2.4 ms nearest-sample gap. Tabletop zero pose and the charging-port standard camera were browser-verified; formal long-run acceptance remains open.

## Week 1 — 2026-09-02 to 2026-09-06

- Complete repository and CI foundation.
- Lock the first architecture and asset contracts.
- Start the static 3D phone scene.

Checkpoint: a fresh checkout runs the renderer skeleton and the M0 issue contains verification evidence.

## Week 2 — 2026-09-07 to 2026-09-13

- Finish the phone model integration and screen mesh.
- Add prerecorded video texture and portrait/landscape calibration.
- Add the first studio and camera presets.

Checkpoint: a supplied UI recording plays correctly on the 3D phone.

## Week 3 — 2026-09-14 to 2026-09-20

- Freeze the minimum renderer validation slice.
- Begin the iPhone live-screen spike without expanding into a generic keyframe or template editor.
- Record the first measured capture-path evidence and limitations.

Checkpoint: the renderer is sufficient to distinguish transport failures from display/model failures, and one live-screen route has measured evidence.

## Week 4 — 2026-09-21 to 2026-09-27

- Complete the live-screen feasibility gate.
- Measure latency and select or reject the capture route.
- Build quaternion transport and coordinate calibration.

Checkpoint: both risk spikes have evidence and an explicit decision.

## Week 5 — 2026-09-28 to 2026-10-04

- Integrate live screen and pose.
- Add pairing, reconnect, stale-state handling, and timestamp alignment.
- Run repeated physical-device sessions.

Checkpoint: integrated beta survives normal orientation and connectivity changes.

## Week 6 — 2026-10-05 to 2026-10-11

- Stabilize the integrated beta.
- Complete onboarding, troubleshooting, packaging, and regression checks.
- Produce the release-candidate recording and clean-machine verification.

Checkpoint: release candidate is ready for physical-device acceptance on 2026-10-12.
