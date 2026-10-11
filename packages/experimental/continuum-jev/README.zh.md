---
description: "APUS Continuum 有限记忆选择的实验性 Reflex/Jev 控制器。"
kind: package-reference
---

# @deepseek-ai/dsh-experimental-continuum-jev

[English](README.md) | 中文

## 概述

本包是 APUS Continuum 的 Reflex 专属决策适配器。它保留确定性本地 baseline，支持 `off`、`shadow`、`active`，把 Jev 输入限制在已检索候选内，拒绝模型臆造 ID，并在 provider 失败或置信度不足时回退。本包自身不负责检索、持久化回执，也不单独宣称无限上下文。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在有限本地检索之后调用 `selectContinuumMemory`。`off` 保持 baseline；`shadow` 只比较 Jev 建议并返回 baseline；`active` 只接受候选集中且达到 `minConfidence` 的选择。

<a id="understand-the-implementation"></a>
## 理解实现

适配器通过 provider-neutral 的 `ctx.jev` 接收查询、候选 ID、标签、摘录和分数。Choice 集合严格由候选 ID 加 `none` 构成；未知选择、provider 不可用、取消或低置信度不能把记忆加入 active 结果。

<a id="model-experience"></a>
## Model Experience

### 有限候选记忆选择

#### 模型看到的内容

只有 `selectContinuumMemory` 调用方提供的查询和有限候选元数据。适配器不读取工作区，也不向主模型请求自动追加消息。

#### Token effect

Jev sidecar 使用独立请求；后续消费者显式注入记录前，主模型 token 计量不变。

#### KV Cache effect

不直接影响主模型路由缓存。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 尚未实现检索、Session 回执持久化、同一步注入和产品开关。
- 真实 Jev 质量和延迟必须在 gateway 可达且配置完整时测试；fake provider 不能证明模型效果。
- 多选、摘要树、缓存测量和权限过滤留待后续 Continuum 阶段。

<a id="dev-note"></a>
### 开发备注

本包保持实验性，不由默认 profile 加载。
