# Intel Mac 发布

[English](design.md) | 中文

本文说明 APUS Reflex Harness 的 Intel Mac 预览版验收。原生 x64 构建采用[官方 runner 镜像](https://github.com/actions/runner-images/blob/main/README.md)列出的 `macos-15-intel`；Apple Silicon 继续使用 `macos-15`。

```mermaid
flowchart LR
  Source[Dispatch commit] --> Runner[Native Intel Mac]
  Runner --> DMG[Checksummed DMG and ZIP]
  DMG --> Copy[Independent installed application]
  Copy --> Smoke[Fresh profile and restart]
  Smoke --> Review[Reports and manual publication]
```

手动工作流在现有目标之外接受 `mac-intel`，检出触发时的提交，并在匹配架构上构建锁定的原生运行时。收集器保留 Apple Silicon 元数据文件名；Intel Mac 元数据采用 `-darwin-x64` 后缀，使两个架构可共存于一个 Release。本批不改变产品 API 或持久化数据。

安装验收命令接受 `--installer <absolute DMG>` 和 `--report-dir <absolute directory>`。它根据收集的元数据校验 DMG，只读挂载后将应用复制到私有临时安装目录，并在启动前卸载磁盘映像。已安装运行时必须匹配干净源码提交和原生架构。全新配置目录及仅含系统命令的 PATH 排除开发环境 Node 和继承的凭据。首次启动、产品版本展示、退出与重启生成截图及长度受限的脱敏报告。验收不涵盖公证、Gatekeeper 信任或真实模型 API 请求。

本批文件包括 release/manifest.json、.github/workflows/product-release.yml、scripts/product-release.mjs 及其测试、scripts/product-macos-smoke.mjs 及其测试和本设计双语文档。现有 Windows 验收保持不变。定向检查覆盖元数据冲突、错误安装身份、凭据隔离和工作流目标选择；原生 CI 执行实际 DMG 安装和界面验收。工作流以仓库只读权限上传审查产物，不自动公开 Release。

下一批候选是包含启动命令和持久化数据配置的 Web 全栈分发包。现有部署 Dockerfile 仅构建源码，没有定义面向公众的可启动镜像。Linux 桌面验收还需增加 Linux 安装器目标和原生界面检查；两者均不在 Intel Mac 发布承诺中。
