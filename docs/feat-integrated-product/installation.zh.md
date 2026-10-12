# 安装 APUS Reflex Harness

[English](installation.md) | 中文

本教程介绍如何选择桌面安装包、安装及更新。可用平台以所选 Release 实际附上的已验收安装包为准。

## 下载

仓库当前为私有，查看与下载 Release 需要仓库访问权限；预发布状态本身不会开放匿名访问。

打开[产品 Releases](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/releases)，阅读所选版本支持的平台、架构、签名状态和已知限制。选择客户端附件，不要下载 GitHub 自动生成的源码压缩包作为安装包。该版本仅支持附有安装包并通过验收的平台。

`0.1.0` 的目标为 macOS Apple Silicon（arm64）、macOS Intel（x64）、Windows x64、Ubuntu 24.04 x64 桌面及完整 Linux x64 Web 包，均从同一经过审查的干净源码提交构建。选择与操作系统及架构匹配的附件：macOS 使用 DMG/应用 ZIP，Windows 使用 NSIS `.exe` 安装包。这些都是未签名预览版，macOS 未公证。各平台发布前须通过原生安装、启动与重启验收；真实模型首个任务尚未验证。

## 安装与打开

1. 下载安装包和发行校验文件。打开之前，将下载文件的 SHA-256 摘要与公布值进行比较。
2. Windows：下载 x64 NSIS `.exe` 安装包，运行安装向导，再从开始菜单或安装目录启动 APUS Reflex Harness。校验文件使用 `SHA256SUMS-win32-x64`。
3. macOS：选择 Apple Silicon 或 Intel DMG，将 APUS Reflex Harness 拖入 Applications，再从 Applications 启动；Apple Silicon 附件使用 `SHA256SUMS` 校验，Intel 附件使用 `SHA256SUMS-darwin-x64`。
4. Ubuntu 24.04 x64：使用 `SHA256SUMS-linux-x64` 校验，再运行 `sudo apt install ./apus-reflex-harness-linux-x64.deb` 安装，从应用菜单打开 APUS Reflex Harness；其他 Linux 发行版尚未验收。
5. Linux x64 Web：使用 `SHA256SUMS-web-linux-x64` 校验，解压 `apus-reflex-harness-web-linux-x64.tar.gz` 后在其目录运行 `./start.sh`，打开启动器输出的带认证信息的 localhost 链接，不要分享该链接。端口及数据目录配置见 [Web 教程](../release-web-runtime/README.zh.md)。
6. 按[模型配置教程](configuration.zh.md)操作，选择工作区并发送一个小任务。应用会自动启动自带的后端。

Windows 安装包没有代码签名，SmartScreen 可能提示未知发布者；macOS 预览版没有 Apple 签名或公证保证，也可能被阻止打开。确认来源和校验值后，如决定继续，请使用系统提供的单个应用批准流程，不要全局关闭系统保护。签名状态以具体发行版为准，构建成功不能证明已签名。

应用包含运行时，无需安装 Git、Node.js 和 pnpm。模型服务仍需要网络及你自己的凭证；可选工具可能有额外要求。

完整 Web 包内置 Node、后端及浏览器资源，无需 Electron 或外部 Node，默认仅监听 localhost；远程访问需要独立部署配置。仍可通过[源码开发入口](development.zh.md)启动。安装启动通过不等于模型任务通过；完成服务商、凭证和模型配置后，请先运行一个小任务验证。

## 更新

退出应用，下载下一个兼容版本；Windows 运行新版安装器，macOS 替换已安装应用，Ubuntu 安装新版 `.deb`。Web 先停止服务，再解压新版到另一目录，保留原数据目录。当前禁用应用自动更新。设置和会话存储在应用目录外；安装带迁移或兼容性警告的版本之前，请先备份数据。降级前请阅读对应版本的恢复说明。

## 排查问题

如果没有适合你平台的安装包，请在受支持环境中[从源码开发](development.zh.md)，或等待经过验收的安装包。Releases 页面为空不代表源码压缩包可以直接安装。

启动失败时，保留界面错误和诊断信息，不要首先清空 Profile 或会话。通过 [Issues](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/issues) 提供应用版本、操作系统、架构和脱敏后的错误；不要附上凭证或未经检查的用户数据目录。
