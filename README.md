# Phone 3D UI Studio

A spatial interaction workspace where a real iPhone drives its counterpart in a Web 3D world.

**Main track: spatial interaction.** Screen mirroring, latency, picture quality and transport optimization remain a supporting track. Their existing implementation and evidence are preserved.

## Current milestone: S1 — 6DoF tracking

The iPhone app now offers **Spatial tracking** and **Screen mirroring**. Spatial tracking sends ARKit camera position, orientation and tracking quality over a separate metadata channel. The Web workspace maps these to a gravity-aligned relative workspace, with explicit origin calibration and visible loss-of-tracking handling.

**S1 software is delivered and installed; physical acceptance remains pending.**
For the current local delivery, open **http://127.0.0.1:14317/** and follow the
[中文体验与验收说明](docs/S1_QUICKSTART.zh-CN.md). This entry runs the isolated
S1 checkout; the generic development commands below use the default port.

S1 software verification and physical acceptance are separate. See [S1 delivery and acceptance](docs/SPATIAL_S1.md) for current evidence and limitations. S2 (one marble crossing the boundary) starts only after S1 physical acceptance; S3 adds five marbles and a complete pour/catch loop.

## Run locally

Requires Node.js 24+ and the locally licensed iPhone model under `public/local-assets/iphone-17/`.

```sh
npm ci
npm run bridge
npm run dev
```

Open http://127.0.0.1:4317/. Spatial mode is the default. The iPhone uses its configured `LiveBridgeURL` host on port 4319. Choose Spatial tracking, tap Start tracking and allow Camera. Hold the phone above a textured desk, screen up and top toward the Mac, then click Set origin in the browser.

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
