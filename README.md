# Phone 3D UI Studio

A local Mac studio where a physical iPhone drives both the live screen and the orientation of a matching 3D phone, with local preview and recording.

The product goal is a live physical-device digital twin—not a general-purpose 3D mockup animator. See [docs/PRODUCT_GOAL.md](docs/PRODUCT_GOAL.md).

- GitHub repository: <https://github.com/Popcornnnnnnnn/phone-3d-ui-studio>
- Delivery board: <https://github.com/users/Popcornnnnnnnn/projects/3>

## Project status

- Accepted: M0 project foundation; M2 screen-video vertical slice
- Active: M3/M4 physical-device live screen and pose are proven; measured latency and stability acceptance remain open
- Baseline start: 2026-09-02
- Target content-production MVP: 2026-09-18
- Target live-sync release candidate: 2026-10-09
- Target acceptance: 2026-10-12
- Current review item: [M1 — visually recalibrate the iPhone 17 asset](https://github.com/Popcornnnnnnnn/phone-3d-ui-studio/issues/2)
- Next product gate: instrument true capture-to-render latency, then complete a cable-free stability run

The schedule assumes one primary developer, a Mac and iPhone available for testing, and no App Store release requirement. See [PROJECT_PLAN.md](PROJECT_PLAN.md) for the estimate, gates, and acceptance criteria.

## Product boundary

The project deliberately separates the supporting renderer from the product outcome:

1. **Renderer foundation** — a calibrated 3D phone, replaceable screen surface, prerecorded media, lighting, and simulated motion used as a deterministic test harness.
2. **Core product** — live phone-screen transport and real-device attitude jointly drive the rendered phone, which can then be recorded locally.

The renderer foundation is not intended to compete with products such as Rotato. Generic template catalogues, elaborate keyframe editing, and mockup-marketing workflows are outside the primary goal unless they are needed to validate or record the live twin.

## Repository structure

```text
docs/                  Architecture and decision records
ios/                   iOS 27 ScreenCaptureKit companion app
scripts/               Local screen/pose bridge
src/model/             Calibrated device dimensions and tests
src/scene/             Three.js model and studio scene
.github/               Issue templates and project automation metadata
PROJECT_PLAN.md        Schedule, milestones, effort, risks, acceptance gates
ROADMAP.md             Date-based delivery checkpoints
```

The current application contains a locally licensed iPhone 17 model with an independently addressable screen mesh, deterministic review views, local MP4 playback, and a live-input mode. A local bridge carries H.264 screen frames over a dedicated low-delay TCP socket and timestamped Core Motion quaternions over WebSocket from the iOS 27 ScreenCaptureKit companion into the Three.js renderer. The browser retains a bounded pose history and aligns interpolated motion to each displayed video frame's capture clock. Tabletop calibration maps a screen-up iPhone with its Dynamic Island aimed toward the Mac to the studio floor, and **Reset standard view** returns the camera to a charging-port-level view. Formal reconnection and stability acceptance are still required. Confirmed model boundaries are recorded in [docs/references/iphone-17-black.md](docs/references/iphone-17-black.md).

For pose-response experiments, the web UI can switch live between Synchronized, Low latency, Instant, and Ultra. Instant applies the latest received attitude without Three.js smoothing. Ultra also asks the iPhone for a 200 Hz Core Motion stream, reports the actual device-limited rate, and performs bounded angular-velocity prediction before every Three.js render instead of only when a network sample arrives. Its live diagnostics expose 3D render rate, pose-arrival p95, and prediction-correction error; it intentionally prioritizes shell response over screen/pose synchronization.

The Performance recording control captures numeric screen, pose-packet, and per-render telemetry without screen pixels. Stopping a run summarizes p50/p95/p99/max tails for render gaps, pose arrival, sample age, angular speed, prediction correction, and prediction-cap hits; the downloadable JSON retains the bounded raw samples for offline diagnosis.

## Local development

Requires Node.js 24 or newer.

```bash
npm install
npm run dev
npm run bridge
```

The local studio runs at <http://127.0.0.1:4317>. The bridge listens on port `4319` for control/pose and port `4320` for the raw H.264 frame path. Run the complete web verification suite with `npm run check`. See [ios/README.md](ios/README.md) for the locally signed iPhone build and benchmark procedure, and [experiments/live-screen-latency/FINDINGS.md](experiments/live-screen-latency/FINDINGS.md) for the measured production configuration and remaining native-app boundary.

## Working rules

- Keep source, generated media, captured phone content, secrets, and build caches separate.
- Never commit captured personal phone screens, signing material, provisioning profiles, `.env` files, or recordings.
- Local video selection uses an in-memory object URL; the app does not copy, upload, or serialize the selected file path.
- A visually convincing render is not proof that live capture or pose synchronization works.
- Every milestone closes only after its acceptance check is recorded in the corresponding GitHub issue.
