# APUS Reflex Harness 0.1.0

Model-as-a-Harness · 瞬时执行，深度思考。

Tag / 标签：`v0.1.0`. GitHub prerelease / GitHub 预发布；unsigned preview / 未签名预览版。

This release merges the desktop frontend into `frontend/` of the Harness repository. Configuration, builds and packaging use one reviewed source commit. Desktop installers include the backend; the complete Web archive includes Node, the backend and browser resources without Electron. No separate Git clone, Node installation or backend setup is needed for qualified download assets.

本次以前后端合并的一体化仓库交付：以 Harness 为主仓，客户端纳入 `frontend/`，统一配置、构建和打包。桌面安装包内置后端；完整 Web 包内置 Node、后端和浏览器资源，无需 Electron。使用已验收下载包不需要另外 clone、安装 Node 或部署后端。

| Target / 平台 | Download asset / 下载附件 |
| --- | --- |
| macOS Apple Silicon | `apus-reflex-harness-mac-arm64.dmg` / `.zip` |
| macOS Intel | `apus-reflex-harness-mac-x64.dmg` / `.zip` |
| Windows x64 | `apus-reflex-harness-windows-x64-setup.exe` |
| Ubuntu 24.04 x64 desktop / 桌面 | `apus-reflex-harness-linux-x64.deb` |
| Linux x64 Web | `apus-reflex-harness-web-linux-x64.tar.gz` |

Availability is limited to the qualified assets actually attached below. All published assets must identify the same source commit. Verify the corresponding SHA256SUMS file. macOS arm64 uses the unsuffixed metadata names; other targets use their target suffix. Original dependency license notices are retained. GitHub's automatic Source code archives are not installers.

可用平台以本页实际附上的已验收附件为准，全部已发布附件必须对应同一源码提交。下载后核对各目标的 SHA256SUMS 文件；macOS arm64 元数据不带后缀，其他目标使用对应平台后缀。原始依赖许可声明保留。GitHub 自动生成的 Source code 压缩包不是安装包。

- Models / 模型：configure your own generation provider in Settings → Models; Reflex/Jev supports separately configured OpenJev or Typesafe decision endpoints / 在“设置 → 模型”配置自己的生成服务；Reflex/Jev 决策服务单独配置，支持 OpenJev 或 Typesafe 协议。
- Configuration / 配置：draft connection tests do not save settings or automatically enable routing, supervision or memory / 草稿连接测试不会保存配置，也不会自动启用路由、监督或记忆。
- Signing / 签名：unsigned preview; macOS is not notarized and Windows has no code signature / 未签名预览版，macOS 未公证，Windows 无代码签名。
- Web / 浏览器版：localhost only by default, persistent data outside the extracted directory / 默认仅监听 localhost，持久数据保存在解压目录外。
- Updates / 更新：manual; preserve application data / 手动更新并保留应用数据。
- Access / 下载权限：repository access is required while the repository is private / 仓库私有期间下载需要仓库访问权限。

Installation and configuration / 安装与配置：[guide](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/blob/main/docs/feat-integrated-product/installation.md) · [中文教程](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/blob/main/docs/feat-integrated-product/installation.zh.md).

Native installation, startup and restart checks do not establish model-task success. A first task with a real model remains unvalidated; bring your own provider credentials and verify a small task. Other Linux distributions and architectures are not qualified.

原生安装、启动与重启检查通过不代表模型任务通过。真实模型首个任务尚未验证，请使用自己的服务凭证配置并验证一个小任务。其他 Linux 发行版及架构尚未验收。
