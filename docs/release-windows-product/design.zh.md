# Windows 0.1.0 发布

[English](design.md) | 中文

本参考文档说明 Windows 原生预览版分发方案。一体化产品已经合入 main；本次验收 Windows x64，并将其加入同一 0.1.0 Release。

```mermaid
flowchart LR
  Source[Exact Git commit] --> Runner[Windows x64 runner]
  Runner --> Runtime[Bundled Harness runtime]
  Runtime --> Installer[Unsigned NSIS installer]
  Installer --> Install[Fresh installation]
  Install --> Smoke[Launch and restart verification]
  Smoke --> Assets[Checksummed Release assets]
```

手动工作流检出触发时的提交，验证产品版本 0.1.0，构建原生依赖及桌面端，再将实际 NSIS 产物安装到临时目录。已安装应用必须在 PATH 没有外部 Node 的环境启动内置后端，并在首次启动和重启后显示产品界面。报告不记录凭证或含令牌的 URL。Release 明确说明未签名预览版的限制。

变更文件包括 release/manifest.json、.github/workflows/product-release.yml、scripts/product-release.mjs、Windows 安装验收脚本及相关测试。产品 README、安装指南及发行说明介绍 Windows 下载方式。本次无需变更产品 API。Windows 元数据文件名包含目标平台，以便与已有 macOS 产物共存。各平台分别记录准确的源码提交和附件哈希。

验证范围包括收集器拒绝路径、工作流配置、Windows 原生编译、已安装应用启动及重启、产物哈希与 Release 下载可用性。本地执行相关测试、lint、文档检查以及推送前的两项 Ruff 检查。按照用户授权，先发布，再将 Windows 补充变更合入远程 main。
