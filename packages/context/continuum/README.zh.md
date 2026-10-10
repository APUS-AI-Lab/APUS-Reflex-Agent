---
description: "APUS Continuum 的版本化、带来源记忆记录语义。"
kind: package-reference
---

# @deepseek-ai/dsh-continuum

[English](README.md) | 中文

## 概述

本包目前提供 APUS Continuum 最小的记录语义：带 Session 事件来源的不可变记忆记录、revision 校验、明确更正和停用。当前实现是内存投影，不注册产品插件，不写 Session 事件，不调用 Reflex，也不提供无 Reflex 的无限记忆模式。

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

后续 Session-backed provider 会把相同操作写入现有 Session 日志，并在 flush 成功后才报告可恢复。本批故意不把内存投影当作重启后的持久记忆。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`MemoryRecordStore` 要求调用方提供已观察到的 revision，并返回不可变快照。来源包含 Session ID 与事件序号，后续 provider 可据此重新打开证据。

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

- 当前没有磁盘 provider、索引、召回、Reflex adapter、摘要树或缓存策略。
- 当前实现不跨进程保存记录。

<a id="dev-note"></a>
### 开发备注

本包随 P1.1 小批次推进；下一批复用 `Session.append` 和 `ctx.sessions.flush(session)`，不增加第二套持久化事实源。
