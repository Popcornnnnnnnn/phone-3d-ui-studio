# Phone 3D UI Studio

[English](README.md) · **简体中文**

**零安装浏览器在线游乐场（手机陀螺仪 / 桌面摇杆）+ 内置交互式 3D UI 演示 + 本地 Mac 与 iPhone ARKit 6DoF 空间交互（Pro）。**

## 零安装在线游乐场（Web Playground）

访客无需 Xcode 或安装 App，打开网页即可直接体验：

- **桌面在线游玩（Play Online）：** 拖动 **Tilt Pad**（或使用方向键/`WASD` 倾斜、`Space` 抛球、`B` 补球、`R` 重置），由浏览器端 **120 Hz Rapier WASM 物理引擎**（`shared/marbleWorld.mjs`）实时驱动。
- **手机扫码配对（`?pair=<CODE>`）：** 用 iPhone 或 Android 手机浏览器扫描页面上的二维码，通过 **3DoF 陀螺仪姿态**与**上甩加速度抛球**，经 **WebRTC DataChannel**（并支持 `/api/room/:code` WebSocket 中继自动回退）实时控制桌面 3D iPhone。
- **手机端单机模式（Solo Mode）：** 手机直接打开网页即可进入全屏 **Elastic Tray** 游玩界面，内置手持姿态校准、触控拖拽回退、Web Audio 音效反馈，并可随时输入 6 位房间码与桌面配对。
- **交互式 3D UI 展台（3D UI Showcase）：** 内置 3 套实时 Canvas2D 交互屏幕（**Audio Deck**、**Weather Card**、**Stack Cards**，配对后可由手机远程控制与倾斜），同时保留 **Local MP4** 本地录屏预览。

### 本地运行与 Cloudflare 部署

```sh
npm ci
npm run dev -- --host 0.0.0.0   # 启动 Vite 开发服务器及 /api/room/:code 房间中继
npm run build:public            # 构建 dist/ 并移除私有 public/local-assets/
```

线上部署采用单域名 **Cloudflare Workers Static Assets + Durable Object（`RoomRelay`）**，配置见 [`worker/wrangler.toml`](worker/wrangler.toml) 与 [`worker/src/index.ts`](worker/src/index.ts)（目标域名 `https://phone3d.popcornnn.xyz`），并通过 [`public/.assetsignore`](public/.assetsignore) 排除 `local-assets/`。

---

## 本地 ARKit 6DoF（Pro）与原生 Mac 预览

在局域网下，真机 iPhone 可作为共享三维空间中的 6DoF 托盘：轻抬抛起小球、移动接住，并在落地后于手机端点击 **Add ball** 补球。

**开发者预览边界：** 原生 Mac 应用内嵌本地桥接与扫码面板，使用本地 ad-hoc 签名；跨机器公开分发、App Store 公证以及真机 5 分钟无线连续性验收仍待完成。iOS 原生 ARKit 6DoF 伴侣构建仍需 Xcode 27 与个人开发签名。

- [Mac 安装、配对与验证边界](docs/MAC_APP.zh-CN.md)
- [中文首次安装指南](docs/QUICKSTART.zh-CN.md) · [iPhone 构建说明](ios/README.md) · [发布准备度](docs/RELEASE_READINESS.md)
- [S2.1 体验与验收记录](docs/ELASTIC_TRAY.md) · [产品目标](docs/PRODUCT_GOAL.md) · [空间架构](docs/ARCHITECTURE.md)

### 空间交互脚本演示

![S2.1 脚本演示：轻抬托盘抛起小球，小球通过物理碰撞重新落回托盘。](docs/media/toss-and-catch.gif)

<table>
<tr>
<td width="50%"><strong>空间中的手机</strong><br />在共享三维空间中移动和旋转。</td>
<td width="50%"><strong>没接住？再加一个继续</strong><br />添加新的活动小球，旧球仍留在地面上。</td>
</tr>
<tr>
<td><a href="docs/media/spatial-movement.gif"><img src="docs/media/spatial-movement.gif" alt="在 Web 空间中移动和旋转手机的脚本演示。" width="100%" /></a></td>
<td><a href="docs/media/land-and-add.gif"><img src="docs/media/land-and-add.gif" alt="小球从侧面开口落到地面，并在手机上添加新球的脚本演示。" width="100%" /></a></td>
</tr>
</table>

> 媒体说明：上述 GIF 为脚本渲染演示，不作为实机无线可靠性证据（见 [docs/media/README.md](docs/media/README.md)）。

## 开发与验证

```sh
npm run check
npx tsc -p worker/tsconfig.json --noEmit
swift test --package-path ios
```

- GitHub 仓库：<https://github.com/Popcornnnnnnnn/phone-3d-ui-studio>
- 交付看板：<https://github.com/users/Popcornnnnnnnn/projects/3>
