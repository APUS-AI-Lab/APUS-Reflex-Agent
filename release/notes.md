# APUS Reflex Harness 0.1.8-beta.1

Model-as-a-Harness · 瞬时执行，深度思考。

This preview combines the desktop client and Harness in one repository and installer. Configure your own model in Settings → Models. Optional Settings → System3 configures Jev routing with explicit credentials and data approval; it is off by default.

本预览版整合桌面客户端与 Harness。普通任务在“设置 → 模型”填写自己的模型服务；可选的“设置 → System3”配置 Jev 选路、凭证和数据授权，默认关闭。

- Target / 平台：macOS Apple Silicon (arm64).
- Signing / 签名：unsigned preview, not notarized / 未签名、未公证预览版，macOS 可能阻止首次打开。
- Runtime / 运行时：bundled; no Git, Node.js or separate backend installation / 已内置，无需安装 Git、Node.js 或单独后端。
- Models / 模型：bring your own provider and credentials; inference may send task data to that service / 需自行配置模型与凭证，推理可能向所选服务发送任务数据。
- Updates / 更新：manual replacement; keep existing application data / 手动更新并保留已有应用数据；自动更新尚未开启。

Download the DMG installer or ZIP application. `SHA256SUMS` verifies the files; `build-info.json` identifies the exact product commit, and `LICENSES.zip` contains original notices also included inside the application.

下载安装 DMG 或 ZIP 应用。`SHA256SUMS` 提供文件校验，`build-info.json` 标明构建提交，`LICENSES.zip` 保留完整许可声明，安装包内也有对应入口。

Installation and configuration / 安装与配置：[guide](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/blob/main/docs/feat-integrated-product/installation.md) · [中文教程](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/blob/main/docs/feat-integrated-product/installation.zh.md).

Windows, Intel Mac and signed stable distributions are not included in this preview. This draft must pass installation and first-task acceptance before publication.

本预览版不包含 Windows、Intel Mac 或正式签名稳定版。发布此草稿前须完成安装与首次任务验收。
