---
description: "APUS Continuum 的版本化、带来源记忆记录语义。"
kind: package-reference
---

# @deepseek-ai/dsh-continuum

[English](README.md) | 中文

## 概述

本包提供 APUS Continuum 最小的持久记录语义：带 Session 事件来源的不可变记忆记录、revision 校验、明确更正、停用、可从日志重建投影的仅日志 Session 事件、精确来源回读、确定性的有界检索和可选同一步上下文消费者。本包不注册产品 profile，不调用 Reflex，也不提供无 Reflex 的无限记忆模式。

Session 事件复用现有 persistence backend；调用方完成 `ctx.sessions.flush(session)` 后才具备持久化保证。Reflex 准入、检索和模型注入属于后续批次。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [Model Experience](#model-experience)
- [生命周期与评测](#lifecycle-and-evaluation)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

-----

<a id="use-this-package"></a>
## 使用本包

使用 `MemoryRecordStore` 保存确定性的 revision 语义；用 `appendMemoryRecordEvent` 把变更追加到现有 Session 日志，用 `foldMemoryRecordEvents` 从日志重建，用 `readMemorySourceEvents` 精确回读来源，用 `retrieveMemoryWorkingSet` 生成有界候选。只有 `ctx.sessions.flush(session)` 成功后，调用方才能报告已经持久化。

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

挂载 `installContinuumMemoryContext` 后，模型看到由 active 记录和当前用户文本生成的有界 `continuum-memory` recall 消息。

#### Token effect

recall 消息消耗配置的字节预算并进入同一个模型请求；不会额外调用模型。

#### KV Cache effect

消费者追加有界 recall 消息；在工作集不变时，已有请求前缀保持稳定。

<a id="lifecycle-and-evaluation"></a>
## 生命周期与评测

`ContinuumMemoryController` 负责 Reflex 专属开关、精确作用域授权和在途读取的 generation token。关闭开关会保留持久记录，但使待提交的投影失效；停用记录也会使在途投影失效。未接入 Reflex 时，`resolveContinuumMemorySwitch` 回到原版路径。本地摘要树/缓存实验生成在 `docs/feat-continuum-memory/continuum-ablation.json`，分别测量检索覆盖率与稳定前缀复用估计，不声称 provider 账单或服务端缓存命中。

## Known Limitations and Deferred Work

- 当前记录投影是进程内的；重启恢复必须读取并折叠 Session 事件日志。
- 当前没有 Reflex 决策接入、全文索引、摘要树或缓存策略；检索只是当前投影上的确定性词法选择。

<a id="dev-note"></a>
### 开发备注

Session 事件已经复用 `Session.append` 和 `ctx.sessions.flush(session)`，但本包仍未接入产品 profile 或 Reflex。
