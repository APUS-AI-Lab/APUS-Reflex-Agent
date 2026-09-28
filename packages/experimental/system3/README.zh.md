---
description: "组合 System3 策略、证据和监督 seam 的 Cordis 服务。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-system3

[English](README.md) | 中文

## 概述

挂载这个显式启用的服务，可以通过一个 `ctx.system3` seam 使用本地优先路由准 入、可恢复证据选择、完成监督、shadow 对照、usage accounting，以及可选的 AgentLoop 观测 seam。它组合纯函数库；观测只记录边界，不修改 prompt、路由或模型结果。

## 目录

- [使用方式](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用方式

在实验 profile 中挂载。默认策略为 `local-only`；远程路由必须显式配置，并且 仍要通过每次调用提供的候选元数据。

```ts
import System3 from '@deepseek-ai/dsh-experimental-system3'

await ctx.plugin(System3, { privacyMode: 'local-only', observeAgentLoop: true })
const decision = ctx.system3.route(candidates, 'local-9b')
```

`ctx.system3.snapshot()` 只暴露操作计数，不暴露用户文本或工具输出。调用方需要 把片段、监督原因、shadow 对照和成本记录写入自己的持久化 Session/audit 层。


### 显式 Jev shadow 决策

在 System3 旁挂载 Jev 插件，然后以决策事实的数据类别以及独立 supervisor 检查调用 `shadowDecision(session, request, signal)`。System3 从检查与目标元数据生成结构化 state 和封闭 action 候选，不接收原始任务或工具文本。即使 Jev 建议完成，返回的 receipt 仍保留确定性 baseline。Timeout、非法响应、缺少 provider 或隐私拒绝会得到 `unknown`。调用方取消会记录 cancelled receipt 并抛出取消错误。

`jevExecutionDomain` 默认为 `network`，只有 Jev 实际在同机执行时才设为 `local`。指向 RunPod 的回环 SSH tunnel 仍然是 `network`。受控远程执行要求配置的 `jevRouteId`（默认 `jev`）及所有输入数据类别都在隐私 allowlist 中。`jevEffort` 选择 `low` 或 `high`（默认 `low`）。

每次显式调用会追加 `system3/decision`，记录 state digest、evidence 引用、模型身份、完整答案概率、provider 提供的 usage 以及未改变的 baseline。完整的结构化 Jev payload 会被记录以便重构；原始任务文本、工具输出和 provider 错误文本被省略。`lastDecision(session)` 从 live 或 restored Session 读取最新的 projection receipt，不调用 Jev。Evidence 引用标识外部检查；evidence 存储仍由 Host 负责。

<a id="understand-the-implementation"></a>
## 实现说明

服务不拥有第二套 agent loop。显式 `shadowDecision(session, request, signal)` consumer 只在捕获的隐私策略准入后调用可选 `ctx.jev` provider。每个策略方法只增加无敏感数据的 计数，然后委派给一个纯策略包。启用 `observeAgentLoop` 后，会为 `agent/pre-step`、`agent/request`、`agent/request-error` 和 `agent/turn-stopping` 安装不修改行为的监听器，边界计数会进入 `snapshot()`。隐私策略在挂载时捕获；Jev 偏好只是 advice，不能覆盖策略。

<a id="model-experience"></a>
## 模型体验

### 统一 System3 seam

#### What the model sees

本包不会自动增加任何内容。Host 决定哪些路由、证据片段或监督动作进入现有 AgentLoop 请求或 Session 投影。

#### Token effect

本包自身没有影响。evidence 方法可以限制调用方的投影，而 usage ledger 会记录 token 数来自 provider 还是估算。

#### KV Cache effect

本包自身没有影响；挂载服务不会改写 prompt 或工具 schema。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 观测不会修改 messages、选择生成 provider 或调度 subagent。Jev 只通过显式 `shadowDecision` 调用运行，其 receipt 不进入主模型 history。
- 服务不执行操作系统级隐私隔离。workspace、环境变量、子进程出网和导出授权仍 由 Host 负责。
- 后续集成在声称端到端 System3 之前，必须固定事件 schema、重放行为、取消语义 和 built profile smoke 测试。

<a id="dev-note"></a>
### 开发备注

服务测试会挂载 Cordis，验证本地优先回退、证据与监督组合、隐私拒绝、计数，并通过 MockAdapter 驱动一轮真实 AgentLoop。运行 `vitest run packages/experimental/system3/tests/service.spec.ts`。

**Runtime invariant:** 不发布 runtime invariant companion。纯策略包校验自身输入；Session projection registry 负责 receipt fold 一致性，本服务不维护独立决策权威。
