# S2.1 developer preview: release scope

This candidate is a **source-based developer preview**, not a generally installable iPhone product or a claim of completed wireless acceptance.

## Included

- S1 ARKit tracking, S2.1 authoritative elastic-tray physics, LAN transport and retained mirroring support.
- Web controls for movement scale (25–100%, default 50%), ball diameter (10–20 mm, default 15) and bounce (0–0.8, default 0.35).
- Atomic parameter application on a new calibrated round; shared snapshots drive both devices. No mid-flight collider resize or observer control of an active round.
- `npm start` with port preflight and process cleanup; Node 24 version guidance.
- A procedural phone model and first-install instructions independent of private assets.

## Remaining consumer-install blockers

1. **iPhone distribution.** Current app requires iOS 27/Xcode 27 and developer signing. No TestFlight build exists. External TestFlight needs App Store Connect setup, a build upload and applicable beta review; a development-signed app is not universal. See [Apple TestFlight](https://developer.apple.com/testflight/).
2. **Connection setup.** The app embeds `LiveBridgeURL` and signing defaults. Developers can change them before building. Non-developers need runtime pairing/address configuration.
3. **Desktop installation.** The launcher needs Node and npm dependencies; it is not a signed Mac installer.
4. **Acceptance.** Real Wi-Fi sessions have shown tracking-limited pauses and snapshot-receipt timeouts. Five-minute wireless acceptance, broader-device checks and S1 precision/extrinsics remain open.
5. **Distribution scope.** The GitHub repository is private. No public source license has been selected. A private preview does not change visibility or grant a public source license; licensed GLBs and signing material stay out of artifacts.

For invited non-developer testers, the next release work is a distributed iPhone build, in-app pairing, a packaged desktop launcher and completion of wireless acceptance.

## Validation boundary

Automated checks, repository-only startup and synthetic browser interaction prove software behavior only. The installed iPhone App already reads variable geometry from snapshots, so these Web parameter changes do not require another App install. No new physical scale/size acceptance is claimed before real-device use of the controls.

### 2026-09-06 software verification

- `npm run check`: 400 tests in 39 files, lint, TypeScript and production build passed. Existing bundle-size warning remains.
- `swift test --package-path ios`: 55 tests passed, including shared projection fixtures for 10 mm and 20 mm balls at front/back slab boundaries.
- A clean `git archive` of implementation commit `a20bb1e`, without any private model or installed dependencies, passed `npm ci` and `npm start` on the development Mac (Node 26.8.1). This is a clean-source smoke test on the same Mac, not an independent-machine acceptance.
- The exact archived copy served the ordinary browser test on 17317/17319/17320 with an explicitly labeled synthetic phone. Web editing applied 25%/20 mm/0.20, then 100%/10 mm/0.50, then restored 50%/15 mm/0.35. Draft changes did not alter the running ball before restart; each restart changed the ball identity and reported the applied values.
- Both ball sizes and the procedural model were visibly rendered. Private GLBs were absent. Fullscreen and Esc were not operated.
- A second launcher failed clearly on occupied ports without stopping the first instance. Terminating the launcher closed all three test listening ports. Temporary browser and synthetic producer were removed.
- Local artifacts are retained under ignored `captures/elastic-tray/`: `parameter-check.log`, `parameter-swift-test.log`, `parameter-browser-state.txt`, and parameter/model screenshots. They are not included in public source artifacts.
