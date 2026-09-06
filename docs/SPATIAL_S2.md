# S2：一颗弹珠双屏往返

状态：**原型可体验，正式验收待完成**。本轮获准先行开发 S2；S1 尚未完成的精度、恢复与投屏真机验收继续保留，不由自动测试替代。

## 现在如何体验

1. 用 USB 连接 iPhone 与 Mac，解锁手机，打开 **Phone 3D Studio**。选择 **Spatial tracking → Start tracking**，保持 App 前台。
2. 打开本轮入口：<http://127.0.0.1:15317/?experience=marble>。页面连接本机 4319 桥接。若显示需要 S2 App，请确认已安装本轮版本；若显示 Waiting，等待追踪和时钟同步正常。
3. 手机悬空、屏幕朝上、灵动岛朝 Mac，后摄对准有纹理且光线充足的表面。点击 **Start round**：此时设置本轮原点，手机自动进入竖屏弹珠画布。
4. 慢慢降低手机右边缘，让球从右侧中央出口滚出。球会落到 Web 地面，稳定后 **Return** 才可点击。
5. 点击 **Return**，把手机恢复到最初的接球区，尽量保持屏幕朝上。球约 1.5 秒后下降经过固定目标；绿色环标记接球中心。目标不会追随手机，接住依赖碰撞。成功后计数增加，手机轻震一次，可继续倾倒。
6. 接漏后等球落地再次 Return。越界时点 **Reset ball**。暂停、失联或后台恢复后须 **Recalibrate & restart** 开始新一轮。手机点 **Exit** 返回追踪界面；两端选择 Screen mirroring 可回到旧模式。

这是慢速交互演示：重力 1.5 m/s²，并非真实重力。第一次校准把机身放在虚拟地面上方 20 cm，仅是工作区约定。桌面并未被识别；相机到机身外参仍为模型几何近似。

## 已实现的边界

- 一颗半径 6 mm 的实色旋转标记球、浅槽、右侧中央 40 mm 出口、固定地面与初始接球位置。
- 桥接服务是唯一物理权威：固定 Rapier 0.20.0、120 Hz 步进、CCD、运动学手机。倒出和接回不更换刚体，不吸附、不瞬移；仅显式重置/重新校准允许重新摆放球。
- 快照至多 60 Hz，两端统一 50 ms 插值。无预测；失效时冻结，不集中补算失联时间。
- 首个开始本轮的 Web 页面拥有控制权，其余观察。控制页隐藏/断开会暂停；显式接管会重新校准。
- 版本化能力、世界命令和结果、完整快照、回执。重复命令、旧会话/轮次、乱序快照、重复震动被过滤。快照发送最多保留一份待回执和一份最新待发。
- Native Canvas 与 Web 共用相同投影定义，Web 屏幕纹理和空间球体互补裁剪。手机无需第二套物理，也不上传或保存追踪摄像头图像。
- 保留 S1 和投屏协议兼容性。原工作目录中的延迟、画质支线源码未搬动。

不包含五球、主动铲球、玻璃折射、显示器识别、无线优化，也未宣称实物碰撞精度。

## 本轮验证记录（2026-09-06）

| 证据层级 | 结果 | 实际边界 |
|---|---|---|
| 项目检查 | `npm run check` 通过：378 项测试、lint、TypeScript、生产构建 | 自动输入，不等于真机手感；构建仍提示既有大包体积 |
| 物理闭环 | 自动连续五次倾倒/Return/接回；同一刚体保持，另测接漏、挡板、越界 | 合成位姿和确定轨迹 |
| 协议恢复 | 控制权、重复命令、积压回执、250 ms 失效、断开与重新校准测试通过 | 自动验证 |
| Swift | 53 项测试通过；共享投影 fixtures、插值、旧轮次、断流、震动去重已覆盖 | macOS portable tests；不等于 iPhone Canvas 像素验收 |
| iPhone 构建 | Xcode 27 beta 签名真机构建成功，严格递归签名检查通过 | 构建和签名证据 |
| 实际 Web | 使用 S2 实施副本、独立 15319 桥接和标明 Synthetic 的输入，点击 Start/Return 完整接回，计数 1；主动暂停与 tracking limited 冻结、禁用开始已观察 | 实际浏览器渲染/控件；不是实物精度证据 |
| 安装与服务 | 新版安装到现有 iPhone App 成功；4319 桥接 LaunchAgent 已指向 S2 | 首次自动启动因手机锁屏被系统拒绝，需要用户解锁打开 |
| 实体验收 | **待完成** | 双端显示、旋转锁定与恢复、USB 实际路由、五次真实往返/一次接漏/中断、同框录像及 S1 补项尚未验收 |

私有证据放在忽略目录 `captures/spatial-s2/`：`project-check.log`、`swift-test.log`、`ios-build.log`、`install-result.json`、`launch-result.json`、`browser-catch-synthetic.jpg`、`browser-limited-synthetic.jpg`。切勿把合成截图标为真机演示。

`shared/fixtures/marble-frames.json` 同时被 Swift 与 Web 读取，覆盖球居中、出口边界、部分进入、屏幕前方及旋转/平移。该测试验证数学映射；出口逐帧像素与真实双屏同框仍需集中确认。

## 集中实体验收

不再反复徒手估距。一次 session 完成：

- 先补 S1 留存的受控精度、后台/遮挡/断连恢复和投屏启动检查。正式碰撞接受前测量相机到机身外参，记录当前几何近似的误差。
- 至少五次：倾倒 → 地面稳定 → Return → 移动接住。记录每轮结果及相同球 ID；不要用 Reset 代替接回。
- 故意移开手机接漏一次，确认无自动瞄准，球落地可再 Return。
- 遮挡后摄或切后台一次，确认双方冻结且有原因；恢复正常后重新校准，不突然追赶旧运动。
- 用另一台设备录制真实手机与电脑同框画面。软件时间戳与回执只能证明数据阶段，不能证明用户可见延迟。

数值记录可以在 Web → **World details → Record numeric telemetry** 开始，结束后下载。另可在本轮工作目录启动只读记录器（不抢控制权）：

```sh
node scripts/marble-record.mjs ws://127.0.0.1:4319 captures/spatial-s2/physical-session-new.jsonl
```

Ctrl-C 结束。文件必须不存在，以免覆盖既有证据。记录器收集原始相机位姿及校准后的完整世界快照；原生 Canvas 的像素结果仍以实拍为准。

## 实施副本与回退

- 基线：`6efefab1cc11195b4220aade2ba856338acc24ec`，S1 已提交版本。
- 分支：`codex/spatial-s2`。
- S2 工作目录：`/Users/forge/.codex/worktrees/spatial-s2/phone-3d-ui-studio`。
- S1 工作目录保留：`/Users/forge/.codex/worktrees/spatial-s1/phone-3d-ui-studio`。
- 原支线目录保留：`/Users/forge/Workspace/phone-3d-ui-studio`。
- S1 安装包：`captures/spatial-s2/rollback-s1/Phone3DUIStudio.app`，已保留签名校验与 SHA256 清单。
- 原桥接配置：`captures/spatial-s2/bridge-launchagent-before.plist`。回退时先停止当前 LaunchAgent，恢复此 plist，再 bootstrap；重新安装上述 S1 App，并回到 S1 的 14317 页面。只杀进程会被 KeepAlive 拉回当前配置，不能完成配置回退。

隔离复现浏览器（合成输入请勿接真实 4319 桥接）：

```sh
PHONE_BRIDGE_PORT=15319 PHONE_BRIDGE_FRAME_PORT=15320 npm run bridge
npm run dev -- --host 127.0.0.1 --port 15317 --strictPort
node scripts/spatial-fixture.mjs ws://127.0.0.1:15319 --marble
```

页面使用 `?experience=marble&bridge=ws%3A%2F%2F127.0.0.1%3A15319`。发送 fixture JSON 命令可改变位姿/追踪状态，页面始终标注合成来源。现有交付 Web 已在 15317 运行，无需再启动第二个 Vite。
