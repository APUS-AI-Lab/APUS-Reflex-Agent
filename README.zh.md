# APUS Reflex Harness

[English](README.md) | 中文

**瞬策 · 瞬时执行，深度思考。** Model-as-a-Harness：让决策模型与推理模型协同管理 agent（智能体）的工作过程，由本地运行时执行动作、落实权限并记录结果。

APUS 在一个仓库中提供桌面客户端、Web UI 和 Harness 运行时，用于检索整理资料、制作文档、编写代码，以及处理所选工作区中的文件。

## 下载桌面客户端

前往 [Releases](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/releases) 查看已发布安装包及支持平台。一体化预览版正在准备中；只有在该页面列出安装包及验收结果后，才表示可以下载使用。GitHub 的“Source code”压缩包是源码，不是客户端。

桌面发行版自带运行时，无需安装 Git、Node.js 或单独启动后端。请按[安装教程](docs/feat-integrated-product/installation.zh.md)与[模型配置教程](docs/feat-integrated-product/configuration.zh.md)操作；模型服务需要你提供自己的凭证。预览版可能出现兼容性变化，授权访问文件前请阅读[安全说明](SAFETY.zh.md)。

<a id="run"></a>

<a id="run-from-source"></a>

## 从源码运行

先安装 Git、Node.js 24 和 pnpm 11.7.0，然后在终端执行：

```sh
git clone https://github.com/APUS-AI-Lab/APUS-Reflex-Harness.git
cd APUS-Reflex-Harness
pnpm run setup
pnpm run start:desktop
```

准备命令会安装两套依赖、构建 Harness，并使用当前仓库准备桌面运行时。首次下载和构建需要网络及一定时间。开发 Web 版可运行 `pnpm run dev:web`。前提条件与排障方法见[源码开发教程](docs/feat-integrated-product/development.zh.md)。

## Model-as-a-Harness

Jev 提供有界决策，推理模型负责规划、生成和工具调用，DSH 执行允许的动作并保存会话事实。显式配置 System3 后，APUS 可以建议选路与 skill（技能）、保留任务要求及补充、管理工程委派，并核验已配置的完成证据。

- **按任务分工：**在允许的模型和 skill 候选中选择，受运行时策略约束。
- **接收变化的要求：**让任务补充进入当前工作过程，并送达支持接收输入的委派对象。
- **查看执行过程：**区分建议、实际采纳、模型响应与委派进度。

![APUS 架构：原生 Session 与 agent loop 扩展点连接决策模型、推理模型、执行能力及结果记录。](docs/feat-integrated-product/readme-architecture.svg)

通过模型管理工具、skill、记忆、上下文和子 agent 是产品方向，各项能力的配置及验证要求不同，详见 [System3 能力与限制](packages/experimental/system3/README.zh.md)。本地应用不代表离线推理。

## 文档与开发

- [安装与更新](docs/feat-integrated-product/installation.zh.md) · [配置模型](docs/feat-integrated-product/configuration.zh.md)
- [源码开发](docs/feat-integrated-product/development.zh.md) · [发行流程](docs/feat-integrated-product/releases.zh.md)
- [架构](docs/architecture.zh.md) · [参与贡献](CONTRIBUTING.zh.md)
- [报告问题](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/issues)

`frontend/` 负责 Electron 桌面宿主，`apps/web/` 负责 Web 入口，`packages/` 负责运行时与共享 UI。两个产品入口使用本仓库的 Harness。

## 许可与致谢

APUS 基于 DeepSeek Harness、DataElement 的 DSH Desktop、Cordis 及其贡献者的工作构建。原始 MIT 声明完整保留在 [LICENSE](LICENSE) 和 [frontend/LICENSE](frontend/LICENSE) 中；依赖条款见 [Harness 第三方通知](THIRD_PARTY_NOTICES.md)与[桌面第三方通知](frontend/THIRD_PARTY_NOTICES.md)。APUS 品牌不代表获得上游背书。
