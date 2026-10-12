# 安装 APUS Reflex Harness

[English](installation.md) | 中文

本教程介绍如何选择桌面安装包、安装及更新。Windows 预览安装包正在准备中，通过原生安装与启动验收并发布后才可下载；现有 macOS arm64 附件不变。

## 下载

仓库当前为私有，查看与下载 Release 需要仓库访问权限；预发布状态本身不会开放匿名访问。

打开[产品 Releases](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/releases)，阅读所选版本支持的平台、架构、签名状态和已知限制。选择客户端附件，不要下载 GitHub 自动生成的源码压缩包作为安装包。该版本仅支持附有安装包并通过验收的平台。

`0.1.0` 的目标为 macOS Apple Silicon 与 Windows x64。macOS 使用现有 DMG/应用 ZIP；新增 Windows 安装包采用 NSIS `.exe`，为未签名预览版。Windows 附件须先通过原生安装与启动验收；真实模型首个任务尚未验证。Intel Mac 与 Linux 不在本次 Windows 交付范围内。

## 安装与打开

1. 下载安装包和发行校验文件。打开之前，将下载文件的 SHA-256 摘要与公布值进行比较。
2. Windows：下载 x64 NSIS `.exe` 安装包，运行安装向导，再从开始菜单或安装目录启动 APUS Reflex Harness。校验文件使用 `SHA256SUMS-win32-x64`。
3. macOS：打开 DMG，将 APUS Reflex Harness 拖入 Applications，再从 Applications 启动；使用现有 `SHA256SUMS` 核对附件。
4. 按[模型配置教程](configuration.zh.md)操作，选择工作区并发送一个小任务。应用会自动启动自带的后端。

Windows 安装包没有代码签名，SmartScreen 可能提示未知发布者；macOS 预览版没有 Apple 签名或公证保证，也可能被阻止打开。确认来源和校验值后，如决定继续，请使用系统提供的单个应用批准流程，不要全局关闭系统保护。签名状态以具体发行版为准，构建成功不能证明已签名。

应用包含运行时，无需安装 Git、Node.js 和 pnpm。模型服务仍需要网络及你自己的凭证；可选工具可能有额外要求。

Web 通过[源码开发入口](development.zh.md)启动，不是独立可下载的安装包。安装启动通过不等于模型任务通过；完成服务商、凭证和模型配置后，请先运行一个小任务验证。

## 更新

退出应用，下载下一个兼容版本；Windows 运行新版安装器，macOS 替换已安装应用。当前禁用应用自动更新。设置和会话存储在应用目录外；安装带迁移或兼容性警告的版本之前，请先备份数据。降级前请阅读对应版本的恢复说明。

## 排查问题

如果没有适合你平台的安装包，请在受支持环境中[从源码开发](development.zh.md)，或等待经过验收的安装包。Releases 页面为空不代表源码压缩包可以直接安装。

启动失败时，保留界面错误和诊断信息，不要首先清空 Profile 或会话。通过 [Issues](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/issues) 提供应用版本、操作系统、架构和脱敏后的错误；不要附上凭证或未经检查的用户数据目录。
