---
description: "APUS Continuum 的版本化、带来源记忆记录语义。"
kind: package-reference
---

# @deepseek-ai/dsh-continuum

[English](README.md) | 中文

## 概述

保存带精确来源引用的原文、按预算检索片段，并保留明确纠正供审计。可选任务插件使新 Session 恢复同一持久任务的输入；记忆记录插件另行支持 Reflex 选择。持续工作使用有限模型窗口；完整处理覆盖与规模验收尚未完成。

Session 事件使用现有 persistence backend；完成 `ctx.sessions.flush(session)` 后才具备持久化保证。准入默认显式执行；opt-in 的 `user-message` 和 `compaction` 模式记录带精确 Session 引用的人类消息。配套 `continuum-jev` service 提供 Reflex 选择、准入和回执。

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

`ContinuumConfigFields` 导出经过校验的 schema 字段，供 profile provider 定义自己的默认值。Core 默认仍为 `enabled: false`、`mode: off`、`admission: explicit`、`candidatePool: lexical` 和空作用域。Reflex 专属开关生效时，`admission: 'user-message'` 记录每条已提交的人类消息，`admission: 'compaction'` 在挂载的 Reflex admitter 选中后，为压缩检查点替换掉的人类消息建立索引。`candidatePool: all` 还会在所有字面命中之后按从新到旧提供与输入没有共同词的记录，供挂载的 selector 判断；没有 selector 时只注入有共同词的记录。挂载的 selector 最多收到 `maxPool` 个候选（默认等于 `maxCandidates`），每个候选附带记录的 L1 标签；它选出的召回仍受 `maxTotalBytes` 限制。

-----

可选插件 `@deepseek-ai/dsh-continuum/tasks` 将不同 Session 接入宿主配置的同一任务。独立 JSONL 日志提供单写者、持久版本检查、精确请求去重和完整原文；内部日志不进入普通会话列表。配置固定 `root`、`workspace`、`domainId`、`principalId` 和 `taskId`；`maxContextBytes` 与 `maxPageBytes` 默认都是 8192。宿主向一个本地主体授权精确 canonical 工作区；这不是多用户认证服务。

人类文本不 trim、不按数量淘汰、不按长度截断。live 来源通过所属 Session flush；cold 来源先临时取得独占写权限，再 flush 与精确回读。其他进程持写的来源拒绝确认。域操作在 append、flush 和精确回读后才发布；持久状态不确定时停止后续读写，等待恢复。任务修改与模型请求串行，租约覆盖下游中间件直到流结束，因此运行中的请求会延后纠正和其他输入准入。辅助压缩请求保留授权与停用检查，使用各自选定的消息区间。

`read_continuum_task` 返回严格字节预算的 JSON 页，包含来源事件与文本块、SHA-256、任务版本和续页游标；游标过期时从当前首页重新读取。`pending` 仅表示还有有效原文未读取，读取或保存都不等于处理完成。上下文快照对应其装配版本，当前人类消息在模型派发前保存，可能推进该版本。宿主显式纠正会停用指定前驱，同时保留旧原文。正式 profile 常驻轻量任务检查：已绑定的 Session 缺少匹配任务服务时拒绝模型派发。已有绑定 Session 在停用后也拒绝继续派发模型请求，避免沿用旧摘要或输出；新 Session 使用当前任务。自动修复旧历史、assistant/tool 进度收录、输入处理回执、对此任务投影的 Reflex 排序及实际窗口规模验收仍需分别完成。

参见[跨会话设计与验收](../../../docs/feat-cross-session-memory/design.html)和[可选 profile 配置](../../../apps/cli/config/examples/continuum-task.patch.yml)。任务日志是持久的，当前完整内存投影不代表常量内存或无限规模已实现。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`MemoryRecordStore` 要求调用方提供已观察到的 revision，并返回不可变快照。`ContinuumMemory` 在每个 Agent 的同一所属投影中保存 controller 和记录 store，从 Agent Session 恢复该投影，并把显式的 create/supersede/deactivate 调用持久化为 `continuum/memory-record`。在 `user-message` 准入模式下，已提交的人类 `user/message` 会在 Session append 完成后转换为记录；生成的 recall 消息和其他来源会被忽略。服务在 Agent 创建后挂载时，仅使用属于同一 Session 的当前发起操作的 Agent；没有所属 Agent 的输入及其他 Session 的输入不会被准入。在 `compaction` 准入模式下，每个已提交的 `compaction/summary` 会把它遮蔽的、有文本且尚无记录的人类消息加入队列；可选的 `continuumMemoryAdmitter` 返回要索引的 ID 及其标签，admitter 失败时把全部候选以无标签方式索引，admitter 在运行前被移除时一条都不索引。每条保留的原话成为一个 `continuum/memory-index` 事件：一条 L1 索引项，只含标签和指向来源事件的指针，从不含原文。折叠日志时从该来源事件解析原文，放入内存中的记录 store，因此检索读取的是原文，而日志中只有一份副本。没有挂载 admitter 时，此模式既不准入也不召回。下一次同 step 读取会等待排队中的准入，因此请求之前发生的压缩所产生的记录对该请求可见。controller 会在提交变更后维护可丢弃的派生索引，索引候选保留与直接检索相同的词法子串匹配；折叠事件不会调用模型，也不会创建第二套持久化事实源。

-----

<a id="further-exploration"></a>
## 进一步阅读

参阅[Continuum 整体架构与验收设计](../../../docs/feat-lossless-memory/design.html)了解总体目标与分批验收计划。

-----

<a id="lifecycle-and-evaluation"></a>
## 生命周期与评测

`ContinuumMemoryController` 负责 Reflex 专属开关、精确作用域授权和在途读取的 generation token。已提交的启用状态或模式变更会使待处理投影失效，包括关闭后重新开启的情况。Jev 服务卸载也会使在途读取失效，即使选择返回前已重新挂载；其他 Cordis 隔离域内的 Jev 绑定变化不会使本服务的读取失效。作用域变更会重新挂载服务，并使之前的投影失效。释放任一上下文 consumer 或其所属 Context 后，待完成的 pre-step hook 与 selector 结果均不能注入召回。Agent 释放时移除其控制器；服务释放时使全部控制器失效并解除引用。被拒绝的配置编辑不会影响当前投影。这些变更会保留持久记录；停用记录同样会使待处理投影失效。未接入 Reflex 时，`resolveContinuumMemorySwitch` 回到原版路径。挂载配套 selector 后，active 模式通过 Jev 对完整有界工作集排序并写入 `continuum/memory-decision`；shadow 模式调用 Jev 但保留 baseline 顺序。consumer 保留 selector 顺序、去重 ID、忽略未知 ID，并提供生命周期检查，阻止持久化屏障期间失效的请求继续外发。`summary` 从当前由 Session 支持的记录投影构建可丢弃的授权导航视图，`zoom` 返回节点的精确来源引用；两者都不创建第二套事实日志。`buildContinuumSummaryTree` 提供确定性的 scope/kind 导航，`measureContinuumStableCacheLayouts` 报告本地稳定前缀复用。本地摘要树/缓存实验生成在 `docs/feat-continuum-memory/continuum-ablation.json`，分别测量检索覆盖率与布局复用，不声称 provider 账单或服务端缓存命中。

<a id="model-experience"></a>
## Model Experience

### 记录语义

#### 模型看到的内容

挂载 `installContinuumMemoryContext` 后，模型看到由 active 记录和当前用户文本生成的有界 `continuum-memory` recall 消息。 每条摘录保留记录正文中首个命中词附近的原样窗口；仅 kind 或 scope 命中时使用前缀。摘录包含记录 ID、revision、来源事件引用、记录正文内的 UTF-16 区间和省略方向标记；该区间不表示来源事件内的位置。selector 筛选保留相同元数据。来源事件引用即 `history_read` 的 `event` 参数所接受的事件。

#### Token effect

`maxExcerptBytes` 限制每条摘录；`maxTotalBytes` 限制包含标题、元数据和分隔符的完整召回正文。检索会缩短摘录以满足预算；连元数据和一个字符都放不下时省略该候选。上下文消费者不会额外调用模型；可选 Jev selector 的请求成本单独计算。

#### KV Cache effect

消费者追加有界 recall 消息；在工作集不变时，已有请求前缀保持稳定。

## Known Limitations and Deferred Work

- 当前记录投影是进程内的；重启恢复必须读取并折叠 Session 事件日志。`MemoryRecordIndex` 是 controller 维护的可丢弃派生状态；仍可从投影重建，或用有界积压预算逐步处理排队快照。
- service 不包含完整全文索引，也不会自动把摘要树接入生命周期检索。重启后摘要导航从 Session 事件重建，不是持久化的模型摘要快照。摘要树和缓存 helper 是确定性的本地计量，不报告 provider 缓存账单；记录必须带来源，准入默认由调用方负责，也可以显式开启人类消息准入。
- 自动用户消息准入必须显式 opt-in，使用第一个配置作用域，并将消息文本保存为带来源的 fact。处理私密或敏感对话的部署应保持 `admission: explicit`，改用领域专属的准入调用方。
- 压缩准入只覆盖人类消息；助手回答和工具结果仍可通过 `history_read` 读取，但不会成为记录。准入在队列中时进程退出，会丢失这次判断，重启后该检查点不会再次提交判断。

不发布运行时不变式伴生模块：本包没有由独立所有者维护、需要与 Session 派生投影核对的运行时观测。

<a id="dev-note"></a>
### 开发备注

Session 事件已经复用 `Session.append` 和 `ctx.sessions.flush(session)`。system3 runtime patch 默认关闭地加载本服务和配套 Jev selector；是否启用仍是受保护部署环境的显式选择。
