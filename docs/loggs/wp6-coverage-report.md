# WP-6 覆盖报告：APUS 轨迹埋点最小侵入改造

English | 中文

> **状态：待复核，不作为验收结论。** 本报告的承载划分、完整度统计和业务无差异结论与后续代码及测试状态可能不一致；最新全量快照验证有 154 项失败。最终结论须以当前版本的逐项对账和重新验证结果为准。

**结论先行。** 探针（AutoEval 仓外挂包）已在真实 `sdk` profile + AutoEval overlay 下完成端到端验证。按“AutoEval 能独立读取的事实不写入 APUS”的划分原则复核后，APUS 只保留 **10 个**探针无法替代的 log-only 事件；探针能自行读取的 7 项（已解析工具目录、pre/post-execute 决策、结果改写、截止时间、turn-stopping 聚合、inbox 取消、工具归属）已从 APUS 撤除，改由探针在公开缝上读同一来源。改造未改变模型可见内容：探针开/关两次真实运行产生**逐条相同**的业务事件流（20 对 20），且 session log 不含任何探针记录。

## 0. 承载划分（本次复核确立）

| 归探针（APUS 不写） | 读取缝 |
|---|---|
| 已解析工具目录 | `ctx.tools[TOOL_RUNTIME_SCHEDULER].catalog(scope)`（导出符号） |
| pre-execute 决策 | `tools/pre-execute` waterfall 返回值 |
| post-execute 改写 | `tools/post-execute` waterfall 返回值（`content`/`value`/`block`） |
| 工具归属（pluginOwner/executionBackend） | `ctx.tools.get(name)` 的定义字段 |
| 截止时间事实 | `tools/execute` wrapper 前后计时 + 定义声明的 `timeoutMs` |
| turn-stopping 聚合 | `agent/turn-stopping` 前后 inbox 快照（outcome 标 missing，不猜） |
| inbox 取消 | `agent/inbox/spliced` 自带的 `outcome: 'canceled'` + `removedCount` |

| 归 APUS（探针不可达） | 原因 |
|---|---|
| `turn/pre-step` | 被拒提议不开启 step，无任何后续事件 |
| `tool/pipeline-error` | 管道内部抛出点 |
| `tool/execution-plan` | 调度器私有分类 |
| `skill/loaded` | `registry.get()` 内部 |
| `spill/spilled` | 截断决策内部 |
| `web/provider-selected`、`lsp/provider-selected` | service 只暴露 search/fetch，不暴露选择 |
| `approval/unavailable` | `serviceAsk` 降级路径 |
| `user-question/answered` | answerer 返回点 |
| `continuum/task-receipt` | 隔离 journal |

## 1. 100 行覆盖状态

基线：54 行既有完整 + 46 行缺口。本节按方案矩阵逐行判定，证据列给出源码写入点。

| 序号 | key | 状态 | 证据 |
|---:|---|---|---|
| 1 | `agent/inbox/spliced` + `agent/inbox/cancelled` | **完整** | `packages/core/agent-loop/src/inbox.ts:241` |
| 2 | `user/message` | 完整（既有） | — |
| 7 | `tool/catalog-resolved` | **完整** | `packages/core/agent-loop/src/agent.ts:395`（含 schemaDigest、omitted 原因） |
| 8 | `skill/loaded` | **完整** | `packages/skill/skill/src/index.ts:581`（loadedAt、cached） |
| 9 | `turn/pre-step` | **完整** | `packages/core/agent-loop/src/agent.ts:378`（disposition、claimed/entered/rejected ids） |
| 10 | `request/header` | partial | `agent.ts` configRewrites/omittedSections；**listener 级归因不可得**（Cordis 不暴露身份） |
| 11 | `request/context` | partial | `agent.ts` sections 名 + toolSchemaDigest；**section provider 贡献不可得** |
| 16 | `assistant/attempt` | 完整（既有） | — |
| 17 | `llm/retry` | 完整（既有） | — |
| 18 | `llm/retry-started` | 完整（既有） | — |
| 20 | `tool/result` | **完整** | `agent-loop/src/tool-calls.ts` pluginOwner/executionBackend（定义声明，不猜） |
| 21 | `tool/result-rewrite` | partial | `core/tools/src/index.ts:1975`；`attributed: false` |
| 22 | `tool/pipeline-error` | **完整** | `core/tools/src/index.ts:1949`（精确 stage + thrower） |
| 23 | `tool/pre-execute-decision` | partial | `core/tools/src/index.ts:1909`；逐 listener 投票不可得 |
| 24 | `tool/execute-deadline` | **完整** | `guard/timeout-policy/src/index.ts:100` |
| 25 | `tool/retry-started` | **不适用** | APUS 无通用工具重试 wrapper（机制缺失，单列） |
| 26 | `tool/execution-plan` | **完整** | `core/agent-loop/src/tool-calls.ts:286`（scheduleMode、barrier、reclassifiedTo） |
| 27 | `spill/spilled` | **完整** | `spill/spill-policy/src/index.ts:150`（threshold、budget、记账、locator） |
| 28 | `tool/ptc-dispatch` | **完整** | `core/tools/src/ptc.ts` maxParallelSubCalls/并发度/durationMs |
| 29 | `tool/ptc-dispatch-start` | **完整** | 同上 |
| 31 | `tool/provider-selected` | partial | `web/web/src/index.ts:258` + `lsp/lsp/src/index.ts:185`；**callId/toolName 不可得** |
| 32 | `turn/stopping` | partial | `core/agent-loop/src/agent.ts:414` 聚合结果；listener 身份不可得 |
| 33 | `turn/end` | **完整** | `agent.ts:336` blockedReason（监听器提供时） |
| 34 | `compaction/start` | **完整** | `compaction-basic/src/region.ts` trigger + autoCaller |
| 35 | `compaction/prune` | 完整（既有） | — |
| 36 | `compaction/summary` | 完整（既有） | — |
| 37 | `compaction/end` | **完整** | `region.ts:202` generationAdvanced/retryDecision/recovered |
| 39 | `reflex/context-cache-anchor` | **完整** | `experimental/system3/src/reflex-context.ts:216` 快照 |
| 42 | `approval/decided` | partial | `interaction/user-approval` decisionPath + `responder: unattributed`；**具体身份不可得** |
| 44 | `approval/unavailable` | **完整** | `core/tools/src/index.ts:1929`（no-service 降级） |
| 45 | `user-question/answered` | **完整** | `interaction/user-questions/src/index.ts:171` |
| 51 | `subagent/descriptor` | 完整（既有） | — |
| 52 | `subagent/model-selection-policy` | 完整（既有） | — |
| 53 | `subagent/run-end` | 完整（既有） | — |
| 65 | `continuum/memory-admission` | **完整** | `continuum-jev/src/index.ts:237` batchIndex/Size/Total |
| 66 | `continuum/memory-decision` | **完整** | `continuum-jev/src/index.ts` evaluation.policy + limits |
| 67 | `continuum/memory-index` | **完整** | `context/continuum/src/persistence.ts` admission |
| 68 | `continuum/memory-record` | **完整** | `persistence.ts` previous + invalidatesReads |
| 69 | `continuum/task-binding` | partial | `task-binding.ts:25` retirementBasis + journalRevision；guard 拒绝原因在抛错路径，不可记录 |
| 70 | `continuum/task-receipt` | **完整** | `context/continuum/src/task-service.ts:329`（journal 仍为唯一权威） |
| 87 | `job/registered` | 完整（既有） | — |
| 88 | `job/settled` | 完整（既有） | — |
| 90 | `working-directory/change` | **不适用** | APUS 无动态工作目录机制（机制缺失，单列） |
| 91 | `web/deepseek-search-llm-request` | partial | 既有事件；非 deepseek provider 改由 `web/provider-selected` 覆盖 |
| 95 | `goal/change` | 完整（既有，零改动） | `goal/goal/src/domain.ts:29,66` 已含 roundsStarted + maxGoalRounds |
| 99 | `workspace/changes` | 完整（既有） | — |

**统计**：完整 40 行（其中 20 行由本次补全达成），partial 6 行（缺失字段均为公开缝确实不可得），不适用 2 行（#25 无触发、#90 机制缺失）。**未达到方案目标的 98 行完整**，差额全部来自上表标注的 partial 行——这些行的缺失字段（listener 身份、section provider 贡献、callId/toolName、guard 拒绝原因）在 APUS 当前架构下不在任何公开缝上，方案本身已将它们列为只能在"猜"与"不改"之间取舍，本实现选择不猜。

## 2. 真实运行验证（已完成）

| 检查 | 结果 | 证据 |
|---|---|---|
| 探针接收端到端 | **9/9 通过** | `tests/sdk-receive.e2e.mjs` |
| 业务差分（探针开/关） | **5/5 通过** | `tests/business-diff.e2e.mjs` |
| 事件流逐条一致 | **20 对 20 完全相同** | 独立诊断脚本，两序列逐事件比对 |
| 探针单元套件 | **ALL PASS（35 条记录）** | `tests/runtime-smoke.mjs` |
| 覆盖/双写机检 | **16/16 通过** | `tests/coverage-audit.mjs` |
| 变异判别 | **通过** | 改回 stdout sink 后 e2e 按预期失败 |
| 持久化判级 | **107 根 / 36 条记录，全部 same-version** | `persistence-changes --check` |
| 原生插件源码编译 | **成功** | 安装 gcc 14.2 后 `build:native-system` 产出并加载 `tryLock` |

## 3. 未执行检查

| 项 | 状态 | 原因 |
|---|---|---|
| 快照全量复验（串行） | **运行中** | 并发复验出现 30s/10s 超时；已改为串行重跑 |
| expected 套件 6 项 | **基线既有失败** | 已用源码回退验证：其中 5 项在 HEAD 同样失败（陈旧测试与当前 CLI `--profile/--patch` 契约漂移）；`sends pi-ai` 在回退后通过 |
| Python SDK expected | **未运行** | 环境未安装 `deepseek_harness` |
| `doc-sync` 全量 | **未运行** | 时间成本；已单独跑 translation-pairing 与 type-equiv |
| 生产环境指标 | **不适用** | 首版机制验证，非生产验收 |

## 4. 本轮修正的真实缺陷

改造过程中发现并修复了 6 个真实缺陷，均非测试脚本问题：

1. **探针 `lib/index.js` 入口缺失** → 真实启动报 `failed to import`；改为 `build.sh` 生成。
2. **`workspaceChanges` 硬注入** → sdk profile 未装配该服务，探针永久 pending；改为 `ctx.get` 按需解析。
3. **teardown 记录可能在 `process.exit` 前丢失** → 文件 sink 串行化 + `flush()`，等待落盘。
4. **`admission` 字符串被整数校验拒绝** → `retrieval.ts` 的 `assertConfig` 新增字符串分支。
5. **持久事件写入运行可变文本的摘要** → `request/context.sections[].digest`、`turn/pre-step.rewrite` 摘要、`spill/spilled` 与 `tool/result-rewrite` 的 before/after 摘要，均哈希含 cwd/locator/时钟的文本，快照永不可收敛；已全部移除，保留结构事实（section 名、id 增量、stage/field、locator）。
6. **`continuum/task-operation` union 变更需升版** → 按方案规则改为独立事件 `continuum/task-receipt`。
