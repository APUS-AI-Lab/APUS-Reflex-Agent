---
description: "组合 System3 策略、证据和监督 seam 的 Cordis 服务。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-system3

[English](README.md) | 中文

## 概述

挂载本服务可使用本地优先路由准入、证据选择、完成监督、shadow 对照与 usage accounting。可选观测不会改变 AgentLoop 行为。另行启用 `entryRouting` 后，Jev 为 Session API 准入的空闲文本任务建议生成模型；采纳与取消由 API 负责。

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
import { Context } from '@deepseek-ai/cordis'
import System3, { type System3RouteCandidate } from '@deepseek-ai/dsh-experimental-system3'

const ctx = new Context()
const candidates: System3RouteCandidate[] = [
  { id: 'local-9b', executionDomain: 'local', dataClasses: ['public'] },
]
await ctx.plugin(System3, { privacyMode: 'local-only', observeAgentLoop: true })
const decision = ctx.system3.route(candidates, 'local-9b')
```

`ctx.system3.snapshot()` 只暴露操作计数，不暴露用户文本或工具输出。调用方需要 把片段、监督原因、shadow 对照和成本记录写入自己的持久化 Session/audit 层。


### 显式 Jev shadow 决策

在 System3 旁挂载 Jev 插件，然后以决策事实的数据类别以及独立 supervisor 检查调用 `shadowDecision(session, request, signal)`。System3 从检查与目标元数据生成结构化 state 和封闭 action 候选，不接收原始任务或工具文本。即使 Jev 建议完成，返回的 receipt 仍保留确定性 baseline。Timeout、非法响应、缺少 provider 或隐私拒绝会得到 `unknown`。调用方取消会记录 cancelled receipt 并抛出取消错误。

`jevExecutionDomain` 默认为 `network`，只有 Jev 实际在同机执行时才设为 `local`。指向 RunPod 的回环 SSH tunnel 仍然是 `network`。受控远程执行要求配置的 `jevRouteId`（默认 `jev`）及所有输入数据类别都在隐私 allowlist 中。`jevEffort` 选择 `low` 或 `high`（默认 `low`）。

每次显式调用会追加 `system3/decision`，记录 state digest、evidence 引用、模型身份、完整答案概率、provider 提供的 usage 以及未改变的 baseline。完整的结构化 Jev payload 会被记录以便重构；原始任务文本、工具输出和 provider 错误文本被省略。`lastDecision(session)` 从 live 或 restored Session 读取最新的 projection receipt，不调用 Jev。Evidence 引用标识外部检查；evidence 存储仍由 Host 负责。

### Session API 入口路由

`entryRouting` 默认为 `false`。启用时必须提供 `candidates`、`sessionDataClasses`、`minConfidence` 与 `maxInputBytes`。每个候选声明唯一 `id`、任务 `description`、生成 `provider` 与 `model`、可选 `reasoningEffort`、实际 `executionDomain` 和允许的 `dataClasses`。候选 id 使用 lower-kebab-case；`abstain`、`unknown` 为保留值。重复模型及 effort 组合会被拒绝。`sessionDataClasses` 保守分类生成模型可能读取的整个会话，不只当前文本；分类由宿主负责。

候选生成模型与 Jev 均在任务文本外发前接受隐私策略检查。候选元数据必须声明不小于 baseline 的上下文容量，并支持 baseline 的全部输入模态；未知元数据会排除该候选。不支持的 reasoning effort 在首次解析模型时作为配置错误拒绝。Jev 只收到当前文本、baseline 模型身份和已准入的候选描述，并可在缺少上下文或无法可靠判断时选择 abstain。`maxInputBytes` 限制完整已解析 Jev 请求的 UTF-8 字节数，包括候选与元数据。超限时不截断输入，保留 baseline。

`minConfidence` 是采纳阈值，不是校准后的成功概率。弃权、低置信、隐私拒绝、无兼容候选、Jev 不可用和 provider 故障均不覆盖 baseline。设置 `retainOnAbstain: true` 后，弃权和低置信改为沿用该 Session 上一次入口决策选定或沿用的路由，前提是该路由仍是获准且兼容的候选；记录中以 `retained` 写明来源请求 id，不含 `selected`。provider 故障仍保留 baseline。此选项需要 `sessionProjections`。候选必须支持会话中出现过的全部输入模态：一旦用户消息或工具结果带有图片，就要求候选能读图。没有 System3 运行时投影时，候选必须支持 baseline 支持的全部模态。取消会拒绝调用，不授权输入准入。`system3/entry-decision` 事件保留完整 Jev 请求（包括文本）、已校验响应和建议；未发起决策时 `request` 为 null。请求中的宿主字段 `providerId` 不进入 Jev HTTP 序列化正文。Session API 独立的 `model/automatic-selection` 事件通过相同 request id 标识实际采纳。回放两种事件均不请求模型。插件卸载时移除路由注册。

`entryRouting.deadlineMs` 对基线准备、Jev 建议和所选路由准备共同设限（默认 30000 ms，上限为 `MAX_TIMER_DELAY_MS`）。超时仅能准入已准备且合法的基线；基线未准备完成时拒绝请求，不写入 inbox。基线须匹配已准许的配置候选，或声明 `baseline.executionDomain` 与 `baseline.dataClasses`；独立远端基线使用隐私路由 id `baseline`。取消与提供方卸载会中止待准入请求，迟到建议不会授权再次准入。原生 `resetModelSelection` 为后续合格输入恢复自动路由；用户手选模型保持固定，直到重置。

`skillSelection` 在原生 `agent/pre-step` 扩展点为下游保留的用户输入选择至多一个当前作用域允许模型调用的 Skill。配置包含 `sessionDataClasses`、`minConfidence`、`maxInputBytes`、`maxContentBytes`、`maxCandidates`（1–254）和 `deadlineMs`。Jev 读取当前文本及完整且有界的目录描述，不读取 Skill 正文或会话历史。稳定候选 id 为独立弃权选项保留位置。隐私拒绝、发现不完整、目录超限、低置信度、超时、元数据过期或正文超限时，保留原生模型与工具流程。目录超过 `maxCandidates` 时不声称自动搜索过全部 Skill；显式 `/name` 调用继续使用自身调用策略。

`system3/skill-decision` 记录准确请求、验证后的响应与提供方报告的用量、选择结果，以及拟注入的原生 `injectionMessageId`。加载的正文采用 `skill-invocation` 指令，只有 loop 提交准确的 `user/message` 后才成为模型可见内容，不授予工具权限。`system3Runtime` wire 投影分别呈现 `entry.suggested`、`entry.adopted` 和 `entry.used`，并区分 `skill.selected` 与 `skill.injected`。实际使用须由准确输入所属 turn 的模型输出，或含内容增量、完整内容块的流式 attempt 确认。用量、块占位及仅含结束错误或取消的记录不证明已收到响应；真实内容之后发生错误仍保留响应事实。仅准入不代表已发送模型请求。回放会重建这些事实而不调用 Jev，客户端无法从投影取得提供方原始输入或完整概率。

<a id="understand-the-implementation"></a>
## 实现说明

服务不拥有第二套 agent loop。显式 `shadowDecision(session, request, signal)` consumer 只在捕获的隐私策略准入后调用可选 `ctx.jev` provider。每个策略方法只增加无敏感数据的 计数，然后委派给一个纯策略包。启用 `observeAgentLoop` 后，会为 `agent/pre-step`、`agent/request`、`agent/request-error` 和 `agent/turn-stopping` 安装不修改行为的监听器，边界计数会进入 `snapshot()`。隐私策略在挂载时捕获；Jev 偏好只是 advice，不能覆盖策略。

<a id="model-experience"></a>
## 模型体验

### 统一 System3 seam

#### What the model sees

未启用入口路由时，由宿主决定哪些服务结果进入模型历史。入口路由通过 `state.input` 向 Jev 提供当前文本，通过 `state.baseline` 提供当前模型选择，通过 `questions.route.criteria` 提供有界候选描述。Receipt 不进入生成模型历史。采纳后的模型变化遵循原生 Session API 的模型选择行为。

#### Token effect

在隐私和大小检查允许时，入口路由为每个符合条件的准入输入增加一次 Jev 调用；保留 provider 实际报告的 usage。evidence 方法限制调用方投影，usage 记录区分 provider 计数与估算。

#### KV Cache effect

观测与 shadow receipt 不改变生成请求前缀。采纳生成模型切换可能失去 provider 缓存复用；工具 schema 不变。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 入口路由只覆盖 Session API 符合条件的空闲文本输入，不覆盖 headless、SDK、ACP、附件、排队批次或活跃 steering；不调度专家或控制任务完成。
- 服务不执行操作系统级隐私隔离。workspace、环境变量、子进程出网和导出授权仍 由 Host 负责。
- 入口决策不含会话历史；新文本依赖历史时应弃权。数据类别与候选描述由部署声明；本包无法验证其准确性，也不证明路由质量或成本收益。

<a id="dev-note"></a>
### 开发备注

服务测试会挂载 Cordis，验证本地优先回退、证据与监督组合、隐私拒绝、计数，并通过 MockAdapter 驱动一轮真实 AgentLoop。运行 `vitest run packages/experimental/system3/tests/service.spec.ts`。

**Runtime invariant:** 不发布 runtime invariant companion。纯策略包校验自身输入；Session projection registry 负责 receipt fold 一致性，本服务不维护独立决策权威。
