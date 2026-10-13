# APUS Reflex Agent 版本选择

[English](README.md) | 中文

Full 与 Lite 使用相同的 Agent 运行时和应用身份，两版区别是是否内置 Office 引擎。下载与验收状态以 [Releases](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/releases) 为准。

| 能力 | Full | Lite |
| --- | --- | --- |
| Agent、Reflex、记忆和工具 | 内置 | 内置 |
| Codex 和 PPT 工作台 | 内置 | 内置 |
| PDF、图片、文本和浏览器表格预览 | 内置 | 内置 |
| 内置 Office 页面渲染和转换 | 内置 | 排除 |

需要集成的 DOC/DOCX/PPT/PPTX 页面渲染及 Office 转换时选择 Full。Lite 下载较小，不支持的预览会说明缺少 Host 能力，并保留文件访问入口。浏览器 XLS/XLSX 预览不依赖内置引擎。依赖 LibreOffice 转换或公式重算的脚本需要 Full；基础文件操作取决于各自的库和解释器，Lite 不提供替代引擎。

Lite 上额外启用的自定义 Office 技能，在不需要引擎时必须显式设置 `cli: false`。明确启用转换提供方却缺少引擎时会报错。Lite 最后加载的产品配置覆盖层会在启动和配置重读时禁用内置转换提供方。

## 记忆设置

两版都为普通 Desktop 和 Web 配置方案准备可编辑的记忆默认值。打开“设置 → 通用设置 → Continuum 无限记忆”主动启用，默认关闭。[记忆配置方案层](../../packages/experimental/continuum-jev/README.zh.md)定义 Session 召回与独立的 Jev 出站授权。已有设置和记录在重启及切换版本后保留。打开此开关不授予网络访问，也不自动共享无关 Session。

<a id="macos-compatibility"></a>
## macOS 兼容性

Full 和 Lite 要求 macOS 15 或更新版本。准备后的 Harness 原生加载器在实际 Mach-O 加载指令中声明最低版本为 15.0；Node 24.9.0 要求 13.5，Electron 43 要求 12.0。完整应用采用必须组件中的最高版本要求。这项要求不代表所有支持的 macOS 版本都已完成实测，安装结果以每次发行的验收记录为准。

| 已检查的 ARM64 组件 | 声明的最低 macOS 版本 |
| --- | --- |
| Electron 43 可执行程序、框架和辅助进程 | 12.0 |
| 内置 Node 24.9.0 | 13.5 |
| 准备后的 Harness 原生加载器 0.1.9 | 15.0 |
| node-pty 及其 spawn helper | 11.0 |
| Codex 0.153.4 可执行程序 | 11.0 |
| Codex 内置 zsh | 15.0 |
| sherpa-onnx 语音原生模块 | 14.0 |
| 桌面宿主的 LibreOffice 原生 helper | 11.0 |
| 准备后的 Harness LibreOffice helper 0.1.5 | 11.0 |

产品包要求构建主机和 Node 进程与目标操作系统及架构一致。直接从 ARM64 进程向 builder 传入 `--x64` 不能得到已验收的 Intel 包；依赖安装、运行时准备及验证也必须匹配目标。

macOS 预览版使用 ad-hoc 签名，封存应用元数据和内置资源。builder 在创建 DMG 和 ZIP 前验证完成后的应用。这类签名不提供 Developer ID 认证或公证；签名验证通过不代表获得 Gatekeeper 信任。

## 安装和升级

安装包文件名以 `apus-reflex-agent-full-` 或 `apus-reflex-agent-lite-` 开头。两版保留旧版的应用标识和数据位置；Debian 包及已安装可执行程序保留既有升级身份。切换版本会替换应用，而非安装第二个独立副本。升级前备份数据；替换 Web 解压目录时保留数据目录。

源码压缩包不是安装包。每个平台的两版分别验收，Full 通过不能代替 Lite 通过。构建记录、配套文件名、校验值和发布条件统一见[发行流程](../feat-integrated-product/releases.zh.md)。
