---
description: "为 APUS 产品配置方案提供可编辑的 Session 记忆默认值和受保护的 Reflex/Jev 相关性排序。"
kind: package-bundle
---

# @deepseek-ai/dsh-experimental-continuum-jev

[English](README.md) | 中文

## 概述

APUS Reflex Agent Full 和 Lite 包含此配置方案层，用户可从 Reflex 配置开启基于 Session 的记忆。记忆默认关闭；开启后采纳后续用户输入，并在同一 Session 中投影有界召回。Jev 相关性排序默认关闭，需要单独批准出站。active 排序保留所有通过本地预算的候选；提供方失败时保留 baseline。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

### 选择配置方案层

APUS Desktop 和 Web 启动器为新建和已有普通配置方案选择已安装的此 bundle。其他配置方案通过[配置方案组合参考](../../boot/app-boot/README.zh.md)在 `dsh.profile.bundles` 中选择本包名称。[bundle 补丁](cordis.patch.yml) 在用户配置方案补丁下方挂载 `continuum-memory` 和可选的 `continuum-jev` 选择器。记忆运行需要单独挂载的 Reflex 提供方；Safe Mode 保留独立恢复配置方案。

打开**设置 → Reflex 配置 → Continuum 无限记忆**启用记忆，或保存以下配置方案补丁：

```yaml
- id: continuum-memory
  config:
    enabled: true
```

产品提供方默认记忆模式为 `active`、准入为 `user-message`、作用域为 `workspace`，开关默认 false。已保存的部分字段配置保留这些默认值，明确设置的 `mode: off`、`admission: explicit` 和空作用域仍然生效。无效开关修改不会改变已接受的设置。开启后采纳后续已提交的用户输入，保留 Session 原文引用，并提供有界本地召回。关闭后停止新准入和召回投影，持久记录及会话历史中已记录的召回保留。重新打开同一 Session 会恢复其记录。此层不会自动合并无关 Session，也不授予任务记忆访问权。

### 配置相关性排序

选择器默认 `off`，隐私策略默认 `privacyPolicy: { mode: local-only }`。配置 `mode`、`timeoutMs`（默认 2000）、`maxRequestBytes`（默认 32768）、`privacyPolicy` 及 `sessionDataClasses`（默认 null，拒绝出站）。所有 Jev 路由均保守归为 network。授权时使用 controlled 或 cloud-approved 策略，将实际 provider ID 加入 `approvedRemoteIds`，并在 `approvedRemoteDataClasses` 中批准每个显式声明的 Session 数据分类；cloud-approved 还需要 `cloudApproval: true`。部署时对完整问题和候选分类，例如 `sessionDataClasses: [workspace]`；分类不能由模型提供。配置 endpoint 或打开记忆开关不代表批准出站。移除旧 `minConfidence` 和 `maxSelections`：启动时明确拒绝单选配置，不会静默缩小召回。已有完整组合的部署仍可直接挂载默认 `ContinuumJevPlugin` 服务。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

[产品记忆提供方](src/product-memory.ts) 继承 [Core 记忆实现](../../context/continuum/README.zh.md)，仅调整三个 schema 默认值，不改动 Core 默认值。Loader 组合和 ConfigForms 使用同一份经过校验的提供方配置。[排序服务](src/index.ts) 在一次有界 Jev 请求中对前十六个候选评分。独立 noul 答案估计相关性，不表示事实真伪或已校准准确率。active 稳定排序已评分前缀，并保留其余候选，包括低概率候选。

profile 先追加 prepared unknown receipt，flush 所属 Session，再通过持久化后端读回该 receipt，之后才发送请求。settled receipt 关联 prepared 事件序号，保留完整请求和校验后响应。取消保留 prepared 状态，不伪造成功；缺少持久化能力或屏障 I/O 失败时禁止发送并保留 baseline。只有 prepared 在发送前保证持久化；settled 随 Session 常规 flush 保存。历史 version-one receipt 继续可读，回放不会调用 Jev。拥有 Session 的 `selectContinuumMemory` 使用方必须提供持久化 beforeDispatch checkpoint；仅无 Session 消费者可省略该参数并自行记录输入。checkpoint 挂起期间失效的生命周期或卸载的 selector 不能继续发送请求。已发送后卸载不会撤回请求；迟到的排序不再采用，主模型继续使用完整 baseline。

</details>

<a id="model-experience"></a>
## Model Experience

### 有界记忆相关性

#### 模型看到的内容

主模型在显式开启后接收 Core 提供的、保留原文引用的有界召回。Jev 获得出站批准后，仅通过 `JevRequest.state` 和独立 `noul` 问题接收检索提供的问题及有界候选元数据。active 排序调整顺序，不删除候选。选择器不读取工作区文件。

#### Token effect

sidecar 最多发送一次请求，以完整 resolved JSON 字节数限制。排序保持候选集合及完整召回字节数，不缩短主模型上下文。

#### KV Cache effect

active 排序可能改变主模型 prompt 后缀；off 和 shadow 保持 baseline 顺序。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 选择器不负责检索或记录准入。Core 负责 bundle 中基于 Session 的记录和生命周期；相关性判断不表示事实成立。
- 真实 Jev 质量和延迟必须在 gateway 可达且配置完整时测试；fake provider 不能证明模型效果。
- 仅对前十六个候选评分，其余候选标记为未评分并保留。语义索引、查询扩展和逐条数据分类属于后续工作。声明的 Session 数据分类覆盖候选及问题；本包没有检测其中密钥的数据分类器。

不发布运行时不变式伴生模块：请求与回执适配器不维护独立的持久投影。

<a id="dev-note"></a>
### 开发备注

本包保持实验性。产品记忆需要显式开启，相关性选择器默认关闭。服务器部署保留自身的显式组合和隐私策略。
