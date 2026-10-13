# APUS Reflex Harness Web 运行包

[English](README.md) | 中文

## 启动应用

此 Linux x64 下载包包含 Web 服务端、浏览器应用和 Node.js 运行时。你需要受支持的 Linux 系统和浏览器；启动应用无需 Git、pnpm、外部 Node 或 Electron。原生验收任务使用 Ubuntu 24.04 x64，其他 Linux 发行版尚未验收。受限 shell 执行要求内核支持 Landlock；压缩包内置对应原生启动器。

1. 从同一 Release 下载 `apus-reflex-agent-{edition}-web-linux-x64.tar.gz` 和匹配的 `SHA256SUMS-{edition}-web-linux-x64`，将压缩包的 SHA-256 与清单中的值核对。
2. 解压并进入 `apus-reflex-agent-{edition}-web-linux-x64` 目录。
3. 运行 `./start.sh`，打开终端输出的带认证信息的 localhost URL。保持终端运行；按 Ctrl+C 停止服务。
4. 打开 **设置 → 模型**，配置服务商、API 密钥和模型。模型请求需要对应服务商凭据和网络访问能力。

服务监听 `127.0.0.1:3080`。可用 `./start.sh --port 8080` 选择其他端口。启动器不提供对外网络监听参数。请勿分享终端输出的带认证信息的 URL。

将 `{edition}` 替换为 `full` 或 `lite`。Full 内置 Office 转换引擎；Lite 排除该引擎，保留浏览器表格预览及普通 PDF、图片、文本预览。DOC/PPT 页面渲染需要 Full 或显式配置的 Host 服务。两版的核心 Agent、Reflex、记忆及 PPT 工作台使用相同代码，参见[版本选择](../feat-office-editions/README.zh.md)。

## 配置和数据

数据默认保存到 `$XDG_DATA_HOME/apus-reflex-web`；未设置 `XDG_DATA_HOME` 时使用 `~/.local/share/apus-reflex-web`。可设置 `DSH_HOME`，或使用 `./start.sh --data-dir /absolute/path` 选择其他目录。重启时使用同一目录即可恢复 profile、设置、凭据和会话。升级前请备份数据。升级时替换解压后的应用目录，不要删除数据目录。

**设置 → Reflex 模型配置** 用于配置可选的 Jev 决策服务。APUS Reflex 选择 OpenJev；Typesafe 服务选择 Typesafe，然后填写服务商提供的地址和模型。保存配置不会测试连接，请显式执行连接测试。连接 Jev 不会自动启用高级路由、监督或记忆策略。

未配置服务商凭据时服务端也能启动；成功执行模型任务之前，需要配置可用的服务商。安装额外插件或执行开发工具可能需要压缩包以外的软件。

## 发布验收

通用设置和主页侧栏显示来自 `release/manifest.json` 的产品发布版本；侧栏还包含短提交标识。构建信息单独记录 Harness 包版本。

压缩包保留各依赖包的许可声明，并在 `licenses/` 中提供根目录声明和 Node.js 许可。`files.json` 记录全部负载文件哈希；配套构建信息记录源码提交、源码压缩流哈希、依赖清单、锁文件哈希、Node 版本与二进制哈希，以及最终压缩包哈希。

原生审查任务在仓库之外解压压缩包，使用新数据目录启动，不依赖外部 Node、Git、pnpm，也不继承 API 密钥。它验证内置 Node 版本及 Landlock 沙箱启用状态，执行 shell 和 Node 的允许目录写入并拒绝目录之外的写入，检查主页及通用设置产品版本，检查 HTTP，打开 Models 和 Reflex 设置，保存无密钥的 Reflex 配置，重启后验证持久化结果，并等待所属进程全部退出。候选包附带报告和截图。没有服务商凭据时，该验收不声称已完成外部模型任务。产物收集和公开发布是分开的步骤。

首次工作区会自动创建在持久数据目录的 `Documents/` 下，无需系统“文档”目录配置或桌面目录工具。工作区文件位于解压的应用目录之外，重启和替换安装包后仍会保留。
