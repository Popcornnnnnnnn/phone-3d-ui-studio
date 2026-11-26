# Mac App 预览

电脑端现在可以使用原生 Mac 窗口，连接面板和二维码由 SwiftUI 提供，3D 场景继续由 WKWebView 内的现有 Web 渲染器提供。本地桥接和物理模拟随 App 启动，退出 App 时关闭。第一版是混合架构。

## 构建和打开

构建机器需要 Apple Silicon Mac、Xcode Command Line Tools、Node 24+，以及 `npm ci` 安装的依赖：

```sh
npm run app:build:local
open "build/macos/Phone 3D Studio.app"
```

构建脚本下载并校验固定版本的官方 Node 24.21.0，随 App 打包生产页面、桥接和运行依赖。使用打包后的 App 不需要另装 Node、npm 或保留项目目录。本机的 `app:build:local` 会复制现有的 `public/local-assets/iphone-17/iphone-17-black.glb`，这个个人使用版本不用于分发。公开构建使用 `npm run app:build`，不包含私有模型，并在界面提示使用简化模型。

此构建目标为 **Apple Silicon / macOS 14+**，只经过本机验证。当前产物使用本地 ad-hoc 签名；它不是经过 Developer ID 签名、公证的公开安装包。跨机器公开分发仍需完成签名、公证和独立机器验证。

## Mac 界面

**Phone 3D Studio → Settings…**（⌘,）提供 **System / Light / Dark**，选择会保存，并同时改变原生界面和内嵌工作区；切换外观不会刷新页面或重启正在进行的回合。主工作区保留 3D 场景，右侧参数区独立滚动。

**Expand view** 在当前窗口内展开场景，按 Esc 返回，保留回合和相机状态。应用真正进入后台、显示状态不再新鲜或手机追踪中断时，仍会按原有规则暂停并要求重新标定。

界面遵循用户指定的 Mac UI System 中的英文默认语言、明暗外观、悬停反馈和布局对齐约定；只参考 [SwiftUI macOS App Template](https://github.com/SohrabZ/swiftui-macos-app) 的外观设置及原生窗口控件模式，没有引入模板的自动更新、登录启动或额外依赖。

## 手机连接

1. 在 iPhone 安装本项目最新构建。手机端仍要求 iOS 27 / Xcode 27 和自己的开发签名；目前没有 TestFlight 安装链接。
2. Mac 打开 App，点击 **Connect iPhone**。
3. iPhone 打开 **Mac connection → Scan QR code**，扫描 Mac 窗口中的码。也可点 **Enter address** 手动输入。
4. 地址保存后，手动点击 **Start tracking**。按系统提示允许 Camera 和 Local Network。
5. 手机显示已连接、追踪正常后，保持屏幕朝上、顶部朝向 Mac，后置相机对着有纹理且光线充足的表面。Mac 在 **Marble** 点击 **Start round**；在 **Tracking** 点击 **Set origin**。

地址保存在 iPhone 上，空间追踪和 App 内 ScreenCaptureKit 投屏共用。配对前会停止当前会话，保存地址不会自动启动摄像头或追踪。系统 Camera 也可扫描 `phone3dstudio://pair?bridge=...` 链接。

Mac App 重开本地会话时优先复用上次成功的桥接端口，不接管开发模式的现有服务。原端口或相邻帧端口被占用时会新建会话并提示重新扫码；Mac 的网络地址集合变化时会提示核对，手机若无法连接就扫描当前二维码。**保存的地址不代表已连接**，手机仍需手动点击 **Start tracking** 或 **Start sharing**。多网卡机器在连接面板选择与手机同网段的地址。两端使用同一可信局域网；二维码只用于设置连接地址，目前没有身份认证或加密配对。

Marble 因追踪受限、切后台、断连或状态超时暂停时，先恢复手机追踪，再在 Mac 点击 **Restart round**。重开会重新标定并清空旧球；不会自动恢复物理。Mac 的 **Screen mirroring → Choose local video** 会打开系统文件面板，取消选择不会替换当前画面。精细模型缺失时界面会提示正在显示简化模型。

Mac 内嵌的 WKWebView 默认为 H.264 投屏选择现有的硬件解码、AVCC 帧格式和 8 帧 / 250 ms 启动窗口；浏览器网页仍使用原来的软件解码默认值。无窗口 WKWebView 用本项目编码器生成的 960 × 2088 样本验证了首帧输出，实际 iPhone 无线画面和其他尺寸仍需现场验收。显式 `decoder` 参数可覆盖 Mac 默认值。

iOS 27 手机端使用 App 内的 ScreenCaptureKit 投屏。旧 ReplayKit 广播扩展在该系统版本已不受支持，因此不再随 App 安装。

## 机型范围

| 机型 | 配置 | 验证边界 |
| --- | --- | --- |
| iPhone 17 | 保留原有外观和尺寸 | 物理精度和无线验收仍待完成 |
| iPhone 16 | 机身 / 屏幕尺寸、碰撞范围、简化外观 | 软件验证；没有实机接球验收 |
| iPhone 16 Plus | 机身 / 屏幕尺寸、碰撞范围、简化外观 | 软件验证；没有实机接球验收 |
| 其他或旧版客户端未上报机型 | 明确显示 iPhone 17 回退配置 | 不声明准确适配 |

App 会报告实际硬件型号，桥接选择统一配置供追踪、物理和渲染使用。16 系列屏幕毫米数由 Apple 的分辨率和 460 ppi 推算；相机到机身的偏移、屏幕圆角及简化外观仍为近似值。识别出型号不等于完成实机验证。

现有投屏接口依赖 iOS 27，所以本次没有只改最低系统版本号来宣称支持旧系统。降低最低系统版本需要隔离投屏能力并单独验证空间模式。

## 验证

```sh
npm run check
swift test --package-path ios
npm run app:build:local
npm run app:smoke -- --with-local-model
```

发给外部体验者之前，还需在独立 Mac 和另一款实机上验证：安装、扫描配对、连续五分钟无线操作、十次接触、三次落地后补球，以及切后台 / 断连后的恢复。渲染测试、合成手机输入和构建通过都不能替代这些检查。

本机精细模型构建的完整性检查：`npm run app:smoke -- --with-local-model`。检查会核对打包的 GLB 与原文件一致，并验证本地加载和会话退出。

## 构建产物清理

安装后检查本项目的 Mac 与 iOS 两类应用标识及残缺的同名 `.app` 目录，范围包括项目构建目录、Xcode DerivedData、测试产物、回退备份和废纸篓。Mac 主应用保留；确认无用的 iPhone/模拟器构建及回退副本直接清理，不再长期保存逐版本压缩包，避免被桌面搜索收录。只清理本项目的注册项，不重建全局应用数据库，不为检查启动器结果切换用户焦点。

2026-09-29：历史 iPhone/模拟器构建归档及映射已按用户要求清理。历史文档中的旧 `.app` 路径不再可用；已安装到手机上的 App 不受本机产物清理影响。
