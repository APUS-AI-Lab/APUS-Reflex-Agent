# System3 桌面 runtime 依赖闭包

[English](README.md) | 中文

这个私有依赖清单为独立的 xDAN-System3-Frontend 应用提供已构建的 rc.2 Harness CLI、Web 资源、原生 profile 依赖与 System3/Jev 插件。它不暴露应用入口或可执行文件；桌面应用启动部署后的 `dsh` profile。

部署此包前先构建 Harness 产物。Frontend 准备脚本负责装配、runtime 身份检查和平台打包。开发环境可以解析显式指定的 Harness 工作树；安装包要求完整的部署依赖树，不能回退到已安装的标准 DSH 包。凭据不进入此包及其产物。
