# Phone 3D UI Studio

A spatial interaction workspace where a real iPhone drives its counterpart in a Web 3D world.

**Main track: spatial interaction.** Screen mirroring, latency, picture quality and transport optimization remain a supporting track. Their existing implementation and evidence are preserved.

## Current milestone: S2.1 — wireless elastic tray

Gently toss the ball with the real phone, move the tray to catch it, and tap **Add ball** on the phone after a miss. There is one playable ball and up to five retained balls including ground traces. Return is removed; the old S2 checkout and signed app remain available for rollback.

**Software complete; wireless physical acceptance pending.** The bridge owns a single 120 Hz physics world. Both screens use its snapshots with a 50 ms presentation buffer. Real tray motion supplies the bounce; no automatic launch or recovery teleport is used.

Current isolated entry: **http://127.0.0.1:16317/?experience=marble** (real bridge 4319).
See [中文体验与分级验证记录](docs/ELASTIC_TRAY.md). S1 precision/extrinsics and formal collision acceptance remain open. The historical S2 entry is http://127.0.0.1:15317/ and S1 is http://127.0.0.1:14317/; restore their matching bridge and app before rollback use.

## Run locally

Requires Node.js 24+ and the locally licensed iPhone model under `public/local-assets/iphone-17/`.

```sh
npm ci
npm run bridge
npm run dev
```

Open http://127.0.0.1:4317/. Spatial mode is the default. The iPhone uses its configured `LiveBridgeURL` host on port 4319. Choose Spatial tracking, tap Start tracking and allow Camera. Hold the phone above a textured desk, screen up and top toward the Mac, then choose Tracking → Set origin for S1, or Marble → Start round for S2.1.

The backend keeps the existing 4319 WebSocket and 4320 video ports. A separate verification instance can use `PHONE_BRIDGE_PORT=14319 PHONE_BRIDGE_FRAME_PORT=14320`; its Web page takes `?bridge=ws%3A%2F%2F127.0.0.1%3A14319`. The ordinary phone configuration remains on 4319.

Choose Screen mirroring on both devices to use the previous live-screen workflow. See [iPhone setup](ios/README.md).

## Verification and boundaries

- `npm run check`: lint, TypeScript, automated tests and production build.
- `swift test --package-path ios`: portable Swift contract and lifecycle tests.
- ARKit and screen capture require a physical iPhone for end-to-end acceptance.
- Camera frames remain on the phone; spatial telemetry contains only numeric poses and status.
- Licensed models, signing material, private captures and generated recordings must not be committed.

[Product goal](docs/PRODUCT_GOAL.md) · [Architecture](docs/ARCHITECTURE.md) · [Roadmap](ROADMAP.md) · [Implementation plan](PROJECT_PLAN.md)

Previous live-twin goals, dates and evidence remain under [historical plans](docs/legacy/live-twin-readme.md) and `experiments/live-screen-latency/`.
