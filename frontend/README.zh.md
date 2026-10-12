# APUS Reflex Harness 桌面客户端

![APUS Reflex Harness](../apps/web/public/brand-source.webp)

[English](README.md) | 中文

**瞬策 · 瞬时执行，深度思考 · Model-as-a-Harness**

APUS Reflex Harness 是面向本地项目的 Personal Agent 桌面客户端：选择工作目录、配置模型，在持久化对话中完成任务。可选的 Reflex/Jev 决策服务通过“设置 → Reflex 模型配置”配置。连接服务不会自动启用路由、监督或记忆。桌面客户端与 Harness 运行时由本仓库统一交付，架构与当前能力边界见[产品 README](../README.zh.md)。

本次将桌面客户端纳入原 Harness 主仓的 `frontend/`，合并前后端配置、构建与打包流程。安装包内置后端，无需另外安装或启动服务；一体化 Release 仍在准备中。

## 下载与配置

已发布安装包和平台验收情况见 [Releases](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/releases)。一体化预览版正在准备中，源码压缩包不是安装包。操作方法见[安装教程](../docs/feat-integrated-product/installation.zh.md)与[模型配置教程](../docs/feat-integrated-product/configuration.zh.md)。

## 开发

在仓库根目录执行准备和桌面启动命令。[开发教程](../docs/feat-integrated-product/development.zh.md)介绍单仓使用流程，打包与验收见[发行流程](../docs/feat-integrated-product/releases.zh.md)。

## 许可

DataElement 原始 MIT 声明保留在 [LICENSE](LICENSE)，依赖许可保留在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。产品致谢集中在[根 README](../README.zh.md)。

## 其他语言

[日本語](README.ja.md) · [Русский](README.ru.md) · [Español](README.es.md) · [Português](README.pt.md)
