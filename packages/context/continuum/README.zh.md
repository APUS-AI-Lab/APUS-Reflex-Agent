---
description: "APUS Continuum 的版本化、带来源记忆记录语义。"
kind: package-reference
---

# @deepseek-ai/dsh-continuum

[English](README.md) | 中文

## 概述

本包提供 APUS Continuum 最小的持久记录语义：带 Session 事件来源的不可变记忆记录、revision 校验、明确更正、停用，以及可以从日志重建投影的仅日志 Session 事件。本包不注册产品插件，不构建索引，不调用 Reflex，也不提供无 Reflex 的无限记忆模式。

Session 事件复用现有 persistence backend；调用方完成 `ctx.sessions.flush(session)` 后才具备持久化保证。Reflex 准入、检索和模型注入属于后续批次。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [Model Experience](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

-----

<a id="use-this-package"></a>
## 使用本包

使用 `MemoryRecordStore` 保存确定性的 revision 语义；用 `appendMemoryRecordEvent` 把变更追加到现有 Session 日志，用 `foldMemoryRecordEvents` 从日志重建。只有 `ctx.sessions.flush(session)` 成功后，调用方才能报告已经持久化。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`MemoryRecordStore` 要求调用方提供已观察到的 revision，并返回不可变快照。`continuum/memory-record` 保存完整的变更后记录；折叠事件不会调用模型，也不会创建第二套持久化事实源。

-----

<a id="further-exploration"></a>
## 进一步阅读

参阅[Continuum 提案](../../../docs/feat-continuum-memory/continuum-memory-proposal.html)了解分阶段产品设计。

-----

<a id="model-experience"></a>
## Model Experience

### 记录语义

#### 模型看到的内容

`MemoryRecordStore` 不会直接向模型提供内容；后续 Continuum 消费者负责注入证据。

#### Token effect

本包不构造模型请求，直接 token 影响为零。

#### KV Cache effect

本包不发送模型请求，也没有缓存影响。

## Known Limitations and Deferred Work

- 当前记录投影是进程内的；重启恢复必须读取并折叠 Session 事件日志。
- 当前没有索引、召回、Reflex adapter、摘要树或缓存策略。

<a id="dev-note"></a>
### 开发备注

Session 事件已经复用 `Session.append` 和 `ctx.sessions.flush(session)`，但本包仍未接入产品 profile 或 Reflex。
