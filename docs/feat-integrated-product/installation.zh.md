# 安装 APUS Reflex Harness

[English](installation.md) | 中文

本教程介绍如何选择桌面安装包、安装及更新。一体化预览版正在准备中；未发布的安装包目前无法下载。

## 下载

打开[产品 Releases](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/releases)，阅读所选版本支持的平台、架构、签名状态和已知限制。选择客户端附件，不要下载 GitHub 自动生成的源码压缩包作为安装包。该版本仅支持附有安装包并通过验收的平台。

首个预览版面向 macOS Apple Silicon，正在准备未签名构建；签名和公证尚未配置。Intel Mac、Windows 和 Linux 是否可用，须以各自的发行附件及验收为准；存在构建脚本不等于已经支持。

## 安装与打开

1. 下载安装包和发行校验文件。打开之前，将下载文件的 SHA-256 摘要与公布值进行比较。
2. 对于 macOS DMG，打开磁盘映像，将 APUS Reflex Harness 拖入 Applications，再从 Applications 启动。
3. 按[模型配置教程](configuration.zh.md)操作，选择工作区并发送一个小任务。应用会自动启动自带的后端。

未签名预览版不具备 Apple 签名或公证保证，macOS 可能阻止打开。确认来源和校验值后，如决定继续，请使用系统提供的单个应用批准流程，不要全局关闭系统保护。签名状态以具体发行版为准，构建成功不能证明已签名。

应用包含运行时，无需安装 Git、Node.js 和 pnpm。模型服务仍需要网络及你自己的凭证；可选工具可能有额外要求。

## 更新

退出应用，下载下一个兼容版本并替换已安装的应用。当前禁用应用自动更新。设置和会话存储在应用目录外；安装带迁移或兼容性警告的版本之前，请先备份数据。降级前请阅读对应版本的恢复说明。

## 排查问题

如果没有适合你平台的安装包，请在受支持环境中[从源码开发](development.zh.md)，或等待经过验收的安装包。Releases 页面为空不代表源码压缩包可以直接安装。

启动失败时，保留界面错误和诊断信息，不要首先清空 Profile 或会话。通过 [Issues](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/issues) 提供应用版本、操作系统、架构和脱敏后的错误；不要附上凭证或未经检查的用户数据目录。
