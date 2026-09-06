# Phone 3D UI Studio

A spatial interaction workspace where a real iPhone drives its counterpart in a Web 3D world.

**Main track: spatial interaction.** Screen mirroring, latency, picture quality and transport optimization remain a supporting track. Their existing implementation and evidence are preserved.

## Current milestone: S2 — one marble, two screens

The bridge now owns one Rapier physics world. A marble rolls inside the tracked phone, pours through its right opening, lands in the Web world, and returns toward a fixed catch zone when you click **Return**. Move the phone to catch it; both screens render the same snapshots.

**Prototype available; formal physical acceptance pending.** S2 prototype development is explicitly allowed while the remaining S1 precision, recovery and mirroring checks stay open. S3 remains gated on the accepted S2 loop.

Current isolated S2 entry: **http://127.0.0.1:15317/?experience=marble** (bridge 4319).
See [中文体验说明与验证记录](docs/SPATIAL_S2.md). The S1 checkout and rollback app are retained; its historical entry is http://127.0.0.1:14317/.

## Run locally

Requires Node.js 24+ and the locally licensed iPhone model under `public/local-assets/iphone-17/`.

```sh
npm ci
npm run bridge
npm run dev
```

Open http://127.0.0.1:4317/. Spatial mode is the default. The iPhone uses its configured `LiveBridgeURL` host on port 4319. Choose Spatial tracking, tap Start tracking and allow Camera. Hold the phone above a textured desk, screen up and top toward the Mac, then choose Tracking → Set origin for S1, or Marble → Start round for S2.

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
