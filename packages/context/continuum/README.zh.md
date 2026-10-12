---
description: "APUS Continuum 的版本化、带来源记忆记录语义。"
kind: package-reference
---

# @deepseek-ai/dsh-continuum

[English](README.md) | 中文

## 概述

本包提供 APUS Continuum 的持久记录与 profile service：带 Session 事件来源的不可变记忆记录、revision 校验、明确更正、停用、可从日志重建投影的仅日志 Session 事件、精确来源回读、确定性的有界检索、可重建的派生检索索引、可选的 Jev selector、生命周期感知的同一步消费者和显式产品开关。服务不会静默创建记录，也不会在没有 Reflex 时提供无限记忆模式。

Session 事件使用现有 persistence backend；完成 `ctx.sessions.flush(session)` 后才具备持久化保证。准入默认显式执行；opt-in 的 `admission: 'user-message'` 在 Reflex 专属开关生效时记录带精确 Session 引用的人类消息。配套 `continuum-jev` service 提供 shadow/active 选择和回执。

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

`MemoryRecordStore` 要求调用方提供已观察到的 revision，并返回不可变快照。`ContinuumMemory` 在每个 Agent 的同一所属投影中保存 controller 和记录 store，从 Agent Session 恢复该投影，并把显式的 create/supersede/deactivate 调用持久化为 `continuum/memory-record`。在 `user-message` 准入模式下，已提交的人类 `user/message` 会在 Session append 完成后转换为记录；生成的 recall 消息和其他来源会被忽略。服务在 Agent 创建后挂载时，仅使用属于同一 Session 的当前发起操作的 Agent；没有所属 Agent 的输入及其他 Session 的输入不会被准入。controller 会在提交变更后维护可丢弃的派生索引，索引候选保留与直接检索相同的词法子串匹配；折叠事件不会调用模型，也不会创建第二套持久化事实源。

-----

<a id="further-exploration"></a>
## 进一步阅读

参阅[Continuum 提案](../../../docs/feat-continuum-memory/continuum-memory-proposal.html)了解分阶段产品设计。

-----

<a id="lifecycle-and-evaluation"></a>
## 生命周期与评测

`ContinuumMemoryController` 负责 Reflex 专属开关、精确作用域授权和在途读取的 generation token。已提交的启用状态或模式变更会使待处理投影失效，包括关闭后重新开启的情况。Jev 服务卸载也会使在途读取失效，即使选择返回前已重新挂载；其他 Cordis 隔离域内的 Jev 绑定变化不会使本服务的读取失效。作用域变更会重新挂载服务，并使之前的投影失效。释放任一上下文 consumer 或其所属 Context 后，待完成的 pre-step hook 与 selector 结果均不能注入召回。Agent 释放时移除其控制器；服务释放时使全部控制器失效并解除引用。被拒绝的配置编辑不会影响当前投影。这些变更会保留持久记录；停用记录同样会使待处理投影失效。未接入 Reflex 时，`resolveContinuumMemorySwitch` 回到原版路径。挂载配套 selector 后，active 模式通过 Jev 过滤有界工作集并写入 `continuum/memory-decision`；shadow 模式调用 Jev 但保留 baseline。`summary` 从当前由 Session 支持的记录投影构建可丢弃的授权导航视图，`zoom` 返回节点的精确来源引用；两者都不创建第二套事实日志。`buildContinuumSummaryTree` 提供确定性的 scope/kind 导航，`measureContinuumStableCacheLayouts` 报告本地稳定前缀复用。本地摘要树/缓存实验生成在 `docs/feat-continuum-memory/continuum-ablation.json`，分别测量检索覆盖率与布局复用，不声称 provider 账单或服务端缓存命中。

<a id="model-experience"></a>
## Model Experience

### 记录语义

#### 模型看到的内容

挂载 `installContinuumMemoryContext` 后，模型看到由 active 记录和当前用户文本生成的有界 `continuum-memory` recall 消息。

#### Token effect

recall 消息消耗配置的字节预算并进入同一个模型请求；不会额外调用模型。

#### KV Cache effect

消费者追加有界 recall 消息；在工作集不变时，已有请求前缀保持稳定。

## Known Limitations and Deferred Work

- 当前记录投影是进程内的；重启恢复必须读取并折叠 Session 事件日志。`MemoryRecordIndex` 是 controller 维护的可丢弃派生状态；仍可从投影重建，或用有界积压预算逐步处理排队快照。
- service 不包含完整全文索引，也不会自动把摘要树接入生命周期检索。重启后摘要导航从 Session 事件重建，不是持久化的模型摘要快照。摘要树和缓存 helper 是确定性的本地计量，不报告 provider 缓存账单；记录必须带来源，准入默认由调用方负责，也可以显式开启人类消息准入。
- 自动用户消息准入必须显式 opt-in，使用第一个配置作用域，并将消息文本保存为带来源的 fact。处理私密或敏感对话的部署应保持 `admission: explicit`，改用领域专属的准入调用方。

<a id="dev-note"></a>
### 开发备注

Session 事件已经复用 `Session.append` 和 `ctx.sessions.flush(session)`。system3 runtime patch 默认关闭地加载本服务和配套 Jev selector；是否启用仍是受保护部署环境的显式选择。
