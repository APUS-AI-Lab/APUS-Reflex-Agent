# APUS Reflex Harness 0.1.0

Model-as-a-Harness · 瞬时执行，深度思考。

Tag / 标签：`v0.1.0`. GitHub prerelease / GitHub 预发布；unsigned preview / 未签名预览版；Windows addition pending native installation and launch validation / Windows 新增附件待原生安装与启动验收。

This integration brings the desktop client into `frontend/` of the existing Harness repository, merging frontend and backend configuration, builds and packaging. The installer bundles the backend; users do not install or start a separate service. The Windows addition remains pending native installation and launch validation before publication; existing macOS assets remain unchanged. Configure your own model in Settings → Models. Configure an optional decision service in Settings → Reflex model configuration. Connection tests do not automatically enable routing, supervision or memory.

本次以前后端合并的一体化仓库交付：保留原 Harness 为主仓，客户端纳入 `frontend/`，统一配置、构建与打包。安装包内置后端，无需额外安装或启动服务。Windows 新增附件须通过原生安装与启动验收后发布，现有 macOS 附件保持不变。普通任务在“设置 → 模型”填写自己的模型服务；可在“设置 → Reflex 模型配置”接入决策服务。连接测试不会自动启用路由、监督或记忆。

Access / 下载权限：the repository is currently private; repository access is required until an administrator makes it public / 仓库当前私有，管理员公开前需有仓库访问权限。

- Targets / 平台：macOS Apple Silicon (arm64), plus Windows x64 NSIS installer pending qualification / 保留 macOS arm64，新增待验收的 Windows x64 NSIS 安装包。
- Signing / 签名：unsigned; macOS not notarized, Windows without code signature / 未签名；macOS 未公证，Windows 无代码签名，系统可能提示未知发布者或阻止打开。
- Runtime / 运行时：bundled; no Git, Node.js or separate backend installation / 已内置，无需安装 Git、Node.js 或单独后端。
- Models / 模型：bring your own provider and credentials; inference may send task data to that service / 需自行配置模型与凭证，推理可能向所选服务发送任务数据。
- Updates / 更新：manual replacement; keep existing application data / 手动更新并保留已有应用数据；自动更新尚未开启。

For macOS, download the existing DMG or application ZIP and use its `SHA256SUMS`, `build-info.json` and `LICENSES.zip`. For Windows, choose the x64 NSIS `.exe` when published; its companion files are `SHA256SUMS-win32-x64`, `build-info-win32-x64.json`, `runtime-dependencies-win32-x64.json` and `LICENSES-win32-x64.zip`. Each platform records its own build commit and preserves original license notices.

macOS 继续使用现有 DMG/应用 ZIP 及其 `SHA256SUMS`、`build-info.json`、`LICENSES.zip`。Windows 发布后选择 x64 NSIS `.exe`，配套文件为 `SHA256SUMS-win32-x64`、`build-info-win32-x64.json`、`runtime-dependencies-win32-x64.json` 与 `LICENSES-win32-x64.zip`。各平台分别记录构建提交并保留原始许可声明。

Installation and configuration / 安装与配置：[guide](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/blob/main/docs/feat-integrated-product/installation.md) · [中文教程](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/blob/main/docs/feat-integrated-product/installation.zh.md).

Intel Mac, Linux and signed stable distributions are outside this Windows addition. Web runs from source, not a standalone installer. Configuration is necessary; the first task with a real model has not been validated. Installation and launch checks do not establish model-task success.

本次 Windows 新增交付不包含 Intel Mac、Linux 或正式签名稳定版。Web 通过源码启动，不是独立安装包。必须自行配置模型；真实模型首个任务尚未验证，安装启动通过不代表模型任务通过。
