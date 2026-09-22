# Phone 3D UI Studio

[English](README.md) · **简体中文**

一个可复用的桌面工作室，用可控制的 3D 手机展示手机界面，并提供相机预设、灯光、背景和录制能力。在内容制作 MVP 稳定后，项目还计划加入实时屏幕与设备姿态同步。

## 空间交互演示

下面展示新的 **S2.1 Elastic Tray** 体验：在空间中移动手机，轻轻抛起小球、接住它；如果没有接住，可以再添加一个新球。

这些内容是**脚本渲染**，使用项目自有的手机模型和 Rapier 物理引擎。手机画面是同一世界状态的投影视图。它们用于说明交互设计，不是摄像机实拍、实时网络录制，也不能作为无线连接可靠性的证据。

**体验开发者预览：**[S2.1 Release](https://github.com/Popcornnnnnnnn/phone-3d-ui-studio/releases/tag/v0.2.1-alpha.1) · [配置指南](https://github.com/Popcornnnnnnnn/phone-3d-ui-studio/blob/v0.2.1-alpha.1/docs/QUICKSTART.zh-CN.md) · [空间交互实现](https://github.com/Popcornnnnnnnn/phone-3d-ui-studio/pull/21)

空间交互预览位于独立分支；默认 `main` 分支仍然是下文介绍的工作室基线。实际游玩需要一台 iPhone，并使用自己的 Xcode 签名。

### 轻轻抬起，真正接住

托盘移动提供能量。同一个小球会离开手机屏幕、上升到 Web 三维世界中，然后再次与托盘发生物理碰撞。

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

### 调到合适的手感

可以调整移动比例、小球直径和弹性。下面的每个预设都会像应用中的 **Apply & restart** 一样开始新一轮游戏。

![移动比例、小球直径和弹性的三种回合预设脚本对比。](docs/media/play-settings.gif)

[媒体详情与限制](docs/media/README.md)

---

- GitHub 仓库：<https://github.com/Popcornnnnnnnn/phone-3d-ui-studio>
- 交付看板：<https://github.com/users/Popcornnnnnnnn/projects/3>

## 工作室基线状态

- 已验收：M0 项目基础；M2 屏幕视频垂直切片
- 进行中：M1 iPhone 17 视觉重做候选；之前只基于几何结构的验收已重新打开
- 基线开始时间：2026-09-02
- 内容制作 MVP 目标时间：2026-09-18
- 实时同步候选版本目标时间：2026-10-09
- 目标验收时间：2026-10-12
- 当前评审项：[M1 — 重新校准 iPhone 17 资产的视觉表现](https://github.com/Popcornnnnnnnn/phone-3d-ui-studio/issues/2)
- M1 视觉验收后的下一项 M2 工作：[可复用工作室和相机预设](https://github.com/Popcornnnnnnnn/phone-3d-ui-studio/issues/5)

排期假设由一名主要开发者完成，测试时可使用 Mac 和 iPhone，并且不要求发布到 App Store。估算、质量门槛和验收标准见 [PROJECT_PLAN.md](PROJECT_PLAN.md)。

## 产品边界

项目明确区分两个交付目标：

1. **内容制作 MVP**：在 3D 手机上播放预先录制的手机屏幕视频，提供可复用的工作室预设、相机运动和录制能力。
2. **实时同步扩展**：实时传输手机屏幕，并同步真实设备方向。

第一个目标本身具有独立价值，不需要等待 iOS 实时采集限制被完全解决。

## 仓库结构

```text
docs/                  架构与决策记录
src/model/             校准后的设备尺寸与测试
src/scene/             Three.js 模型与工作室场景
.github/               Issue 模板与项目自动化元数据
PROJECT_PLAN.md        排期、里程碑、工作量、风险和验收门槛
ROADMAP.md             按日期组织的交付检查点
```

当前应用包含一个原创的程序化 iPhone 17 黑色参考模型、可独立控制的屏幕网格、确定性的正反面评审视图、三种视觉预设、模拟运动、轨道控制，以及明确的屏幕和姿态来源接口。

用户可以选择本地视频，将其播放、暂停、重置，并通过保持比例的竖屏/横屏 contain 模式映射到手机屏幕。已确认尺寸和近似边界记录在 [docs/references/iphone-17-black.md](docs/references/iphone-17-black.md)。实时采集、相机时间线、最终场景录制和项目状态保存尚未实现。

## 本地开发

需要 Node.js 24 或更高版本。

```bash
npm install
npm run dev
```

本地工作室运行在 <http://127.0.0.1:4317>。运行 `npm run check` 执行完整验证。

## 工作规则

- 将源代码、生成媒体、采集的手机内容、密钥和构建缓存分开保存。
- 不得提交个人手机屏幕、签名材料、Provisioning Profile、`.env` 文件或录制内容。
- 本地视频选择使用内存中的 Object URL；应用不会复制、上传或序列化所选文件路径。
- 视觉上逼真的渲染不能证明实时采集或姿态同步已经可用。
- 每个里程碑只有在对应 GitHub Issue 中记录验收结果后才算完成。
