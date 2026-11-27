# APUS Agent 轨迹埋点技术方案（外挂探针优先）

本方案用一个 AutoEval 持有的外挂探针插件作为主记录层，不改 APUS 仓库源码、不更换 executor、不改变任何准入、审批、重试、压缩或调度结果。探针通过公开的 live 扩展点、Session 事件、JobRegistry.events、workspaceChanges 和 sessionProjections 采集事实，经探针自带 sink 写成 log-only 记录（live-only，不写回 session log）。只有探针在公开缝上确实看不到的私有事实，才进入第二阶段的“定点补全”：由事实属主在原提交点增加可选字段或伴随记录，仍然不改变业务行为。

> 机制订正（核实于 APUS 提交 `c080afc80b`，2026-10-28）：APUS 没有方案早期设想的 `appendPluginRecord()` / `PluginRecordMap` API。真实记录 API `Session.append()` 构造事件时不设 `ignorable`，且无任何 overload 能设它；持久化读取端（`session-persistence/src/storage-contract.ts:75`）对“未知类型且非 ignorable”拒绝整条日志；`KNOWN_SESSION_EVENT_TYPES` 由生成器只扫 APUS 仓内源码维护，仓外插件的 declaration merging 永不进入。因此“探针记录写回 session log 且可重放”在零源码改动约束下不成立，会破坏 session JSONL 恢复。APUS 自身的外挂记录插件 `session-telemetry`（订阅 `session/event` firehose + `agent/error`，经自带后端写出，全程不碰 session log）是仓内现成范式。本方案据此将探针记录改为 live-only：live 观察所有事件，整理成 `ProbeRecordData`，经探针自带 sink 送出，AutoEval 的 SDK 采集走 live 通道（首版已通过 `RunResult.events` / `RunResult.notifications` 消费）。已获用户确认走此路径。代价：放弃原 REQ-03 的“持久化可重放”——session JSONL 重放不再能恢复探针记录；AutoEval 的 Langfuse 全量覆盖目标不依赖该能力，故无损。

范围以 [Agent 轨迹追记持久化事件总表](../../../AutoEval/docs/logging-plan/agent-trajectory-persistence-events.md) 的 100 行为准。按 APUS 当前源码核对：54 行现有事件已经完整；其余 46 行需要补记录，其中探针基线可直接完整记录 12 行、部分记录 29 行、完全不可见 4 行、无触发路径 1 行。第二阶段定点补全后，98 行可完整记录；`working-directory/change` 因 APUS 没有该机制，超出“只补记录”的范围；`tool/retry-started` 当前没有通用工具重试 wrapper，只保留合同。

本文是设计稿，未获评审、未实施、未执行测试。探针包位于 AutoEval 仓，不写入 APUS；AutoEval 的 SDK 采集与 Langfuse 写入不在本方案范围。下文的状态词：`现状` 为本次源码核对，`设计` 为拟议改动，`待验证` 为实施后验证，`不适用` 附机制缺失依据。

## 执行约定

- 文档版本与日期：v1.0，2026-10-28；本版为单一方案，探针是主记录层，定点补全是其后的缺口关闭步骤。
- 适用基线：`/home/Project/Harness/APUS-Reflex-Agent`，提交 `c080afc80b`。
- 需求来源：用户指定以最优先的外挂探针插件方式实现完整埋点记录，并整合为一份方案。
- 固定约束：不改 APUS 源码作为第一阶段前提；不改 `vendor/`；不更换 executor、answerer 或审批通道；不为产生事件新增业务机制；记录失败不改变业务结果；未执行验证不写成通过。
- 完整判定：某一行的总表字段均有事实来源，且探针或补全记录带 `coverage: complete`、`missing: []`，才算完整。partial、none、不适用分别统计，不进入完整分子。

## 需求评审

### 需求基线

| 编号 | 需求与预期结果 | 验收判据 | 状态 |
|---|---|---|---|
| REQ-01 | 外挂探针作为主记录层，不修改 APUS 源码 | 探针包、依赖与 overlay 都在 AutoEval 仓；APUS 注册表、profile、package.json 无改动 | 设计 |
| REQ-02 | 探针不改变现有链路行为 | 固定 fixture 下过滤探针记录后，模型历史、工具结果、审批/问答、重试、调度、错误完全一致 | 待验证 |
| REQ-03 | 探针记录 live 可采集，根/子会话均可收 | 探针经自带 sink live 写出 `ProbeRecordData`；不写回 session log、不参与 JSONL 持久化与重放；AutoEval SDK 经 live 通道采集 | 设计（修订） |
| REQ-04 | 100 行全部有处置 | 54 现有完整 + 12 探针完整 + 29 补全 + 3 不可见补全 + 1 无触发 + 1 机制缺失 | 设计 |
| REQ-05 | 记录失败不制造业务失败，也不静默丢完整性 | 探针写失败只告警计数；补全写失败只告警；原业务不回滚；缺失可机检 | 设计 |
| REQ-06 | 不破坏 session log 兼容 | 探针不向 session log 写任何记录，旧日志读写不受影响；补全走 persistence-change 分类；需升版时停止该项 | 设计（修订） |
| REQ-07 | 隐私、资源与异常路径有界 | 不记凭据；大内容用 digest/摘要；取消、异常、崩溃、迟到完成有预期 | 设计 |
| REQ-08 | 分批交付且可回退 | 探针基线独立可回退；补全按属主分批；回退不删除已提交日志 | 设计 |

### 覆盖基线

| 分类 | 数量 | 处置 |
|---|---:|---|
| 现有事件已完整 | 54 | 不改；探针原样采集 |
| 探针可完整记录 | 12 | 探针伴随记录或读取公开服务 |
| 探针 partial，需定点补全 | 29 | 探针先记可观察部分并输出 missing；补全关闭缺口 |
| 探针完全不可见 | 4 | #23、#32、#70 定点补全；#90 机制缺失 |
| 无触发路径 | 1 | #25 只保留合同 |
| 合计 | 100 | 98 行可完整记录，1 行机制缺失，1 行无触发 |

现有 54 行中包含 system3、team、hooks 等事件；它们只有在对应模块挂载时产生。AutoEval 当前 `sdk` profile 未挂载这些模块，因此“不会出现”是组合事实，不是记录缺口；本方案不为了产生它们而改变 profile。

### 标杆项目调研

| 既有能力 | 探针如何复用 | 不重复建设 |
|---|---|---|
| `session-telemetry` 范式（仓内现成外挂记录插件） | 探针订阅 `session/event` firehose + `agent/error` 等 live 事件，整理成 `ProbeRecordData`，经自带 sink 写出，全程不碰 session log | 不写 `session.append()`、不声明 `SessionEventMap`、不手改 `KNOWN_SESSION_EVENT_TYPES` |
| Cordis `ctx.on(..., { prepend: true })` waterfall | pass-through listener 只读参数并原样 `next()` | 不改 `dispatch/serial/waterfall`，不包 vendor |
| `JobRegistry.events.subscribe` | 订阅 registered/settled/progress，取得完整 JobView | 不改 jobs-local，不新增 jobs 事件 |
| `ctx.workspaceChanges.summary` | 按 workspace/changes 事件 seq 读取文件清单与统计 | 不重算 diff，不复制 summary |
| `ctx.sessionProjections.stateOf(..., 'sandboxMode')` | 读取当前生效 sandbox 模式 | 不改沙箱策略 |
| 全量 `session/event`（含子会话） | 探针订阅所有会话，记录子会话事实 | 不把子会话事件搬进根会话 |
| AutoEval overlay | 在现有 Jev/Continuum overlay 后插入探针行 | 不改 APUS profile 源文件 |

### 业务流程

| 步骤 | 动作 | 记录 | 不变保证 |
|---|---|---|---|
| 1. 启动 | AutoEval overlay 在首个 Agent 动作前挂载探针 | 写 `probe-status`：版本、enabledProbes、开始时间 | 不改 profile 源文件 |
| 2. 观察 | 探针注册 pass-through waterfall、emit 观察者、Job 订阅和 Session 索引 | 内存台账只保存关联信息 | 不修改参数、决定、结果、异常 |
| 3. 记录 | 在安全边界经自带 sink live 写出 `ProbeRecordData` | 记录含 canonicalKey、coverage、missing、关联 id | 不进入模型历史，不写 session log |
| 4. 失败 | append 失败或 observer 抛错 | 计数并 warning | 原业务返回/异常不变 |
| 5. 采集 | SDK 照常发送 `session.event` | AutoEval 另案接收根/子会话记录 | 本方案不改 SDK |
| 6. 补全 | 第二阶段属主在原提交点增加可选字段/伴随记录 | 与探针记录按 canonicalKey 互斥 | 不改业务判断 |

### 边界场景

| 场景 | 记录预期 | 禁止行为 |
|---|---|---|
| 探针晚挂载 | 生命周期起点缺失，标 partial，missing 含未观察边界 | 补造开始时间或完整覆盖 |
| 探针记录 append 失败 | 原业务不变，droppedRecords 增加，完整性检查失败 | 回滚业务、重试工具、静默通过 |
| `session/event` 回调 | 只更新内存索引，不写记录 | 在回调内 append 造成重入 |
| 未接入的外挂 listener | 汇总标 partial/unattributed | 从函数名或栈推断身份 |
| 无 answerer 的审批/问答 | 探针仍 `next()`，保持原 unavailable/error | 为生成记录自行回答 |
| 无 `log` 的 standalone batch | 不写 root call/result 伴随记录，不编 turn/step | 伪造模型请求上下文 |
| 子会话 | 探针按 sessionId 记录 | 把子会话 event 复制到父会话 |
| 记录含大内容 | digest/preview/裁剪事实 | 默认保存完整正文或取消既有上限 |
| 取消/异常/迟到完成 | 记录实际终态和 missing | 把未知写成成功 |

### 功能取舍

1. 探针是唯一默认记录层；定点补全只处理探针“看不到”的私有事实，不作为平行替代方案。
2. 探针记录使用 `plugin:` 命名空间，不冒充仓内 canonical 事件；AutoEval 按字段读取，不要求 key 与总表完全同名。
3. 补全仍使用仓内 canonical key 与可选字段/伴随事件；它与探针记录按 `canonicalKey + subject` 互斥，避免双写。
4. 不为了完整而改变 executor、answerer、沙箱、重试或调度；如果某字段只能通过改变行为获得，保持 partial 并说明。
5. `working-directory/change` 需要先有动态工作目录功能，属于产品变更，不在“只补记录”范围。
6. 当前没有通用工具重试 wrapper，`tool/retry-started` 只保留合同；未来出现 wrapper 时由其属主记录。

### 技术选型

| 方案 | 侵入与风险 | 决定 |
|---|---|---|
| 外挂探针 + 定点补全 | 探针零源码改动；补全只碰少量私有事实；可按项互斥 | 采用 |
| 全部由探针实现 | 会迫使探针猜测私有状态或包裹 executor，改变行为且不可验证 | 拒绝 |
| 全部由仓内属主补记 | 源码侵入面大，探针能拿到的公开事实也要改内核 | 拒绝 |
| 改 Cordis 调度器统一拦截 | 影响所有事件、顺序与错误路径，维护 vendor 分叉 | 拒绝 |
| 全局 ObservationService | 新增服务生命周期与 profile 注入，且私有事实仍需属主提供 | 拒绝 |

### 运维预期

探针新增开销来自 pass-through listener、digest、Session 通知和插件记录字节；补全新增少量同步 append。当前没有实测增长率，不预设百分比。探针必须复用已计算数据，不重新执行工具、不重跑摘要、不重读大文件、不复制完整 prompt。

不记录 API key、Authorization header、凭据环境变量值或未脱敏搜索 body。改写记录以前后 digest 为主；问答/steer 文本只在其已经进入模型轨迹的既有路径记录。

## 架构设计

### 对象抽象

| 对象 | 职责 | 约束 |
|---|---|---|
| `ProbeRuntime` | 插件实例级索引：session/run/turn、已见生命周期、droppedRecords | 不使用模块级 singleton；卸载即释放 |
| `ProbeRecorder` | 构造并写完一条 `ProbeRecordData`（经自带 sink 送出） | 只写 JSON 快照、不写 session log；失败只告警计数 |
| `CoverageManifest` | 内存中的 canonicalKey→coverage/missing 台账 | 供 probe-status 与 AutoEval 机检；不参与业务 |
| `ServiceFacts` | 从 jobs、workspaceChanges、sandboxMode 读公共事实 | 只读；不触发新业务 |
| `CompletionAdapter` | 第二阶段补全点与探针记录的去重协调 | 按 canonicalKey+subject 互斥 |

### 类结构设计

探针包位于 `/home/Project/AutoEval/probes/apus-trajectory-probe/`：

```text
probes/apus-trajectory-probe/
  package.json          peerDependencies: @deepseek-ai/cordis, @deepseek-ai/dsh-session
  src/index.ts          apply(ctx, config)；挂载/卸载
  src/runtime.ts        ProbeRuntime、索引、生命周期
  src/records.ts        ProbeRecordData 构造、schemaVersion、自带 sink 写出
  src/sink.ts           live-only sink：把 ProbeRecordData 送出探针边界（stdout/文件/SDK 通知），不写 session log
  src/listeners.ts      pass-through waterfall、emit 观察、Session/Job 订阅
  src/facts.ts          jobs、workspaceChanges、sandboxMode 只读适配
  src/coverage.ts       CoverageManifest 与 missing 计算
  tests/                对照 fixture、失败注入、重放
```

APUS 侧不新增类。第二阶段的补全点只在原属主包增加私有函数或可选数据，不新建服务。

### 接口定义

**探针记录：** 探针按逻辑类别组装 `ProbeRecordData`，经自带 sink live 写出（不写 session log、不声明 `SessionEventMap`）。类别用作去重与 coverage 归并的 canonicalKey 前缀，不是 session 事件类型：

| 类别（非 session 事件） | canonicalKey 归并的事实 |
|---|---|
| `pre-step` | canonicalKey=turn/pre-step 或 agent/inbox/spliced 的可观察部分 |
| `request` | request/header、request/context 的补充事实 |
| `tool` | tool/catalog、pre-execute、execute、post-execute、result 的补充事实 |
| `compaction` | compaction 的补充事实 |
| `subagent` | descriptor、steer、run-end 的事实 |
| `job` | job/registered、job/settled 的事实 |
| `workspace` | workspace/changes 的补充事实 |
| `coverage` | probe-status、missing 汇总与 droppedRecords |

每条事实记录含：

```ts
interface ProbeRecordData {
  schemaVersion: 1
  canonicalKey: string
  coverage: 'complete' | 'partial'
  missing: string[]
  probeVersion: string
  at: number
  subject: { sessionId: string; seq?: number; callId?: string; runId?: string; jobId?: string; messageId?: string }
  facts: JsonValue
}
```

`coverage=complete` 仅当总表该行在当前场景要求的字段全部在 `facts` 中且 `missing=[]`。推测值、默认值和组合推断不得写入 complete。

**配置：**

```ts
interface ProbeConfig {
  enabledProbes: readonly ('pre-step' | 'request' | 'tool' | 'compaction' | 'subagent' | 'job' | 'workspace')[]
  includeChildSessions: boolean
}
```

`enabledProbes` 是部署选择；第二阶段补全上线后，对应项从配置移除，避免双写。配置不改变模型输入或业务分支。

**公开只读接口：**

| 接口 | 用法 |
|---|---|
| `ctx.jobs.events.subscribe({ owners: 'all' }, listener)` | registered/settled/progress/stopping/removed 事实 |
| `ctx.workspaceChanges.summary(sessionId, seq)` | 文件清单、total、added/deleted、snapshot |
| `ctx.sessionProjections.stateOf(session, 'sandboxMode')` | 当前生效沙箱模式 |
| `ctx.on('session/event', ...)` | 全部会话（含子会话）事件索引 |
| `ctx.on(name, listener, { prepend: true })`，name 取 `agent/pre-step`、`agent/request`、`system-prompt/assemble`、`tools/pre-execute`、`tools/execute`、`tools/post-execute`、`approval/request`、`user-questions/request` | pass-through 观察；逐事件注册，不使用通配符 |
| `ctx.on('subagent/start', 'subagent/end', 'agent/assistant-stream', ...)` | 生命周期与流观察 |

### 调用时序设计

**挂载：**

```text
overlay 插入探针行
  → apply(ctx, config) 注册全部 listener/订阅
  → 若已有 live session，补一次索引并标 partial(start=late)
  → 经自带 sink 写 coverage(started)
```

**单次工具调用：**

```text
tools/pre-execute (prepend)
  → 读取 exec(callId/name/args/agent)
  → await next() 一次 → 原 gate
  → 记录聚合 gate 与可观察顺序（complete/partial）
tools/execute / tools/post-execute (prepend)
  → 读取公开 exec/result → next() 一次 → 记录阶段差异（digest）
session/event(tool/result)
  → 关联 callId → 读 sandboxMode 投影 → 写 tool fact
```

**Job：**

```text
ctx.jobs.events.subscribe
  → registered: 记录 jobId/kind/label/owner/startedAt
  → settled: 记录 status/detail/finishedAt/cause/awaited
```

**子代理：**

```text
session/event(subagent/descriptor, request/header) → 索引 child
subagent/start → 记录 startedAt
subagent/end → 以同一 stopReason/output 写 run-end；duration=end-start
父会话 session/event(subagent/steer) → 关联 runId/text
```

**失败与卸载：** 任何 append 失败只捕获该调用；listener 异常原样抛出；卸载注销全部 listener 与 Job 订阅并停止记录。

### 功能模块划分

| 模块 | 位置 | 职责 |
|---|---|---|
| 挂载与配置 | 探针 `index.ts` | overlay 入口、enabledProbes、卸载 |
| Session 索引 | `runtime.ts` | 全部会话事件、子会话、turn/call/run 关联 |
| Pass-through 监听 | `listeners.ts` | pre-step/request/assemble/tools/approval/questions |
| 生命周期观察 | `listeners.ts` | assistant-stream、subagent start/end |
| 公共事实适配 | `facts.ts` | jobs、workspace、sandboxMode |
| 记录与覆盖 | `records.ts`/`coverage.ts` | plugin record、missing、probe-status |
| 定点补全（第二阶段） | APUS 各属主包 | 见覆盖矩阵的“补全属主” |

### 外部调用梳理

探针不新增网络、模型、工具或文件业务写入，不向 session log 写任何记录。外部可见面只有：探针自带 sink 的 live `ProbeRecordData` 输出、SDK `session.event` 通知、失败时已有 `logger.warn`。不读取凭据；不修改 `DEEPSEEK_BASE_URL`、profile、overlay 或运行时目录。

### 功能分层

| 层 | 内容 | 约束 |
|---|---|---|
| L0 探针 | AutoEval 外挂包、overlay、公共 listener/服务读取 | 零 APUS 源码改动 |
| L1 载荷补全 | 现有事件增加可选字段 | 不改 fold、source、reason、required |
| L2 包内伴随记录 | 属主在私有决策点新增 log-only 事件 | 不新增业务机制 |
| L3 管道属主台账 | ToolRuntime/pipeline 记录每阶段与逐 listener | 不改 Cordis、不猜外部身份 |
| L4 循环属主 | agent-loop 记录 pre-step/装配/turn-stopping 内部事实 | 不改状态机与提交时机 |
| L5 隔离/机制 | Continuum journal 只读回执；动态 cwd 不在本期 | 不建第二存储，不新增产品功能 |

## 埋点覆盖与补全设计

### 探针基线覆盖矩阵

以下 46 行是 54 行“现有完整”之外的缺口。判定口径：**完整** = 探针能独立拿到该行全部要求字段；**partial** = 只拿公开部分，缺字段列在残余列；**none** = 公开缝完全不可见；**不适用** = 当前无触发路径。

| 序号 | 事件 key | 探针基线 | 残余与补全属主 |
|---:|---|---|---|
| 1 | `agent/inbox/spliced` | partial | 缺 cancelled-before-admission；entered/rejected 可观察；属主 `core/agent-loop` |
| 2 | `user/message` | 完整 | — |
| 10 | `request/header` | partial | 缺 listener 级改写归因、排除 section 原因；属主 `core/agent-loop` |
| 11 | `request/context` | partial | 缺 section provider 贡献；digest 可算；属主 `core/agent-loop` |
| 16 | `assistant/attempt` | 完整 | — |
| 17 | `llm/retry` | 完整 | — |
| 18 | `llm/retry-started` | 完整 | — |
| 20 | `tool/result` | partial | 缺 pluginOwner、executionBackend；sandboxMode 可读投影；属主 `core/tools + 工具定义属主` |
| 28 | `tool/ptc-dispatch` | partial | 缺 maxParallelSubCalls、真实重叠度；属主 `core/tools（PTC）` |
| 29 | `tool/ptc-dispatch-start` | partial | 同 28；属主 `core/tools（PTC）` |
| 33 | `turn/end` | partial | 缺 blocked 的 pre-step 拒绝原因；属主 `core/agent-loop` |
| 34 | `compaction/start` | partial | 缺 trigger、自动调用方身份；属主 `compaction-basic` |
| 35 | `compaction/prune` | 完整 | — |
| 36 | `compaction/summary` | 完整 | — |
| 37 | `compaction/end` | partial | 缺 generationAdvanced、retryDecision、是否恢复；属主 `compaction-basic` |
| 39 | `reflex/context-cache-anchor` | partial | 缺 revision/topic/constraints 快照；属主 `experimental/system3` |
| 42 | `approval/decided` | partial | 缺 responder 身份、waterfall 短路；属主 `interaction/user-approval` |
| 52 | `subagent/model-selection-policy` | 完整 | — |
| 65 | `continuum/memory-admission` | partial | 缺 batchIndex/batchSize/回读一致性；属主 `experimental/continuum-jev` |
| 66 | `continuum/memory-decision` | partial | 缺预算/池/threshold/tag routing；属主 `experimental/continuum-jev` |
| 67 | `continuum/memory-index` | partial | 缺 admitter 判定来源；属主 `context/continuum` |
| 68 | `continuum/memory-record` | partial | 缺 sourceRefs 完整链/generation token；属主 `context/continuum` |
| 69 | `continuum/task-binding` | partial | 缺 guard 拒绝原因/digest 来源；属主 `context/continuum` |
| 91 | `web/deepseek-search-llm-request` | partial | 缺非 deepseek provider 与 fallback 链；属主 `web/web` |
| 95 | `goal/change` | partial | 缺 blocked 轮数与阈值；属主 `goal/goal` |
| 99 | `workspace/changes` | 完整 | — |
| 51 | `subagent/descriptor` | 完整 | — |
| 70 | `continuum/task-operation` | none | 隔离 journal 无 session/event；属主 `context/continuum` |
| 7 | `tool/catalog-resolved` | partial | 缺 registry/when/executor/listener 各 skipReason；属主 `core/tools + 内置 executor` |
| 8 | `skill/loaded` | partial | 缺 loadedAt、cached；属主 `skill/skill` |
| 9 | `turn/pre-step` | partial | 缺下游 rejectReason；属主 `core/agent-loop` |
| 21 | `tool/result-rewrite` | partial | 缺 sourceListener 与逐阶段归因；属主 `core/tools（pipeline）` |
| 22 | `tool/pipeline-error` | partial | 缺精确 stage/thrower；属主 `core/tools（pipeline）` |
| 23 | `tool/pre-execute-decision` | none | 逐 listener 投票不可见；属主 `core/tools（pipeline）` |
| 24 | `tool/execute-deadline` | partial | 缺生效预算、selfTimerWon、signalReplaced；属主 `guard/timeout-policy` |
| 25 | `tool/retry-started` | 不适用 | 当前无通用工具重试 wrapper |
| 26 | `tool/execution-plan` | partial | 缺 reclassifiedCalls/barrier/scheduleMode；属主 `core/tools（batch）` |
| 27 | `spill/spilled` | partial | 缺生效 threshold 与内部记账；属主 `spill/spill-policy` |
| 31 | `tool/provider-selected` | partial | 缺非 deepseek/LSP 的 selectionMode；属主 `web/web + lsp/lsp` |
| 32 | `turn/stopping` | none | 逐 listener 投票不可见；属主 `core/agent-loop` |
| 44 | `approval/unavailable` | partial | 缺 no-service/no-agent 路径；属主 `core/tools（serviceAsk）` |
| 45 | `user-question/answered` | partial | 缺 answeredBy；属主 `tool-ask-user + user-questions` |
| 53 | `subagent/run-end` | 完整 | — |
| 87 | `job/registered` | 完整 | — |
| 88 | `job/settled` | 完整 | — |
| 90 | `working-directory/change` | none | APUS 无动态工作目录机制；属主 `不新增` |

### 定点补全清单

29 个 partial、3 个可补的 none（#23、#32、#70）需要属主补全；#90 不在本期；#25 只保留合同。按属主归并如下：

| 属主包 | 覆盖行 | 深度 | 最小改动 |
|---|---|---|---|
| core/agent-loop | #1、#9、#10、#11、#32、#33 | L4 | 在原 pre-step、assembly、turn-stopping 调用点增加可选观察数据或 log-only 伴随记录；#32 由 turn-stopping 属主逐 listener 记录 |
| core/tools | #7、#20、#21、#22、#23、#26、#28、#29、#44 | L2/L3 | 在 ToolRuntime/pipeline、PTC、serviceAsk 的现有决策点补记；#23 由 pre-execute waterfall 属主逐 listener 记录 |
| guard/timeout-policy | #24 | L2 | 在 tools/execute wrapper 内记录生效预算与 timer 事实 |
| spill/spill-policy | #27 | L2 | 在截断决策处记录 threshold、locator、bytes、digest |
| skill/skill | #8 | L2 | 在 collect/get 返回处记录 loadedAt、cached |
| compaction/compaction-basic | #34、#37 | L1 | 把已有 trigger/generation/retry 事实写入现有事件 |
| experimental/system3 | #39 | L1 | 把 revision/topic/constraints 快照写入现有事件 |
| interaction/user-approval | #42 | L2 | 在 decide 的聚合点记录 responder 与短路事实 |
| interaction/tool-ask-user + user-questions | #45 | L2 | 在 answerer 返回处记录 answeredBy；不新增通道 |
| experimental/continuum-jev + context/continuum | #65、#66、#67、#68、#69、#70 | L1/L5 | 在现有 append 点补字段；#70 增加 journal 提交后的业务会话只读回执，journal 仍是唯一权威 |
| web/web + lsp/lsp | #31、#91 | L2 | 在 provider 选择点记录实际 provider/latency/fallback；LSP 同理 |
| goal/goal | #95 | L1 | 在 goal/change 提交点补 blocked 轮数与阈值 |

补全的共同规则：

1. 只在原提交点增加可选字段或 log-only 伴随事件；不改变任何现有字段的必填性、类型和语义。
2. 新增记录不参与业务恢复、重试、调度、审批或投影；原有事件仍是权威。
3. 若 persistence 工具判定需要 version-bump，停止该项并改伴随记录，不强行升版。
4. 补全上线后，AutoEval 从 `enabledProbes` 移除对应项；AutoEval 按 `canonicalKey + subject` 检查重复，不按到达顺序去重。

### 完整性判定与机检

探针每次运行经自带 sink 写一条 coverage 记录（`category="coverage"`），包含 `enabledProbes`、`droppedRecords`、每个 canonicalKey 的 `complete/partial/none` 与 `missing`。AutoEval 采集后执行以下检查：

1. 每个 canonicalKey 至少一条记录；无记录时必须显式 `none` 并给出原因。
2. `complete` 必须 `missing=[]`；`partial` 必须列出 missing；二者不得同时为真。
3. 同一 `canonicalKey+subject` 只允许一个生产者；发现探针与补全双写即失败。
4. 探针记录被过滤后，业务结果与基线一致；未被过滤时，模型历史不变。
5. 覆盖率报告分母固定为 100，零分母不记 100%；#90、#25 单列，不计入完整分子。

### 覆盖演进与最终状态

| 阶段 | 内容 | 完整行数 | 说明 |
|---|---|---:|---|
| 基线 | 现状 + 54 行现有完整 | 54 | 无探针、无补全 |
| 第一阶段 | 探针基线 | 66 | +12 行探针完整；29 行 partial 带 missing |
| 第二阶段 | 定点补全 | 98 | +32 行；#90 机制缺失、#25 无触发 |
| 最终 | 全部处置 | 98 完整 + 2 单列 | 100 行全部有结论，但不是 100 行都完整 |

### 为什么不能只用探针达到 100

以下事实不属于公开缝：其他 listener 的个体决策（#23、#32）、pipeline 内部精确阶段与抛出者（#21、#22）、executor 私有上限（#28、#29）、压缩触发原因（#34、#37）、Continuum 预算与判定来源（#65–#69）、隔离 journal（#70）、responder 身份（#42、#45）、工具插件归属与执行后端（#20）、spill 生效阈值（#27）、skill 缓存状态（#8）、goal blocked 阈值（#95）。探针若猜这些值，就违反“记录不等于事实”；若包裹 executor 或 listener 链，就改变行为。因此这些只能由属主补全，属于本方案第二阶段，而不是另一条替代路线。

## 开发规范

1. 探针包只依赖 APUS 公开包；禁止 import `src/**`、私有路径或 `vendor/**`；TypeScript strict，不使用 `as unknown`。
2. 所有 pass-through listener 必须 `await next()` 恰好一次；异常原样抛出；不修改参数、决定、结果或 signal。
3. 不使用模块级 singleton；状态挂在 ProbeRuntime 实例，卸载释放。
4. sink 写出失败只捕获该调用，命名 error 并说明业务为何不受影响；禁止空 catch。
5. 记录 data 必须是 lossless JSON；新字段先在 `ProbeRecordData` 与 schemaVersion 声明，再写兼容测试。
6. 不把探针事实塞进 ToolBatchResult、ToolExecutionResult.meta、UserMessage.source、EpochHeader 或模型 content。
7. 第二阶段补全遵守 APUS 现有规范：JSDoc 说明来源/提交时刻/关联 id/缺失语义；每包同步 README、subsystem、快照。
8. `known-event-types.ts`、persistence catalog/schema 由生成器维护；不手改。
9. 隐私：不记录凭据；大内容用 digest/preview；问答与 steer 只记录已进入轨迹的文本。
10. 每个 canonicalKey 必须有唯一属主和唯一写入路径；跨包字段由提供事实的属主提供，不由消费方猜。

## 环境配置

### 环境与依赖盘点

基线已见 Node v24.21.0、pnpm 11.7.0、Python 3.12.15。探针包只使用 AutoEval 现有 Node 工具链与 APUS 公开 peer 依赖；不新增服务、数据库、端口或凭据。

### 配置与身份管理

探针配置：`enabledProbes`、`includeChildSessions`；无必需环境变量。AutoEval overlay 在现有 Jev/Continuum 行之后插入：

```yaml
- insert:
    - id: autoeval-trajectory-probe
      name: /home/Project/AutoEval/probes/apus-trajectory-probe/lib/index.js
      config:
        enabledProbes: [pre-step, request, tool, compaction, subagent, job, workspace]
        includeChildSessions: true
```

探针配置：`enabledProbes`、`includeChildSessions`；无必需环境变量。`executorId/listenerId/pluginOwner/providerId` 使用注册时显式声明的稳定标识；未声明为 `unknown`/`unattributed`。SDK answerer 若已启用，可按公开组合标 `sdk-host`，否则不猜。

### 安装依赖与初始化

探针包作为 AutoEval 工作区包构建；APUS 不安装新依赖。构建产物为 `lib/types/index.js`，由 overlay 绝对路径挂载。WP-1 已于 2026-10-28 执行：`tsc -p tsconfig.json`（APUS tsc 6.0.3）零错通过，`lib/types/{index,records,sink}.js` 均产出；runtime 依赖经 `link-deps.sh` 将 `node_modules/@deepseek-ai/{cordis,schemastery}` 符号链接至 APUS vendor。

### 依赖启停管理

探针随 APUS runtime 子进程启停；无独立后台线程、队列或 flush。卸载只移除 overlay 行；已写日志保留。

### 编译启动与环境交接

第一阶段：构建探针包（AutoEval 侧），用现有 overlay 顺序挂载，验证 APUS `--dump-config` 中出现探针行。WP-1 已于 2026-10-28 执行：`dsh --profile sdk --patch config/autoeval-continuum.patch.yml --dump-config` 退出码 0，探针行在 continuum-memory 之后合成、无 loader 报错；自包含 `tests/runtime-smoke.mjs`（无 vitest 依赖）构造真实 `Context`、挂载探针、触发 `session/created`/`session/disposed`，断言 sink 写出 `coverage/started`/`coverage/stopped`、卸载写出 stopped 标记、`enabled=false` 不产出记录，5 项全部通过。第二阶段：按属主包运行 vitest、`pnpm run build:artifacts`、`pnpm run build:check`、`pnpm run doc-sync`；持久化变更先运行 `pnpm run gen-persistence-catalog` 并生成记录。第二阶段命令尚未执行。

## 测试方法

### 测试目标、单元边界与分层

1. 探针单元：记录 schema、coverage/missing、索引、失败计数、卸载。
2. 组合集成：真实 overlay 挂载，验证 listener 顺序、Session/Job/SDK 通知和重放。
3. 业务差分：同一 fixture 下无探针/有探针、无补全/有补全，过滤记录后业务结果一致。
4. 完整性机检：每个 canonicalKey 的 complete/partial/none 与 missing 可判定。

### 可测试性设计与依赖替身

复用 APUS 现有 Session/Agent/tool/executor 测试工厂；deferred Promise 控制 pre-step、重试、timeout、job settle、subagent end。固定时钟、id、provider 响应；禁止真实模型、搜索或生产存储外呼。探针测试不依赖 APUS 仓内测试夹具，避免把探针绑到私有实现。

### 用例推导与断言设计

| 编号 | 场景 | 独立预期 |
|---|---|---|
| T-01 | 无探针/有探针跑同一 conversation 与工具批次 | 模型历史、工具结果、turn reason、错误、顺序一致（探针不写 session log，故无需过滤） |
| T-02 | 每个 pass-through listener 正常/异常 | next 恰好一次；返回/异常身份不变；记录在 next 后写入 |
| T-03 | sink 写出失败、session/event 自观察 | 原业务不变；droppedRecords 增加；无递归 |
| T-04 | 子会话 descriptor、request/header、steer、end | 子会话记录带正确 sessionId/runId；不复制到父会话 |
| T-05 | jobs registered/settled/progress/stopping/removed | 记录与 JobView 一致；原 jobs 行为不变 |
| T-06 | workspace/changes 未截断/截断 | 记录 files/total/complete；不重算 diff |
| T-07 | sandboxMode 投影与工具结果 | 记录实际模式；投影缺失时 missing 标 unknown |
| T-08 | pre-step enter/reject/空改写/取消 | disposition 与消息 id 正确；cancelled-before-admission 标 missing |
| T-09 | 工具 listener 短路/抛错/未接入外部 listener | 记录已执行部分；未接入标 partial；原 gate 不变 |
| T-10 | timeout/abort 分别获胜 | 外层 elapsed 与 error code 正确；内部 timer 事实标 missing |
| T-11 | assistant stream 硬中断 | attempt-start 已写、settled 缺失标 partial |
| T-12 | 审批/问答无 answerer 与 SDK answerer 启用 | 无 answerer 原 degrade；有 answerer 记录事实但不猜 answeredBy |
| T-13 | 探针与补全同时启用同一 canonicalKey | 机检失败，阻止双写 |
| T-14 | 不带探针恢复含 plugin records 的日志 | 模型历史不变；记录仍可读 |
| T-15 | 第二阶段每个补全点 | 新字段/伴随记录只在原提交点出现；业务差分零变化 |
| T-16 | #90、#25 | 明确不适用/无触发，不产生虚假记录 |

### 测试工程、夹具与数据

在 AutoEval 仓运行探针测试，使用 APUS 构建产物作为 peer；业务 fixture 与探针 fixture 分文件。补全测试在 APUS 各包内使用现有入口。业务快照与记录快照分开更新，禁止一次性 update 后默认全部正确。

### 单元测试实现与开发闭环

按“记录断言先失败 → 最小实现通过 → 业务差分仍通过”执行。探针测试不得修改 APUS 测试或依赖私有夹具；补全测试不得修改既有业务预期。

### 异步、状态与确定性

pre-step、批处理、重试、timeout、job、subagent 使用 deferred/虚拟时钟；等待原公开终态后断言；检查 ledger 清空、listener 注销、无遗留 Promise、无额外业务调用。

### 覆盖率与测试有效性

探针包按 AutoEval 现有覆盖要求；APUS 补全按 `packages/*/*/src` 要求。负例至少包括：漏记短路 listener、把 partial 写 complete、双写未检出、append 失败改变业务、子会话记录复制到父会话、猜测 answeredBy。

### 持续集成与回归门禁

探针包独立 CI；补全按 APUS 门禁运行所属包测试、`build:check`、`doc-sync` 与 persistence checks。公共类型或 SDK 通知变化同步 TypeScript/Python expected outputs。任何业务差分、双写、partial 冒充 complete 均阻断。

### 测试维护、评审与验收

验收分别报告：探针基线完整/partial/none、补全后完整、业务差分、持久化兼容、未触发/不适用、未执行项。覆盖率分母固定 100；#90、#25 单列。探针包与补全点各有维护 owner。

## 方案交付复核

### 工作包与顺序

| 批次 | 内容 | 依赖 | 停止条件 |
|---|---|---|---|
| WP-0 | 基线 fixture、业务差分器、100 项处置账、覆盖机检 | 无 | 无法区分业务与记录、或账目不能复算则停止 |
| WP-1 | 探针包骨架、overlay、sink、ProbeRecordData、pass-through listener、失败 containment | WP-0 | 任一 listener 非一次 next 或业务差分非零（**已通过**，2026-10-28：build+dump-config+runtime-smoke） |
| WP-2 | Session/子会话索引、pre-step、request、assistant 流、coverage | WP-1 | 子会话记录串父会话、partial 写 complete（**已通过**，2026-10-28：pre-step/request/assemble/assistant-stream/subagent 监听器 + 子会话索引） |
| WP-3 | 工具/compaction/subagent/job/workspace 事实与公共只读适配 | WP-1/2 | 不替换 executor/answerer；job/workspace 读取不得重算业务（**已通过**，2026-10-29：三个工具 waterfall 原样透传并出 dispatch digest；tools/result 经 sandboxMode 投影、无投影则 missing 不猜；compaction/workspace/PTC 会话事件与 job 订阅按族 gate；22 项 runtime-smoke 全过 + dump-config 七族挂载于 continuum-memory 之后） |
| WP-4 | 探针完整性报告、SDK 接收验证、与补全互斥检查 | WP-2/3 | 双写未检出或 missing 不可机检（**已通过**，2026-10-29：真实 sdk profile + 本 overlay 的 keyless e2e 9 项全过——协议应答、file sink 收到 coverage/started 与 turn/pre-step、request/header、assembly 级 request/context、teardown stopped+summary（droppedRecords=0、enabledProbes 逐字、workspace/changes 显式 none 带原因）、stdout 仅 JSON-RPC、session log 无探针记录；变异判别：改回 stdout 后同一 e2e 在“sink 文件未创建”处按预期失败；audit 机检 16 项全过，双写按 canonicalKey+完整 subject 判定且与到达顺序无关；探针在 sdk profile 正常激活（workspaceChanges 改为按需解析，因该服务仅 web-app 装配）；teardown 末尾等待 sink flush，完整性账号在进程退出前落盘） |
| WP-5 | 第二阶段补全：core/agent-loop、core/tools、guard、spill、skill、compaction、system3、approval、questions、continuum、web/lsp、goal | WP-4 | 任一补全改变业务差分或需 version-bump 未处理（**已实施**，2026-10-30：十个属主批次全部落盘；17 个新 log-only 事件的写入点逐一核实；持久化判级 107 根全部 same-version，无升版；`continuum/task-operation` 的 union 变更按规则改为独立事件 `continuum/task-receipt`） |
| WP-6 | 真实 profile 组合、故障注入、全量差分、最终覆盖报告 | 全部 | 业务差分、silent partial、双写、未执行项未列均阻止完成（**部分通过**，2026-10-30：真实 sdk profile + overlay 的接收 e2e 9/9、业务差分 e2e 5/5、探针开/关事件流逐条相同 20 对 20、覆盖机检 16/16、变异判别通过；覆盖报告见 [wp6-coverage-report](wp6-coverage-report.md)。**未达 98 行完整**：40 行完整、6 行 partial（缺失字段确不在公开缝上）、2 行不适用；快照串行复验与 Python SDK expected 未完成） |

WP-1 至 WP-4 可与 WP-5 的接口设计并行；WP-5 按属主包拆分，core/tools 与 core/agent-loop 由指定维护者集成，避免同文件并发修改。探针先上线，补全按 canonicalKey 逐项替换，不设一次性大切换。

### 兼容与回退

- 探针回退只移除 overlay；探针不写 session log，故无已写记录需保留或兼容，模型历史不变。
- 补全回退只停止新写入；已提交字段仍可被旧读者读取；需要 deletion 时不删除日志。
- 探针记录不参与业务恢复；journal、Session、jobs 仍是权威。
- 探针与补全双写是可机检的部署错误，不是兼容策略。

### 明确边界

| 事项 | 处置 | 说明 |
|---|---|---|
| #90 working-directory/change | 不适用 | APUS 无动态工作目录机制；新增属于产品功能 |
| #25 tool/retry-started | 合同保留 | 当前无通用工具重试 wrapper；未来 wrapper 属主记录 |
| #23、#32 逐 listener 投票 | 第二阶段补全 | 公开 waterfall 只回传聚合，必须属主记录 |
| #70 隔离 journal | 第二阶段补全 | 探针不可读隔离 realm；补业务会话只读回执 |
| system3/team/hooks 等未挂载模块 | 组合事实 | 不改变 profile；挂载后探针自动采集 |
| agent-preset/selected | 不新增 | sdk profile 未挂载；组合变更单独评估 |
| AutoEval 子会话/idle 后采集 | 外层方案 | 探针只提供记录，采集与 Langfuse 写入另案 |

### 集中待确认事项

1. 是否接受探针包位于 AutoEval 仓、以 APUS 公开包为 peer，并通过 overlay 挂载；APUS 源码零改动。
2. 是否接受“探针优先、定点补全兜底”的单一方案，以及 98 完整 + #90 机制缺失 + #25 无触发的最终账。
3. 是否接受探针记录为 live-only、经自带 sink 送出（不写 session log、不持久化可重放），不冒充 canonical 事件，AutoEval 按字段读取并按 canonicalKey 去重。（机制订正已获用户确认走此路径；此条保留为范围确认。）
4. 是否接受扩展监听器对未接入外部 listener 显式标 partial，不通过改名或包裹取得身份。
5. 是否接受第二阶段补全只增加可选字段/伴随记录，且 persistence 要求升版时停止该项。
6. 是否批准在第一阶段先交付探针与 12 项完整、29 项 partial；第二阶段再关缺口。

机制订正（live-only、不写 session log、经自带 sink 送出）已于 2026-10-28 获用户确认；其余事项见上“集中待确认事项”，未逐项获准前本文仍为可评审设计，不构成实施批准。即使全部获准，APUS 的职责是暴露 live 扩展点（firehose 事件与 waterfall 监听器）供探针观察，探针记录经自带 sink 送出、不写 session log；Langfuse 的完整覆盖仍需 AutoEval 的根/子会话采集、idle 后补读与记录完整性检查共同验收。
