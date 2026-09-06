> Historical live-screen branch plan, preserved on 2026-09-06. This is not the active spatial roadmap.

# Project plan

## Executive estimate

The recommended baseline is **six calendar weeks / about 26–32 focused engineering days** for a usable physical-device live-twin release candidate, followed by one acceptance day. The prerecorded-content path is a renderer validation harness, not a separate product target.

This estimate covers a local Mac authoring tool and one iPhone test path. It does not include App Store distribution, Windows support, Android support, cloud accounts, collaborative editing, or automated 3D reconstruction as an end-user feature.

## Delivery strategy

The project is split at the highest-risk boundary:

- The studio/rendering path is developed first only far enough to validate the model, screen surface, compositor, and recording boundary.
- Live screen transport and motion transport are separate spikes with explicit go/no-go decisions.
- Screen frames and pose samples are timestamped independently; synchronization is accepted by measurement rather than appearance alone.
- Generic mockup timelines, template catalogues, and marketing-video features are deferred because established products already serve that workflow.

## Milestones and dates

| Milestone | Target | Effort | Required outcome |
|---|---:|---:|---|
| M0 — Project foundation | 2026-09-04 | 1–2 d | Repository, architecture contract, asset/privacy rules, runnable skeleton, CI checks |
| M1 — 3D phone prototype | 2026-09-09 | 3 d | Phone model with isolated screen mesh, orbit controls, calibrated portrait/landscape UVs |
| M2 — Renderer validation slice | 2026-09-18 | 3–5 d | Prerecorded video proves the independent screen mesh, orientation handling, lighting, and local compositor |
| M3 — Live-screen feasibility gate | 2026-09-23 | 3 d | One measured iPhone-to-Mac capture path; latency, resolution, protected-content limits documented; route selected or rejected |
| M4 — Pose-sync feasibility gate | 2026-09-28 | 3 d | Quaternion transport, one-click level calibration, coordinate conversion and smoothing demonstrated on a real device |
| M5 — Integrated live-sync beta | 2026-10-05 | 5 d | Screen and pose integrated, reconnection handled, timestamp alignment measured, 10-minute stability run |
| M6 — Release candidate | 2026-10-09 | 3–4 d | Presets, recording, onboarding, error states, clean-machine setup and regression checks |
| Acceptance | 2026-10-12 | 1 d | End-to-end physical-device demo and documented known limitations |

## Work breakdown

### M0 — Project foundation

- Select React Three Fiber/Three.js renderer baseline.
- Define phone asset contract: body, screen mesh, camera cluster, buttons, transform origin.
- Create privacy boundaries for captures and recordings.
- Add lint, typecheck, test, and build commands.
- Record initial architecture decision and performance budgets.

### M1 — 3D phone prototype

- Produce or adapt a legally usable phone model.
- Keep the screen surface replaceable and independently addressable.
- Calibrate model dimensions and pivot.
- Support portrait/landscape orientation and safe-area masks.
- Establish a repeatable screenshot review scene.

### M2 — Renderer validation slice

- Apply prerecorded screen media as a Three.js video texture.
- Implement background, floor, shadow, lighting, and material presets.
- Retain minimal play/pause/reset and deterministic review cameras for diagnosis.
- Treat camera timelines, template authoring, and saved marketing projects as deferred non-goals.
- Keep a local recording boundary only as needed to prove that the final live composite can be captured.

### M3 — Live-screen feasibility

- Compare the lowest-risk iPhone capture routes available on the target OS.
- Prove one live stream into the renderer before designing a general transport layer.
- Measure glass-to-render latency and dropped-frame behavior.
- Record unsupported/protected-content behavior and user-consent flow.
- Decide whether the release path uses a native companion, system capture, or a documented external capture bridge.

### M4 — Pose-sync feasibility

- Capture device attitude as a quaternion.
- Convert the phone coordinate frame to the Three.js right-handed frame.
- Implement one-click level calibration, interpolation, filtering, and stale-sample detection.
- Measure pose update rate and motion-to-render latency.

### M5 — Integrated beta

- Pair screen and pose sessions.
- Add local discovery or an explicit pairing code.
- Handle network changes, suspend/resume, orientation changes, and reconnects.
- Align screen and pose timestamps within the accepted envelope.
- Run a ten-minute physical-device stability test.

### M6 — Release candidate

- Finish user-facing connection and error states.
- Package example assets that contain no personal phone content.
- Add clean-machine setup and troubleshooting documentation.
- Verify repeatable export from a fresh checkout.
- Record limitations and deferred work.

## Acceptance criteria

### Renderer validation baseline

- A supplied screen recording maps correctly to the phone screen in portrait and landscape.
- Deterministic front, back, and studio review views expose geometry and mapping errors.
- Prerecorded media and simulated motion remain clearly labelled as test sources, not live proof.

### Live-sync release candidate

- A physical phone can connect through an explicit, user-consented flow.
- The live screen appears on the 3D screen mesh and survives an orientation change.
- The model follows real-device attitude after one explicit **Calibrate tabletop pose** action with the iPhone screen-up and its Dynamic Island pointing toward the Mac.
- **Reset standard view** returns orbit controls to the charging-port-level tabletop camera.
- Measured median pose latency is at most 80 ms on the test LAN; median screen latency is at most 250 ms.
- Screen/pose relative skew is normally within 100 ms and is surfaced when stale.
- A ten-minute test has no unrecovered disconnect, runaway rotation, or frozen texture.
- The recording contains the final composited scene, not a placeholder or independent source feed.

## Estimate ranges and uncertainty

| Area | Best case | Baseline | Risk case |
|---|---:|---:|---:|
| Studio and prerecorded workflow | 8 d | 11–14 d | 18 d |
| iPhone live screen | 2 d | 4–6 d | 10+ d or route rejection |
| Pose synchronization | 2 d | 3–5 d | 8 d |
| Integration and hardening | 4 d | 7 d | 12 d |
| Total | 16 d | 26–32 d | 48+ d |

The largest uncertainty is iPhone capture behavior while other applications are visible. The schedule therefore protects the independently useful content-production MVP and uses feasibility gates before committing to a native companion architecture.

## Explicitly out of scope for the baseline

- App Store/TestFlight publication.
- Android, Windows, or browser-only mobile capture parity.
- Cloud relay, user accounts, remote collaboration, or hosted storage.
- Automatic generation of an exact branded phone model from one photograph.
- Capture of DRM-protected or system-restricted content.
- Production-grade video editor features such as multitrack editing, captions, or color grading.
- A Rotato-style general mockup animator, extensive keyframe timeline, device catalogue, or template marketplace.

## Schedule change policy

- Update the GitHub Project item and its issue when a task starts, is blocked, changes scope, or completes.
- A milestone date changes only with a written reason, revised impact, and updated acceptance target.
- Feasibility spikes end with a decision record even when the tested route is rejected.
- Progress percentage is derived from accepted tasks, not elapsed time or code volume.
