<div align="center">
  <img src="public/icon-192.png" alt="Phone 3D UI Studio icon" width="88" />
  <h1>Phone 3D UI Studio</h1>
  <p>
    <strong>Interactive 3D iPhone UI showcase &amp; browser-playable Elastic Tray physics playground — plus a local Mac + ARKit 6DoF Pro mode.</strong><br />
    Play solo on mobile, scan a QR code from desktop to drive the 3D phone live over WebRTC, or preview interactive 3D UI screens right in your browser.
  </p>

  <p>
    <strong>English</strong> · <a href="README.zh-CN.md">简体中文</a>
  </p>

  <p>
    <a href="https://phone3d.popcornnn.xyz"><img src="https://img.shields.io/badge/Play_Online-phone3d.popcornnn.xyz-0D96F6?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Play Online at phone3d.popcornnn.xyz" /></a>
    <a href="https://github.com/Popcornnnnnnnn/phone-3d-ui-studio/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Popcornnnnnnnn/phone-3d-ui-studio/ci.yml?style=for-the-badge&label=CI" alt="CI status" /></a>
    <a href="https://github.com/Popcornnnnnnnn/phone-3d-ui-studio/releases/tag/v0.2.1-alpha.1"><img src="https://img.shields.io/badge/Preview-v0.2.1--alpha.1-FF9F0A?style=for-the-badge" alt="Latest preview release" /></a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/Three.js-React_Three_Fiber-111111?style=flat-square&logo=threedotjs&logoColor=white" alt="Three.js + React Three Fiber" />
    <img src="https://img.shields.io/badge/Physics-Rapier_120Hz-0A84FF?style=flat-square" alt="Rapier 120Hz physics" />
    <img src="https://img.shields.io/badge/Cloudflare-Workers_%2B_Durable_Objects-F38020?style=flat-square&logo=cloudflare&logoColor=white" alt="Cloudflare Workers + Durable Objects" />
    <img src="https://img.shields.io/badge/iOS_Pro-Swift_%2B_ARKit-F05138?style=flat-square&logo=swift&logoColor=white" alt="Swift + ARKit companion" />
  </p>

  <p>
    <a href="https://phone3d.popcornnn.xyz">Play Online</a> ·
    <a href="#zero-install-online-web-playground">Web Playground</a> ·
    <a href="#spatial-interaction--in-motion">Spatial Demo</a> ·
    <a href="#local-arkit-6dof-pro--native-mac-preview">Local Pro Mode</a> ·
    <a href="#development-and-verification">Development</a>
  </p>
</div>

---

## Zero-install Online Web Playground

Open **[phone3d.popcornnn.xyz](https://phone3d.popcornnn.xyz)** directly in any modern browser — no Xcode or app install required:

- **Desktop Online Playground (`Play Online`):** Drag the interactive **Tilt Pad** (or use Arrow/`WASD` + `Space` to toss, `B` to add a ball, `R` to reset) powered by **120 Hz Rapier WASM physics** (`shared/marbleWorld.mjs`) running entirely client-side.
- **QR Phone Pairing (`?pair=<CODE>`):** Scan the on-screen QR code with any iPhone or Android browser to drive the desktop 3D iPhone via **3DoF gyroscope orientation** and **flick-to-toss acceleration** over **WebRTC DataChannel** (with automatic WebSocket relay fallback via `/api/room/:code`).
- **Phone-Only Solo Mode:** Mobile visitors opening the site directly get an immediate full-screen **Elastic Tray** playground with handheld gyro calibration, touch-drag fallback, Web Audio catch/drop feedback, and a **Pair Desktop** modal.
- **Interactive 3D UI Showcase (`3D UI Showcase`):** Switch between 3 built-in real-time Canvas2D demo screens (**Audio Deck**, **Weather Card**, **Stack Cards** — controllable remotely from a paired phone) or drop in your own **Local MP4**.

### Run & Deploy the Web Playground

```sh
npm ci
npm run dev -- --host 0.0.0.0   # Local Vite server + /api/room/:code WebSocket relay
npm run build:public            # Builds dist/ (base /) and strips private public/local-assets/
```

Cloudflare deployment uses single-origin **Workers Static Assets + Durable Object (`RoomRelay`)** configured in [`worker/wrangler.toml`](worker/wrangler.toml) and [`worker/src/index.ts`](worker/src/index.ts), with [`public/.assetsignore`](public/.assetsignore) excluding `local-assets/`.

---

## Spatial interaction — in motion

A preview of the **S2.1 Elastic Tray** experience: lift the tray to toss a ball off the screen, move or tilt to catch it, and tap **Add ball** after a miss.

![Scripted S2.1 demo: a gentle lift tosses one ball, which returns to the tray through a physical collision.](docs/media/toss-and-catch.gif)

<table>
<tr>
<td width="50%"><strong>Your phone, in space</strong><br />Translation and rotation in a shared 3D workspace.</td>
<td width="50%"><strong>Miss it. Add one. Go again.</strong><br />A new active ball; the old ball remains on the ground.</td>
</tr>
<tr>
<td><a href="docs/media/spatial-movement.gif"><img src="docs/media/spatial-movement.gif" alt="Scripted demo of moving and rotating the phone through the Web workspace." width="100%" /></a></td>
<td><a href="docs/media/land-and-add.gif"><img src="docs/media/land-and-add.gif" alt="Scripted demo of a ball falling through the side opening, landing, and a new ball being added on the phone." width="100%" /></a></td>
</tr>
</table>

> **Render note:** These animations are **scripted renders** driven by the project's procedural phone model and Rapier physics to illustrate interaction behavior; they are not camera footage or wireless reliability evidence ([media details and limitations](docs/media/README.md)).

---

## Local ARKit 6DoF (Pro) & Native Mac Preview

For full 6DoF metric translation + native ScreenCaptureKit mirroring over LAN:

- **Native Mac app (`Apple Silicon`):** `npm run app:build && open "build/macos/Phone 3D Studio.app"` (ad-hoc signed; see [Mac setup & pairing notes](docs/MAC_APP.zh-CN.md)).
- **Local Node bridge + Vite:** `npm start` (starts WebSocket bridge and studio server; requires **Node.js 24+**, **Xcode 27**, and **iOS 27** for the native ARKit companion).
- **Docs & specs:** [Setup guide](docs/QUICKSTART.zh-CN.md) · [iPhone build details](ios/README.md) · [Product goal](docs/PRODUCT_GOAL.md) · [Architecture](docs/ARCHITECTURE.md) · [Roadmap](ROADMAP.md) · [S2.1 evidence](docs/ELASTIC_TRAY.md)

## Development and verification

```sh
npm run check
npx tsc -p worker/tsconfig.json --noEmit
swift test --package-path ios
```

- GitHub repository: <https://github.com/Popcornnnnnnnn/phone-3d-ui-studio>
- Delivery board: <https://github.com/users/Popcornnnnnnnn/projects/3>
- Issues: <https://github.com/Popcornnnnnnnn/phone-3d-ui-studio/issues>
