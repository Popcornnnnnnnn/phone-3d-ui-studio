# Phone 3D UI Studio

A real iPhone becomes a tray in a shared Web 3D world. Gently toss a ball, move to catch it, and tap **Add ball** on your phone after a miss.

**Developer preview — not a one-click consumer install.** The desktop workspace runs from this repository. Playing requires Xcode 27, your own iPhone signing and a physical iPhone on iOS 27. No generally installable iPhone binary or TestFlight invitation is included. Wireless interruptions and formal physical acceptance remain open.

## Start the desktop workspace

Use Node.js **24+** on a Mac:

```sh
npm ci
npm start
```

Open the **Studio ready** URL printed in the terminal, normally <http://127.0.0.1:4317/?experience=marble>. This starts both the bridge and Web server; **Ctrl+C stops both**. Occupied ports produce an explanation without stopping another instance.

A procedural phone model is included. The privately licensed GLB under `public/local-assets/` is **optional** and never redistributed.

[中文首次安装指南](docs/QUICKSTART.zh-CN.md) · [iPhone build details](ios/README.md) · [Release readiness](docs/RELEASE_READINESS.md)

## Play settings

In **Marble → Play settings**:

| Setting | Default | Range |
| --- | --- | --- |
| Movement scale | 50%: real 20 cm → virtual 10 cm | 25–100% |
| Ball diameter | 15 mm | 10–20 mm |
| Bounce | 0.35 | 0–0.8 |

Click **Start round**, or **Apply & restart** after editing, while tracking is ready. This recalibrates and clears previous balls while retaining the observation camera. The bridge owns the parameters for that round; the phone and every browser use its snapshots. Another page cannot change a running controller's round. Rotation stays 1:1; the S1 **Tracking** mode retains metric 1:1 translation.

One ball is active and at most five balls are retained including ground traces. The bridge runs Rapier at 120 Hz; both screens render snapshots with a 50 ms presentation buffer. Demonstration gravity is 1.5 m/s². Real tray motion supplies energy; no automatic launch, Return or recovery teleport is used.

## Development and verification

```sh
npm run check
swift test --package-path ios
```

`npm run bridge` and `npm run dev` remain available separately. For an isolated instance:

```sh
PHONE_STUDIO_PORT=17317 PHONE_BRIDGE_PORT=17319 PHONE_BRIDGE_FRAME_PORT=17320 npm start
```

Use the printed Web URL, which includes the selected bridge. Set the iPhone's `LiveBridgeURL` to that Mac's LAN address and bridge port before building. Web is loopback-only; the phone communicates with the LAN bridge. Use a trusted local network; the prototype has no authenticated pairing or cloud access.

Camera images stay on the iPhone in spatial mode. Automated/synthetic tests do not establish physical accuracy, visible latency or five-minute wireless reliability. See [experience and evidence](docs/ELASTIC_TRAY.md).

**Spatial interaction is the main track.** Screen mirroring, image quality and transport performance remain a supporting track. Choose **Screen mirroring** on both devices for the prior workflow. [Product goal](docs/PRODUCT_GOAL.md) · [Architecture](docs/ARCHITECTURE.md) · [Roadmap](ROADMAP.md). Previous plans remain under `docs/legacy/` and `experiments/`.
