> Historical live-screen branch plan, preserved on 2026-09-06. This is not the active spatial roadmap.

# Architecture baseline

## Product invariant

The physical iPhone is the source of truth for both visible screen content and device orientation. Prerecorded video and simulated motion are diagnostic sources only; they do not satisfy the product goal. A hand-authored animation timeline must never be presented as proof of live device synchronization.

See [PRODUCT_GOAL.md](PRODUCT_GOAL.md) for the product boundary and acceptance flow.

## Data flow

```text
Phone screen capture ---- JPEG/WebSocket ------> browser CanvasTexture
                                                      |
                                                      v
                                                screen mesh material
                                                      |
Phone attitude -------- JSON/WebSocket --------> phone group quaternion
                                                     |
                                                     v
                                  3D studio + camera + compositor
                                                     |
                                                     v
                                          preview and recording
```

## Component boundaries

- **Renderer** owns the Three.js scene, phone asset, screen texture, camera, lighting, background, and compositing.
- **Studio state** owns serializable presets and timeline state; it contains no captured media bytes.
- **Screen source** exposes frames plus timestamps and can be prerecorded or live.
- **Pose source** exposes quaternions plus timestamps and can be simulated or device-backed.
- **Synchronizer** aligns and marks freshness; it does not silently pretend missing data is current.
- **Recorder** consumes the final composited output.

## Live-input feasibility candidate

The current iOS 27 path uses a locally signed SwiftUI host app and ScreenCaptureKit full-display capture. The app captures screen sample buffers and Core Motion attitude in the same lifecycle, JPEG-compresses video at up to 15 fps, and sends both streams to a small Node WebSocket bridge on the trusted local network. The browser keeps only the newest undecoded frame and the iOS/bridge queues are bounded so a slow consumer does not create unbounded memory growth.

Each frame and pose message carries a synchronized timestamp. The browser retains three seconds of raw quaternion history and uses spherical interpolation to select the pose at the WebRTC frame's `captureTime`; receiver pipeline delay is the fallback when the frame clock is unavailable. Calibration is applied after interpolation so changing the tabletop zero does not invalidate history. The UI exposes alignment mode, video-aligned delay and nearest pose-sample distance, and marks screen data stale after 1 second and pose data stale after 500 ms. These are observability thresholds, not yet full long-run acceptance results.

Pose presentation is selectable at runtime. Synchronized mode uses the frame-clock history, Low latency uses the newest sample with fast smoothing, Instant removes 3D smoothing, and Ultra additionally requests 200 Hz device motion. In Ultra, each Three.js render extrapolates from the latest quaternion and Core Motion rotation rate, so a 120 Hz display can receive a fresh target between roughly 100 Hz sensor packets. Prediction is capped at 30 ms and every new sensor sample corrects the extrapolated path. The UI reports the actual device-limited sensor rate, 3D render rate, pose-arrival-gap p95, and prediction-correction angle because Core Motion may clamp the requested rate and network delivery can be uneven.

Performance recording stores bounded numeric telemetry while active: pose arrival and sensor intervals, angular speed, prediction correction, render-frame intervals, sample age at render, prediction horizon, and cap hits. The completed schema-v2 report includes p50/p95/p99/max summaries plus raw numeric samples for correlation; it never contains captured screen pixels.

The iOS companion therefore requires iOS 27; ReplayKit broadcast sample handlers are no longer supported on that release. The transport protocol deliberately keeps the capture API replaceable.

## Initial technology direction

- TypeScript, React, Vite.
- Three.js through React Three Fiber; Drei for standard scene helpers.
- WebSocket/JPEG for the first measurable local feasibility path; WebRTC remains an optimization candidate after physical-device evidence.
- WebSocket JSON messages for pose samples.
- Browser MediaRecorder for the first export path, with OBS as a diagnostic/reference option rather than a required runtime dependency.

These are baseline choices, not proof of platform feasibility. The M3 and M4 spikes may replace transport details without changing the renderer contracts.

## Repository data boundaries

Never commit:

- phone screen recordings or screenshots containing personal data;
- signing certificates, provisioning profiles, API keys, pairing secrets, or `.env` files;
- generated exports, caches, build output, dependencies, or local databases.

Use synthetic/demo UI media for fixtures and documentation.

## Prerecorded screen source

The M2 prerecorded path keeps the user's media outside project state:

1. The file picker receives a local `File` selected by the user.
2. A short-lived object URL feeds a muted, looping `HTMLVideoElement`.
3. A `VideoTexture` is attached only to the independently named `screen-mesh`.
4. Replacing the source or leaving the app pauses the element, clears its source, disposes the texture, and revokes the object URL.

The selected file bytes and local path are never copied, uploaded, or serialized. The screen shader rotates display coordinates for landscape mode and applies contain scaling from source and target aspect ratios. Pixels outside the fitted source are black, so mismatched media is letterboxed or pillarboxed rather than stretched or cropped.
