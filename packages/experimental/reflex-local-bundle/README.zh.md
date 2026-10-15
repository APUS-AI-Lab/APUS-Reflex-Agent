---
description: "从插件管理页启用实验性的本机 APUS Reflex 判断。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-reflex-local-bundle

[English](README.md) | 中文

## 概述

此可选 Bundle 组合 Jev 服务、本机决策引擎、其带认证的 Remote 与浏览器卡片，以及使用仅本机隐私策略的 System3。本机判断是此组合中唯一的 Jev provider。默认配置不启用它。

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

打开 Web 侧栏的插件管理页并启用“本机决策引擎”。在运行桌面应用的 Apple 芯片 Mac 上，弹窗提供“下载并启用”；Bundle 详情显示同一张卡片，包含下载进度、“暂停”以及之后的“停用”和“删除模型”。自检通过且速度达标时自动启用本机判断，并显示带“撤销”的提示条。在此之前以及引擎停用时，System3 决策点按默认规则处理。在桌面应用之外，卡片说明本机判断需要在 Apple 芯片上使用桌面应用。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

静态 `cordis.patch.yml` 插入六个条目。`jev` 条目设置 `defaultProviderId: reflex-local` 且不设 endpoint，因此不注册内置 System One provider。`reflex-local` 条目把数据存放在 `dshHomePath('reflex-local')`，并从只有桌面 Host 导出的 `DSH_DESKTOP_PRIMARY_RUNTIME_SOURCE` 读取 `runnerPath`；缺少该变量时此选项为 undefined，引擎报告 `runner-missing`。`system3` 条目使用 `privacyMode: local-only` 与 `jevExecutionDomain: local`，只启用不需要云端生成线路的决策点：任务框架（active）、完成复核（shadow）与最多 16 个候选的技能选择，16 是本机模型的标签上限。其阈值与限制沿用 `deploy/system3/runtime.patch.yml`；本机线路对所有数据类别都放行，因此 `sessionDataClasses` 列出 `workspace`。`tests/loader-composition.e2e.ts` 经 Loader 将此补丁叠加在 headless 配置上启动。此纯配置包没有独立可变的运行时状态，因此不发布不变量伴随模块。

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

- 入口路由、委派与交接包需要云端生成线路，因此未组合；需要它们时请将 System3 与云端 Jev provider 组合。
- 权重在首次使用时下载：按统一内存选择 Q8_0 的 4.5 GB 或 Q4_K_M 的 2.7 GB。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>
