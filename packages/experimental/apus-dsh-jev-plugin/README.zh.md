---
description: "为配置方案加入可配置 Reflex 决策服务与类型化 System One 提供方的 bundle。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-apus-dsh-jev-plugin

[English](README.md) | 中文

## 概述

这个可选配置方案 bundle 加入 Reflex 决策服务。其 `jev` 行在用户 profile 补丁下方提供部署默认值，保存的模型设置因此对新请求生效。System3 部署在 web profile 中准备该 bundle，标准 profile 不包含它。消费者提交类型化问题，并保留数据共享和行动选择的最终权限。

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

### 加入配置方案层

正式 System3 服务在启动 web profile 前运行 [prepare-profile.mjs](../../../deploy/system3/prepare-profile.mjs)。准备步骤只加入一次此 bundle，并保留既有用户补丁。[cordis.patch.yml](cordis.patch.yml) 提供 `jev` 行；profile 编辑覆盖这些默认值，无需改动 bundle。密钥保存在 Harness 凭据存储或 `apiKeyEnv` 引用的启动环境中。

传输使用 `@typesafe-ai/sdk` 0.6.0，禁用自动重试及 SDK 日志。`protocol: openjev` 发送配置的 effort，`protocol: typesafe` 不发送该扩展。端点可使用 API 根地址或 `/v1` 前缀。超时覆盖凭据解析与响应接收；取消后迟到的凭据不会触发网络调用。state 接受文本、对象、数组和 null。

<a id="configure-the-gateway"></a>
### 配置 gateway

设置 `JEV_ENDPOINT` 和 `JEV_MODEL` 为自己的服务地址和模型。值会去除首尾空白；profile 最终生效的两个字段均未设置或为空时，服务仍提供设置和显式连接测试，但没有已配置的提供方，也不会自动发送网络请求。只配置一个字段或地址非法时启动失败。bundle 使用 `high` 强度和 15 秒超时。旧版仅覆盖 config 的用户 profile 无需环境变量仍会启用；显式 `disabled: true` 优先。也可以通过下方 profile 补丁显式启用并覆盖配置。

`JEV_API_KEY_ENV` 显式指定凭据引用；否则非空的 `JEV_API_KEY` 自动绑定同名引用。两者均未设置时使用匿名端点。已声明但缺失的凭据会在 HTTP 发送前导致决策失败，不要填入假密钥。环境表达式在启动时求值。

```yaml
- id: jev
  disabled: false
  config:
    endpoint: http://127.0.0.1:30135
    model: APUS-OpenJev-v1-9B-5949
    effort: low
    timeoutMs: 30000
    apiKeyEnv: APUS_JEV_API_KEY
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `endpoint` | 空 | HTTP gateway 根 URL 或 `/v1` URL；执行决策前须与 `model` 一同配置 |
| `model` | 空 | 发给 gateway 的模型 id；执行决策前须与 `endpoint` 一同配置 |
| `effort` | `low` | System One 推理 effort：`low` 或 `high` |
| `timeoutMs` | `30000` | 请求期限，单位毫秒 |
| `apiKeyEnv` | 无 | 每次请求解析的凭据引用 |
| `keepAliveMs` | 无 | 专用直连连接空闲后保留复用的时长；省略时使用进程级传输。经已配置 HTTP 代理的请求始终使用代理的传输 |
| `http2` | `false` | 在专用连接上协商 HTTP/2；需要 `keepAliveMs` |
| `resetAfterFailures` | 无 | 连续这么多次请求没有响应后销毁专用连接池，下一次请求打开新连接；HTTP/2 下所有请求共用一条连接，否则一条卡住的连接会让之后的每次判定都失败。需要 `keepAliveMs`；省略时从不重建连接池 |
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

默认提供方尚未配置时，解析或执行请求会在读取凭据或发送 HTTP 前抛出配置错误；请求中显式指定模型也不能绕过此要求。此状态下 `warm` 返回 false。`kind: 'unknown'` 会对 transport、timeout、HTTP、credential 和响应校验错误执行 fail-open。调用方继续以确定性的 System3 策略为权威，并可以记录返回的 failure，而不会暴露请求或响应文本。

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
- [模型服务 profile](../../../docs/feat-system3-foundation/model-chain.zh.md)——显式的源码 checkout overlay 与凭据引用。

-----

## Reflex 模型配置

本包也提供标准 profile bundle，承载可编辑的 Reflex 默认值。APUS 部署将该 bundle 放在用户 profile 之下；命令行 overlay 不得重复声明 `jev` 条目，否则配置覆盖机制会按设计拒绝持久化编辑。

表单 schema 只包含可序列化的数据；服务在初次加载和所属 `internal/config` 更新流程中校验地址。非法地址在 profile 写入前被拒绝。

`jev` Loader 条目将服务地址、模型、决策强度、超时、协议和凭据引用作为 volatile 设置提供。“Reflex 模型配置”专用页面通过 ConfigForms 编辑条目，通过 Credentials 保存 API Key；新请求读取已提交的值，执行中的请求保留已解析的提供方配置。连接池参数由部署管理。

`reflex` Remote 命名空间提供 `readStatus` 和 `testConnection`。OpenJev 连接测试先检查 `/health`，再鉴权访问 `/v1/models` 并确认所选模型，再向 `/v1/systemone` 发送不含用户内容的固定是非判断。测试接受未保存的配置和可选临时密钥，不持久化它们，只返回脱敏错误类别与耗时，也不会把任务能力标记为已验收。运行时模块通过 `registerCapability` 注册能力状态读取器，并负责释放注册。

`ReflexCapabilityId` 标识三个能力所有者；`ReflexCapabilityState` 包含安装、启用、实际执行结果及只读部署参数。`ReflexStatus` 汇集这些状态与已配置提供方；首次配置前或清空两个字段后，`provider` 为 `null`。`ReflexConnectionInput` 描述未保存候选及可选临时密钥；`ReflexConnectionResult` 报告测试阶段、脱敏状态及耗时。

目标相关性监督单独报告 `semanticSupervision.enabled` 状态。只有监督模块已安装、处于 active 模式、显式配置语义证据且当前工作区数据策略允许时才启用。该子能力未启用时，操作指纹监督仍可启用；两种状态均不代表已验证执行效果。

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
