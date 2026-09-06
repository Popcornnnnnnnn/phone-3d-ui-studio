# S1 delivery and validation

Status (2026-09-06): **software implemented and installed; physical acceptance pending**.
S2 and S3 remain gated on the physical checks below.

## Scope

Spatial interaction is the main track. S1 adds ARKit 6DoF to the existing iPhone
app and a metric Web workspace. Screen mirroring, latency, quality and stability
work remain available as the supporting track. This delivery contains no marble
simulation, physics engine, camera streaming, WKWebView or marker recognition.

The iPhone app defaults to Spatial tracking without opening the camera.
Start tracking requests camera permission explicitly. Set origin on the Mac
establishes translation and horizontal heading; real gravity, pitch and roll
remain intact. The displayed starting height of 20 cm is a workspace convention.

## Reproducible source

- Branch: `codex/spatial-s1`.
- Implementation checkout: `/Users/forge/.codex/worktrees/spatial-s1/phone-3d-ui-studio`.
- Original checkout: `/Users/forge/Workspace/phone-3d-ui-studio`.
- Original HEAD: `fb15e17c14a17603964d8b59e6b63d8b05dda37e`.
- Local baseline commit: `bda8930f2fdb79dc6f791c217c045eed3012ae15`.
- The baseline includes the dependent uncommitted source in the original working
  tree. The 238 copied files and hashes are recorded in the ignored
  `captures/spatial-s1/baseline.json`. A subsequent hash comparison found no
  changes to those files in the original checkout.
- Licensed model assets are local and ignored. Existing design evidence was
  preserved locally and is not part of the implementation commit.

The current working-tree baseline contains supporting-track changes newer than
the accepted color-only installation. Rebuilding that baseline does not extend
the old physical acceptance to those changes; mirroring must be checked again.

## Run

In the implementation checkout:

```sh
npm ci
npm run bridge
npm run dev -- --host 127.0.0.1 --port 14317
```

Only start the bridge if port 4319 is not already managed by the installed
LaunchAgent. The current bridge LaunchAgent uses this S1 checkout and preserves
its existing Interactive / LegacyTimers settings. The original plist is saved
in `captures/spatial-s1/bridge-launchagent-before.plist`.

Open http://127.0.0.1:14317/ for S1, or add `?mode=mirroring` for the supporting
mode. The original Web server remains associated with the original checkout.
The iPhone connects to `ws://forge.local:4319/`; Mac and iPhone must be reachable
on the same local network. No new video receiver lease is acquired by S1.

Build the same application target with Xcode 27 beta:

```sh
DEVELOPER_DIR=/Applications/Xcode-27-beta.app/Contents/Developer \
  xcodebuild -project ios/Phone3DUIStudio.xcodeproj -scheme Phone3DUIStudio \
  -destination 'generic/platform=iOS' -derivedDataPath ios/build-spatial \
  -allowProvisioningUpdates build
```

## Software evidence

| Check | Result | Local evidence |
| --- | --- | --- |
| ESLint, TypeScript, Vitest, production bundle | Passed; 33 files / 360 tests | `captures/spatial-s1/project-check.log` |
| Portable Swift tests | Passed; 47 tests | `captures/spatial-s1/swift-test.log` |
| Physical iOS target, unsigned and signed build | BUILD SUCCEEDED | `ios-build.log`, `ios-signed-build.log` in the same capture folder |
| Strict recursive app signature check | Passed | Signed app in `ios/build-spatial/Build/Products/Debug-iphoneos/` |
| Installation and launch | Succeeded on the existing iPhone 17; same bundle `com.phone3dui.studio` | `device-install.json`, `device-launch.json`; final correction in `device-install-ack.json` |
| Native default screen | Spatial selected; Start tracking displayed | `iphone-spatial-initial.png` |
| Exact-checkout browser translation | Input offset [0.2, 0.2, -0.2] m; relative display matched; rendered position [0.2, 0.4, -0.2] m | `browser-20cm.png` |
| Browser rotation | Flat device rotated upright while position remained fixed | `browser-rotation.png` |
| Browser interruption / recovery | Disabled calibration during interruption; position frozen; recovery required Set origin | `browser-stale.png` and interactive AX inspection |
| Reset view / mode selector / diagnostic recording controls | Exercised in the exact checkout; Chrome downloaded valid JSON containing camera and render records | `browser-telemetry-fixture.json`; the in-app browser did not produce a downloaded file |

The deterministic browser input was explicitly labelled `fixture`. It is
software evidence, not an ARKit measurement. The bundle warning for a large
JavaScript chunk and existing Apple API deprecation warnings remain.

Automated cases cover the metric model scale, three translation axes, fixed
camera basis, lever-arm rotation, quaternions, yaw-only calibration, gravity
preservation, invalid packets, old sessions/connections, out-of-order data,
limited tracking, staleness with throttled timers, reconnects, mode lifecycle
gating, bridge shutdown, congestion and missing clock estimates.

For repeatable synthetic development, use a separate bridge port:

```sh
PHONE_BRIDGE_PORT=14319 PHONE_BRIDGE_FRAME_PORT=14320 npm run bridge
node scripts/spatial-fixture.mjs ws://127.0.0.1:14319
```

Open the workspace with
`?bridge=ws%3A%2F%2F127.0.0.1%3A14319`. The fixture reads JSON lines such as
`{"position":[0.2,0,0]}`, `{"state":"limited"}`, or `{"pause":true}`.
Do not run a fixture against the physical test's bridge.

## Concentrated physical acceptance session

The controlled accuracy and durability gates remain **pending**. Initial live tracking and a background/foreground session transition have been observed; they do not substitute for the full sequence.

1. Open the installed app, select Spatial tracking, tap Start tracking and allow
   the camera. Hold the phone above a textured, well-lit surface, screen facing
   up and top toward the Mac. Keep the rear camera unobstructed.
2. Wait for normal tracking. Start numeric telemetry in Web Tracking details.
   Click Set origin. Record the physical phone and Mac in one external-camera
   frame with a ruler or measured reference; software screenshots are not a
   substitute for this view.
3. Translate approximately 20 cm separately along X, Y and Z, returning to the
   same physical origin each time. Repeat each axis three times. Log the measured
   physical endpoint and numeric endpoint per trial. Each endpoint and return
   deviation must be at most 3 cm for this experiment.
4. Rotate to 0, 45 and 90 degrees and return; check direction, axis and model
   orientation. Distinguish raw camera movement from estimated body-center
   movement when rotating.
5. Continue for five minutes. Check that freezes and tracking resets have visible
   state changes, with no unexplained jumps accepted as real motion.
6. Cover the rear camera, background/foreground the app, and disconnect/reconnect
   the network. In each case verify freeze, a useful recovery hint and explicit
   recalibration before movement resumes.
7. Stop and download telemetry; preserve it beside the external view and trial
   notes. Telemetry records camera samples and CPU render submissions separately.
8. Select Screen mirroring on both devices, start system screen sharing using
   the existing flow, and verify screen and physical rotation synchronization.

| Physical gate | Status |
| --- | --- |
| Camera authorization and normal ARKit tracking | Observed on real iPhone; limited features recovered when aimed at the floor |
| X/Y/Z endpoint and return error, 3 repetitions each | Pending |
| 0/45/90 degree rotations and return | Pending |
| Five-minute continuity | Pending |
| Camera obstruction / app background / network recovery | Pending |
| External same-frame evidence and numeric trace | Pending |
| Mirroring restart and screen/rotation regression | Pending |

The 3 cm threshold is a local experimental gate, not an ARKit precision promise.
No user-visible latency claim follows from the software timestamps.

## First physical run and correction

Real ARKit packets were received and calibrated. Pointing at a feature-poor
surface produced the expected limited state; pointing at the floor restored
normal tracking. A disconnect and new AR session followed app backgrounding.
The user later described a rightward move of about 5 cm; it was not a measured
20 cm trial and no precision acceptance is claimed.

The initial transport admitted many samples into the URLSession TCP buffer
before a remote receipt. Real bursts and gaps above 250 ms caused the intended
freeze/recalibration gate to interrupt that trial. The pre-correction stream
and analysis are preserved in `physical-camera.ndjson` and
`pre-ack-receive-analysis.json`. This required a second, corrective installation
after the first physical run; the original single-install target was not met.

The corrected sender uses bridge receipts to keep exactly one packet in flight
and one latest waiting packet. The 250 ms freeze threshold is unchanged. It also
keeps the phone display awake while tracking, restoring the previous setting
on stop/background/failure. The correction passed software checks. A subsequent real stream still contained
sporadic gaps above 250 ms, so continuous-use acceptance has not passed. A later
62-second control run recorded 1,076 poses with no gap above 250 ms (maximum
240 ms); its concurrent ICMP check received 59 of 60 replies. This short,
changed-condition observation does not establish five-minute stability or
isolate every remaining delay. Data: `physical-camera-ack.ndjson`,
`physical-link-control.ndjson`, `physical-link-control-analysis.json`, and
`phone-link-ping-60s.txt`. The user also described a later leftward move of about
5 cm; the frozen model made it unsuitable as a precision trial.

## Limits and rollback

Camera-to-body translation uses approximate model geometry. Precise optical
extrinsics must be measured before marble collisions are accepted. Calibration
is relative; the grid does not locate the physical monitor or desk. There is no
motion prediction or automatic recovery that silently changes the origin.

The native foreground-only session requires recalibration after returning from
the background. Browsers use the latest trusted sample and freeze at 250 ms.
Cross-device sample age is hidden without a usable clock estimate.

The accepted color-only 960 × 2088 mirroring app, its source archive, provenance
and SHA-256 manifest are preserved in
`captures/spatial-s1/rollback-color-only/`. Its recursive signature was checked.
This is the previously documented accepted static-picture build, not an inferred
copy of an installed binary.

To roll back, stop the S1 bridge LaunchAgent, restore
`bridge-launchagent-before.plist` to its saved LaunchAgents path and bootstrap
that job. Reinstall the saved rollback app to the same device with devicectl.
Open the original Web checkout and restart sharing through the system picker.
Do not delete the S1 worktree while its LaunchAgent still points here.
