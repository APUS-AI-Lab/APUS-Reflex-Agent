---
description: "组合 System3 策略、证据和监督 seam 的 Cordis 服务。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-system3

[English](README.md) | 中文

## 摘要

挂载这个显式启用的服务，可以通过一个 `ctx.system3` seam 使用本地优先路由准
入、可恢复证据选择、完成监督、shadow 对照、usage accounting，以及可选的
AgentLoop 观测 seam。它组合纯函数库；观测只记录边界，不修改 prompt、路由或模型结果。

## 目录

- [使用方式](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用方式

在实验 profile 中挂载。默认策略为 `local-only`；远程路由必须显式配置，并且
仍要通过每次调用提供的候选元数据。

```ts
import System3 from '@deepseek-ai/dsh-experimental-system3'

await ctx.plugin(System3, { privacyMode: 'local-only', observeAgentLoop: true })
const decision = ctx.system3.route(candidates, 'local-9b')
```

`ctx.system3.snapshot()` 只暴露操作计数，不暴露用户文本或工具输出。调用方需要
把片段、监督原因、shadow 对照和成本记录写入自己的持久化 Session/audit 层。

<a id="understand-the-implementation"></a>
## 实现说明

服务不拥有第二套 agent loop，也不拥有网络客户端。每个策略方法只增加无敏感数据的
计数，然后委派给一个纯策略包。启用 `observeAgentLoop` 后，会为
`agent/pre-step`、`agent/request`、`agent/request-error` 和 `agent/turn-stopping`
安装不修改行为的监听器，边界计数会进入 `snapshot()`。隐私策略在挂载时捕获；Jev
偏好只是候选排序提示，不能覆盖策略。

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

- 观测不等于决策集成：目前不会选择 provider、修改 messages、调用 Jev、持久化证据或
  调度 subagent。只有在具体 Host profile 的重放、取消和隐私测试覆盖后，才应增加决策
  hook。
- 服务不执行操作系统级隐私隔离。workspace、环境变量、子进程出网和导出授权仍
  由 Host 负责。
- 后续集成在声称端到端 System3 之前，必须固定事件 schema、重放行为、取消语义
  和 built profile smoke 测试。

<a id="dev-note"></a>
### 开发说明

服务测试会挂载 Cordis，验证本地优先回退、证据与监督组合、隐私拒绝和计数。运行
`vitest run packages/experimental/system3/tests/service.spec.ts`。
