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
