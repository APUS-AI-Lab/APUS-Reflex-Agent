---
description: "在 Jev bundle 旁加入实验性的本机 APUS Reflex 判断。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-reflex-local-bundle

[English](README.md) | 中文

## 概述

此可选 Bundle 在已有的 Jev 组合旁加入本机决策引擎、其带认证的 Remote 与浏览器卡片。它不插入 `jev`、System3 或 System3 UI 条目；`jev` 由 Jev bundle 提供，缺少它时引擎加载失败。默认配置不启用它。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

与 Jev bundle 一同启用此 Bundle。在运行桌面应用的 Apple Silicon Mac 上，本机引擎卡片给出推荐模型及其下载大小，也可以改选其他模型；内存或可用空间装不下的选项会标出原因。自检通过且速度达标时，把 Jev 的默认 provider 设为本机引擎，并显示带“撤销”的提示条。停用引擎会删除该默认设置，Jev 回到内置 provider。在设置中关闭 Reflex 时，任何 provider 都不会回答，包括本机引擎。在桌面应用之外，卡片说明本机判断需要在 Apple Silicon 上使用桌面应用。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>


静态 `cordis.patch.yml` 插入三个条目：`reflex-local`、`api-reflex-local` 与 `ui-reflex-local`。`reflex-local` 条目把数据存放在 `dshHomePath('reflex-local')`。其 `runnerPath` 在桌面 Host 导出 `APUS_REFLEX_RUNNER` 时取该值，否则取 `DSH_DESKTOP_PRIMARY_RUNTIME_SOURCE` 下的 `dependencies/llama-server/llama-server`，再否则为 undefined，此时引擎报告 `runner-missing`。路由只编辑 volatile 字段 `jev.defaultProviderId`，因此开关引擎从不重载 Jev；System3 准入读取本机 provider 的 `local` 执行域。`tests/loader-composition.e2e.ts` 经 Loader 将此补丁叠加在 headless 配置上启动：一次叠在 Jev bundle 之上并确认没有重复的条目 id，一次不含 Jev bundle 以证明引擎条目失败。此纯配置包没有独立可变的运行时状态，因此不发布不变量伴随模块。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[本机决策引擎体验设计](../../../docs/feat-local-jev-mlx/local-inference-experience.html)

-----

<a id="model-experience"></a>
## 模型体验

间接影响，经由 System3 的任务框架与技能选择，二者把本机 Jev 判断转为模型可见的指令并拥有全部提示内容。

#### KV 缓存影响

Bundle 本身不向请求前缀添加内容；任务框架与技能指令的位置由 System3 决定。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 权重在首次使用时下载，推荐选项为 2.7 GB（4B Q4_K_M）到 9.5 GB（9B Q8_0）；实验性的 35B-A3B 选项需要 21–37 GB，且从不推荐。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>
