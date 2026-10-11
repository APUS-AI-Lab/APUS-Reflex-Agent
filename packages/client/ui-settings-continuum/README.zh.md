---
description: "dsh Web 客户端 General 设置中的 Reflex 专属 Continuum 无限记忆开关。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-continuum

[English](README.md) | 中文

## 概述

Host 提供 `continuum-memory` 命名空间时，General 设置显示 Reflex 专属的 APUS Continuum 无限记忆开关。未组合 Continuum 时该行不会出现。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发者备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把本浏览器伴生包和 Web 设置外壳一起组合。该行通过共享的带 revision ConfigForms 队列写入已接受的 `enabled` 值。未提供 `continuum-memory` 的部署不会显示该行，Harness 保持原版行为。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Host 半侧是空的 `apply`；浏览器半侧通过 `ctx.configForms.whileServed` 监听 `continuum-memory`。`ContinuumSettingsController` 管理已接受值快照、忙碌状态、写入失败和释放；`ContinuumRow` 把本地化 Switch 注册进 `settings.general.item`。开关不授予权限，也不绕过 Jev 可用性；Session 事件仍是记忆事实来源。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-settings](../ui-settings/README.zh.md)——设置镜像与带 revision 写入队列。
- [ui-settings-general](../ui-settings-general/README.zh.md)——General 分区与 item slot。
- [ui-primitives](../ui-primitives/README.zh.md)——Switch 控件。
- [continuum](../../context/continuum/README.zh.md)——基于 Session 的记忆记录与 Reflex 策略。

-----

<a id="model-experience"></a>
## 模型体验

### Continuum 设置

#### 模型看到的内容

本浏览器设置包不新增模型可见输入；`ctx.configForms` 只写入 Host 设置。Continuum context 包负责任何有界 recall 消息。

#### Token 影响

切换开关只改变后续 profile 行为，本身不发起模型调用。

#### KV Cache 影响

本包不组装 provider 请求，也不改变请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **部署依赖**——Host 必须提供 `continuum-memory`；本行不会创建该命名空间。
- **Reflex 依赖**——开启后仍受 Continuum 服务的 Reflex/Jev 开关约束，不提供无 Reflex 的无限记忆模式。
- **后续产品界面**——摘要树浏览、运行中活动投影和缓存计费属于独立的 P4/P5 工作。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
