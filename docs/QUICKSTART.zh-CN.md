# 首次安装：S2.1 开发者预览

当前可以从源码运行；普通体验者还不能下载即玩。iPhone App 需要 Xcode 编译、自己的签名和首次设备安装，尚无 TestFlight 入口。Web 自带程序生成的手机模型，不需要私有 GLB。

## 准备环境

- Mac，Node.js 24 或更新版本，npm。
- **iOS 27 真机 iPhone**、**Xcode 27**（iOS 27 设备 SDK）、XcodeGen。当前完整 App 的 ScreenCaptureKit 支线使整个工程仍要求该版本；不能根据 ARKit 本身的最低版本推断 App 兼容性。当前目标不能使用模拟器构建。
- Mac/iPhone 同一可互访的局域网；首次安装可以使用 USB。
- 仓库访问权限。当前 GitHub 仓库仍为私有，上传不自动向所有人开放。

## 启动 Mac

```sh
git clone --branch codex/elastic-tray https://github.com/Popcornnnnnnnn/phone-3d-ui-studio.git
cd phone-3d-ui-studio
npm ci
npm start
```

在 Mac Chrome 打开终端打印的 **Studio ready** 链接。默认 Web 4317，空间 WebSocket 4319，投屏帧端口 4320。Ctrl+C 同时停止两个服务。

端口冲突可改用：

```sh
PHONE_STUDIO_PORT=17317 PHONE_BRIDGE_PORT=17319 PHONE_BRIDGE_FRAME_PORT=17320 npm start
```

终端 iPhone 候选地址可能包含 VPN/虚拟网卡；选择与手机 Wi-Fi 同一网段的 Mac 地址，可在 macOS 网络详情核对。`127.0.0.1` 只供 Mac 浏览器使用，不能作为手机连接 Mac 的地址。

## 安装 iPhone App

1. 修改 `ios/project.yml` 中两个目标的 `LiveBridgeURL`，使用 Mac 地址，例如 `ws://192.168.1.20:4319/?role=phone`。这里的 IP 必须替换，原工程的 `forge.local` 不是你的 Mac。
2. 将 `DEVELOPMENT_TEAM` 改成自己的 Team ID；必要时修改主 App 和扩展的 bundle identifier，扩展保留主 App ID 前缀。不要提交证书或 provisioning profile。
3. 运行：

   ```sh
   cd ios
   xcodegen generate
   open Phone3DUIStudio.xcodeproj
   ```

4. 在 **Xcode 27** 中选择主 App scheme、自己的 Team 和连接的真实 iPhone，然后 Run。首次按设备提示信任开发者、启用 Developer Mode。
5. 打开 **Phone 3D Studio → Spatial tracking → Start tracking**，允许相机和本地网络访问。

现有开发签名 `.app` 不能作为所有人的通用安装包。首次安装后可以拔掉 USB 使用 Wi-Fi。若 Mac IP 改变，当前 App 需要改地址并重新构建；尚未提供二维码配对或 App 内地址设置。

## 开始玩与调参

- 屏幕朝上、顶部朝向 Mac，后摄面对有纹理、光照足够的表面，等待 Web Ready。
- 在 **Play settings** 调整位移比例、直径和弹性，然后 **Start round**。初始位置在参考网格上方 20 cm，这是展示约定。
- 默认位移 50%：真实平移 20 cm 对应虚拟 10 cm，旋转不缩放。托盘的平移速度也相应减小，轻颠的能量随之减小；程序不会自动补足弹起高度。
- 改参数后 **Apply & restart** 才生效：清除旧球、重新设原点，保留观察视角。设置由桥接持有，后来的观察页面会看到当前值；重启桥接恢复默认。
- 球落地后在手机上 **Add ball**。Web 鼠标平移/缩放仅改变观察相机，不改变物理位移比例。全屏和 Esc 由体验者操作。

## 常见状态

| 表现 | 含义与处理 |
| --- | --- |
| Waiting for iPhone | 检查地址、端口、同网和本地网络权限，保持 App 前台 |
| 纹理不足 | 连接可能还在；后摄对准书页等纹理，恢复后重新开始 |
| Display paused / reconnecting | 位姿或快照回执超时；冻结并要求新回合，不自动续算 |
| 球出界 | 仅结束当前球，允许补球；不会主动断开网络 |
| 程序生成的手机外观 | 正常；私有精细模型不随仓库发布 |

无线五分钟体验、不同设备验证、S1 精度与外参尚未验收。软件测试不代表这些实体验收已通过。
