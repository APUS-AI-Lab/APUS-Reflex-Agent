# System3 桌面 runtime 依赖闭包

[English](README.md) | 中文

这个私有依赖清单为独立的 APUS-Reflex-Frontend 应用提供已构建的 rc.2 Harness CLI、Web 资源、原生 profile 依赖与 System3/Reflex 插件。它不暴露应用入口或可执行文件；桌面应用启动部署后的 `dsh` profile。

部署此包前先构建 Harness 产物。Frontend 准备脚本负责装配、runtime 身份检查和平台打包。开发环境可以解析显式指定的 Harness 工作树；安装包要求完整的部署依赖树，不能回退到已安装的标准 DSH 包。凭据不进入此包及其产物。

APUS 普通 profile 在用户补丁之下声明 Reflex provider bundle，使专用配置页能够持久化编辑。服务端启动先运行 `../prepare-profile.mjs`，再通过 `dsh web` 启动；Desktop 在 profile 维护阶段声明同一 bundle。两条路径都保留既有用户补丁，命令行部署 overlay 不再声明 `jev` 条目。

部署配置为 Goal 监督启用有界 Codex 操作摘要。只有既有远程策略显式批准 `workspace` 数据类别时，Reflex 才接收操作类别和工作区相对路径；否则监督继续使用操作指纹，不发送这些摘要。摘要不包含原始命令、输出、搜索词、差异或私有推理。参见[监督配置](../../../packages/experimental/system3/README.zh.md)。
