# 安装 APUS Reflex Harness

[English](installation.md) | 中文

本教程介绍如何选择桌面安装包、安装及更新。下载前请阅读验收状态；实验性附件尚未完成安装验收。

## 下载

仓库当前为私有，查看与下载 Release 需要仓库访问权限；预发布状态本身不会开放匿名访问。

打开[产品 Releases](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/releases)，阅读所选版本支持的平台、架构、签名状态和已知限制。选择客户端附件，不要下载 GitHub 自动生成的源码压缩包作为安装包。附有下载包本身不代表安装验收通过。

`0.1.0` 的目标为 macOS Apple Silicon（arm64）、macOS Intel（x64）、Windows x64、Ubuntu 24.04 x64 桌面及完整 Linux x64 Web 包，均从同一经过审查的干净源码提交构建。选择与操作系统及架构匹配的附件：macOS 使用 DMG/应用 ZIP，Windows 使用 NSIS `.exe` 安装包。这些都是未签名预览版，macOS 未公证。本次预发布明确将 Windows 和 Ubuntu 桌面标为实验性附件；真实模型首个任务尚未验证。

| 平台 | `0.1.0` 安装验收 |
| --- | --- |
| macOS Apple Silicon / Intel | 自动复制、直接启动进程与重启通过；Finder/Gatekeeper 验收未完成。已检查 DMG 内的应用 bundle seal 无效。 |
| Linux x64 Web（Ubuntu 24.04） | 解压、启动、默认工作区、配置持久化、沙箱与重启通过。 |
| Windows x64 | 实验性；安装包构建通过，但安装验收失败，原因尚未确定。 |
| Ubuntu 24.04 x64 桌面 | 实验性；安装包构建通过，但验收在应用启动前因运行时文件清单输出缓冲溢出而中止。 |

已检查的已发布 `0.1.0` macOS DMG 与公布的 SHA-256 一致，但其应用未通过严格 bundle 签名验证，错误为 `code has no resources but signature indicates they must be present`。按正常 DMG → Applications 流程安装后，Finder 可能提示应用已损坏。此前自动检查直接调用可执行文件，未验收该 Finder/Gatekeeper 流程。下载校验一致只确认文件字节，不代表应用 seal 有效。下载替代版本前请查看该次发布的安装验收结果与[签名策略](../feat-office-editions/README.zh.md#macos-compatibility)；也可[从源码开发](development.zh.md)。

Windows 和 Ubuntu 桌面再验收因 GitHub Actions 计费/支出额度限制未能启动。Linux 验收脚本已修复，但这不代表安装、界面或沙箱验收通过。全部下载包保留构建元数据记录的同一产品源码；后续验收脚本修改不代表重新构建产品。

## 安装与打开

1. 下载安装包和发行校验文件。打开之前，将下载文件的 SHA-256 摘要与公布值进行比较。
2. Windows（实验性，安装验收未完成）：下载 x64 NSIS `.exe` 安装包，运行安装向导，再从开始菜单或安装目录启动 APUS Reflex Harness。校验文件使用 `SHA256SUMS-win32-x64`。
3. macOS（`0.1.0` 存在 bundle seal 缺陷；Finder/Gatekeeper 验收未完成）：可[从源码开发](development.zh.md)，或等待经过验收的替代版本。现有 `0.1.0` Apple Silicon 附件使用 `SHA256SUMS`，Intel 附件使用 `SHA256SUMS-darwin-x64`；校验文件不能修复该缺陷。
4. Ubuntu 24.04 x64（实验性，安装验收未完成）：使用 `SHA256SUMS-linux-x64` 校验，再运行 `sudo apt install ./apus-reflex-harness-linux-x64.deb` 安装，从应用菜单打开 APUS Reflex Harness；其他 Linux 发行版尚未验收。
5. Linux x64 Web：使用 `SHA256SUMS-web-linux-x64` 校验，解压 `apus-reflex-harness-web-linux-x64.tar.gz` 后在其目录运行 `./start.sh`，打开启动器输出的带认证信息的 localhost 链接，不要分享该链接。端口及数据目录配置见 [Web 教程](../release-web-runtime/README.zh.md)。
6. 按[模型配置教程](configuration.zh.md)操作，选择工作区并发送一个小任务。应用会自动启动自带的后端。

Windows 安装包没有代码签名，SmartScreen 可能提示未知发布者。确认其来源和校验值后，如决定继续，请使用系统提供的单个应用批准流程。macOS 预览版没有 Developer ID 签名或公证保证；普通批准流程不能修复已确认的 `0.1.0` bundle seal 缺陷。不要全局关闭系统保护。签名状态以具体发行版为准，构建成功不能证明已签名。

应用包含运行时，无需安装 Git、Node.js 和 pnpm。模型服务仍需要网络及你自己的凭证；可选工具可能有额外要求。

完整 Web 包内置 Node、后端及浏览器资源，无需 Electron 或外部 Node，默认仅监听 localhost；远程访问需要独立部署配置。仍可通过[源码开发入口](development.zh.md)启动。安装启动通过不等于模型任务通过；完成服务商、凭证和模型配置后，请先运行一个小任务验证。

## 更新

退出应用，下载下一个兼容版本；Windows 运行新版安装器，macOS 替换已安装应用，Ubuntu 安装新版 `.deb`。Web 先停止服务，再解压新版到另一目录，保留原数据目录。当前禁用应用自动更新。设置和会话存储在应用目录外；安装带迁移或兼容性警告的版本之前，请先备份数据。降级前请阅读对应版本的恢复说明。

## 排查问题

如果没有适合你平台的安装包，请在受支持环境中[从源码开发](development.zh.md)，或等待经过验收的安装包。Releases 页面为空不代表源码压缩包可以直接安装。

启动失败时，保留界面错误和诊断信息，不要首先清空 Profile 或会话。通过 [Issues](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/issues) 提供应用版本、操作系统、架构和脱敏后的错误；不要附上凭证或未经检查的用户数据目录。
