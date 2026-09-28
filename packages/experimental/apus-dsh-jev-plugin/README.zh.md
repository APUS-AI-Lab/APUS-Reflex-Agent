---
description: "实验性的、与 provider 无关的类型化 Jev 决策服务，以及 System One HTTP provider。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-apus-dsh-jev-plugin

[English](README.md) | 中文

## 概述

让 Jev 模型从给定候选项中选择、对有序标准评分，或估计命题成立的概率。显式 profile 可以把这些类型化问题发送到 System One HTTP gateway，取得经过校验的答案或不可用结果。调用方决定哪些数据离开宿主，以及哪个结果影响其策略。`apus` 只是名称；问题不要求特定部署或模型厂商。

## 目录

- [使用方式](#use-this-package)
- [实现说明](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用方式

宿主需要类型化 Jev 决策时挂载本插件；默认 profile 不包含本包。Jev key 放在 harness credential plane 或启动环境中，由 `apiKeyEnv` 引用。

### 配置 gateway

```yaml
- id: jev
  name: '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
  config:
    endpoint: http://127.0.0.1:30135
    model: APUS-OpenJev-v1-9B-5949
    effort: low
    timeoutMs: 30000
    apiKeyEnv: APUS_JEV_API_KEY
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `endpoint` | 必填 | HTTP gateway 根 URL 或 `/v1` URL |
| `model` | 必填 | 发给 gateway 的模型 id |
| `effort` | `low` | System One 推理 effort：`low` 或 `high` |
| `timeoutMs` | `30000` | 请求期限，单位毫秒 |
| `apiKeyEnv` | 无 | 每次请求解析的凭据引用 |
| `providerId` | `system-one` | 内置 provider 的 registry id |

endpoint 可以是本地 SSH tunnel 或受控服务 URL。配置 URL 不以 `/v1` 结尾时，provider 会补上 `/v1/systemone`；只有 `apiKeyEnv` 解析出值时才会发送 Bearer credential。

### 提交类型化问题

Consumer 提供 state 和完整候选集合。此示例假定 Jev 服务已挂载。

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'

declare const ctx: Context

const outcome = await ctx.jev.decide({
  state: { scene: 'route-admission', fact: 'local-first' },
  questions: {
    route: {
      type: 'choice',
      instructions: 'Choose one supplied candidate.',
      criteria: { keep_local: 'Keep local execution', escalate: 'Escalate to remote' },
    },
  },
})
```

`kind: 'unknown'` 会对 transport、timeout、HTTP、credential 和响应校验错误执行 fail-open。调用方继续以确定性的 System3 策略为权威，并可以记录返回的 failure，而不会暴露请求或响应文本。

-----

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现内部细节——点击展开</summary>

`ctx.jev` 是服务定义和 provider registry。`SystemOneProvider` 是首个 provider 实现，会根据请求中的完整问题集合校验响应，包括候选 key、概率总和、confidence、score 期望值和 usage 计数。网络 I/O 之前会解析 provider，并在返回的 `JevSpec` 中固定生效模型。

本包不拥有 AgentLoop，不选择 LLM 生成路由，不编辑 prompt，不授权 tool，也不持久化 Session receipt。System3 consumer 必须决定调用时机，应用隐私策略并持久化可重放的 receipt。这样 Jev 请求保持显式，provider 也可以替换。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Provider registry 与 fail-open 决策服务 |
| [`src/client.ts`](src/client.ts) | 凭据解析与 System One HTTP transport |
| [`src/protocol.ts`](src/protocol.ts) | Wire 请求和响应校验 |
| — | 不发布 runtime invariant companion：registry 是唯一的 provider 观察来源，每次 HTTP 操作自行校验响应。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下文档说明 consumer 与部署职责。

- [System3](../system3/README.zh.md)——确定性策略与 Session 决策 receipt。
- [LLM adapter](../../llm/llm-pi-ai/README.zh.md)——通过 OpenAI-compatible gateway 发送生成请求。
- [Fidoo 与 RunPod profile](../../../docs/feat-system3-foundation/model-chain.zh.md)——显式的源码 checkout overlay 与凭据引用。

-----

<a id="model-experience"></a>
## 模型体验

### 类型化 decision sidecar

#### What the model sees

本包不会自动向主 LLM prompt 添加内容。Jev 只接收 consumer 提供的 JSON `state` 和问题。

#### Token effect

Jev 使用自己的 provider 请求，不改变主 LLM 请求的 token budget。Consumer 应发送有界 state 或 evidence 引用，而不是原始敏感文本。

#### KV Cache effect

主生成路由不受影响。Jev gateway 可以有自己的 cache 行为。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

以下限制界定本包当前的职责范围。

- 本包没有自动 AgentLoop hook 或 Session 事件；consumer 负责调用时机、隐私准入与持久化 receipt。
- 内置 provider 当前面向 `/v1/systemone`，不是 OpenAI-compatible 的 `llm-pi-ai` route。
- RunPod gateway 的 `30135` 面向同机进程或受控 tunnel，不应直接公开。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
