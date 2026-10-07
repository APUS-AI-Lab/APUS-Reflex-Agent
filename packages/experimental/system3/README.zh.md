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

`minConfidence` 是采纳阈值，不是校准后的成功概率。弃权、低置信、隐私拒绝、无兼容候选、Jev 不可用和 provider 故障均不覆盖 baseline。设置 `retainOnAbstain: true` 后，弃权和低置信改为沿用该 Session 上一次入口决策选定或沿用的路由，前提是该路由仍是获准且兼容的候选；记录中以 `retained` 写明来源请求 id，不含 `selected`。provider 故障仍保留 baseline。此选项需要 `sessionProjections`。委派候选用 `delegate: { provider, tool }` 取代 `provider`/`model`，写明已注册的 subagent provider 及其面向模型的工具；只有该 provider 已注册且工具对发起请求的 Agent 可见时，才交给 Jev 选择。选中后保留 baseline 模型，在记录的 `candidate.delegate` 中写明目标，并在首次携带该输入的 pre-step 注入一条来源为 `system3-delegation` 的用户消息，请模型调用该工具；模型可以不采纳。投影分别报告指令已注入和之后的工具调用，沿用规则不会延续委派。委派候选可选的 `explicitPatterns` 列出用户明确要求委派时的表达，为不区分大小写的正则表达式，例如 `交给\s*codex`；通过准入与可用性检查后，输入命中即选定该候选，不发送 Jev 请求，记录中写明 `explicit: true`，`request` 为 null。无效或空白的规则在加载时报错。候选可选的 `label` 会随决策记录，客户端在决策到达时即可显示路由名称。`keepWarm: { windowMs, intervalMs }` 在插件启动后和每轮结束后的 `windowMs` 内按该间隔发送 Jev 预热请求，使下一次入口决策复用已打开的连接；`intervalMs` 应短于网关的空闲连接超时。候选必须支持会话中出现过的全部输入模态：一旦用户消息或工具结果带有图片，就要求候选能读图。没有 System3 运行时投影时，候选必须支持 baseline 支持的全部模态。取消会拒绝调用，不授权输入准入。`system3/entry-decision` 事件保留完整 Jev 请求（包括文本）、已校验响应和建议；未发起决策时 `request` 为 null。请求中的宿主字段 `providerId` 不进入 Jev HTTP 序列化正文。Session API 独立的 `model/automatic-selection` 事件通过相同 request id 标识实际采纳。回放两种事件均不请求模型。插件卸载时移除路由注册。

`entryRouting.handoffPack: { recentMessages, maxMessageChars, minProbability, deadlineMs }` 在注入委派指令前审阅用户更早的消息。它取最近 `recentMessages` 条（最多 16 条）已提交、只含文本且不超过 `maxMessageChars` 个字符的用户消息（不含被委派的这条输入），向 Jev 发送一个请求：`state.task` 为被委派的文本，每条消息一个引用其原文的是否题，判断它是否是执行这个任务时仍然有效的工作要求，例如命名规范、不许改动的文件或必须通过的检查。概率不低于 `minProbability` 的消息按时间顺序原文附在指令末尾，并要求模型把它们写进委派任务、核对结果时逐条检查。`system3/handoff-pack` 事件在指令之前记录完整请求、响应、结果和被转交消息的 id。隐私拒绝、Jev 缺失或失败、审阅超过 `deadlineMs` 时只发送指令本身；轮次被取消时 pre-step 拒绝。

`entryRouting.deadlineMs` 对基线准备、Jev 建议和所选路由准备共同设限（默认 30000 ms，上限为 `MAX_TIMER_DELAY_MS`）。超时仅能准入已准备且合法的基线；基线未准备完成时拒绝请求，不写入 inbox。基线须匹配已准许的配置候选，或声明 `baseline.executionDomain` 与 `baseline.dataClasses`；独立远端基线使用隐私路由 id `baseline`。取消与提供方卸载会中止待准入请求，迟到建议不会授权再次准入。原生 `resetModelSelection` 为后续合格输入恢复自动路由；用户手选模型保持固定，直到重置。

`entryRouting.routeHealth: { window, sampleTtlMs, minSamples, maxFirstTokenMs, minTokensPerSecond, minOutputTokens, maxErrorRate, probe }` 测量本上下文中经过 `llm/stream` 的每个模型流。每个完成的流记录从流开始到第一个 token 的延迟、产出至少 `minOutputTokens` 时首个 token 之后的每秒输出 token 数，以及是否以错误结束；被取消的流不记录。每条线路保留最近 `window` 个、未超过 `sampleTtlMs` 的样本。某项指标样本数达到 `minSamples` 后，错误占比超过 `maxErrorRate`、首字延迟中位数超过 `maxFirstTokenMs`，或输出速度中位数低于 `minTokensPerSecond` 时，线路判为降级，按此顺序检查。只要还有其他兼容候选，入口路由就把降级的模型候选排除在 Jev 请求之外，在决策的 `avoided` 中记录它们及原因；委派候选从不被避开。配置 `probe: { idleMs, maxTokens }` 后，超过 `idleMs` 没有样本的模型候选会收到一个最多输出 `maxTokens` 个 token、不含任何 Session 数据的固定请求，使被避开的线路能重新测量。样本只在进程内保存，重启后从空开始。运行时投影以 `entry.avoided` 暴露被避开的线路标签，客户端把它们附在路由说明后面。

`delegationProgress: { intervalMs, monitor? }` 把 Agent 委派的每个子 agent 运行的 `system3/delegation-progress` 快照写入该 Agent 的 Session：开始时一次，有步骤时每个 `intervalMs` 最多一次，结束时带停止原因再写一次。快照包含 provider、开始时间、已用时长、各类别已完成步骤数、进行中的步骤、最近一次步骤的时间以及子 agent 最近的简短进度说明；不含命令、路径、工具输入或结果，也不对模型可见。配置 `monitor: { overtimeMs, stallMs, startupMs }` 后，运行在 `startupMs` 内没有第一个步骤、每次超过 `stallMs` 没有新步骤、以及每到 `overtimeMs` 的整数倍时，System3 还会写入 `system3/delegation-alert`。快照还记录该运行是否接受运行中输入（`steerable`）。运行时投影以 `subagentRun` 暴露最新一次运行及其说明、未解除的提醒、运行期间的 `steerable`，以及它接受的最近三条 `subagent/steer` 文本；客户端显示说明、带继续等待、补充说明和停止操作的提醒，以及通过 `subagents.steerByParent` 发送文本的补充说明表单。只有上报活动的 provider（Codex 与 Claude Code）会产生运行中快照。

`processSupervision: { mode, repeatedError, failedAttempts, stalledSteps, delegateFailures, editTools, delegationTools, shellTools, progressTools, verifyPattern, failurePattern }` 对每个顶层 Agent 轮次应用确定性规则，规则触发时写入 `system3/process-notice`：同一工具失败达到 `repeatedError` 次（失败键由工具名、错误码或退出码，以及数字归一后的结果首行组成）；失败调用达到 `failedAttempts` 次；连续 `stalledSteps` 次调用没有成功的修改、委派、通过的验证，或 `progressTools`（例如联网搜索）中工具的成功调用；轮次在修改或委派之后、没有通过的验证就要结束（`missing-evidence`）；单次委派运行中失败命令达到 `delegateFailures` 条。结果为错误或报告非零 `exitCode` 的 shell 调用算失败；`command` 匹配不区分大小写的 `verifyPattern` 且成功的 shell 调用算验证；管道只报告最后一段命令的退出码，因此带管道的验证只有在输出不匹配 `failurePattern` 时才算数。每条规则在每个轮次、每个对象上最多触发一次，用户的新消息会重新计数。`observe` 只记录；`advise` 还会给主模型建议：工具结果类规则把建议作为附加上下文挂在触发它的结果上，`missing-evidence` 对该轮次 steer 一次，让模型再运行一步。委派运行中的失败只记录、不建议。监督从不阻止、改写或重试工具调用。运行时投影以 `notices` 暴露当前轮次最近五条发现，客户端在 dock 中列出。

`skillSelection` 在原生 `agent/pre-step` 扩展点为下游保留的用户输入选择至多一个当前作用域允许模型调用的 Skill。配置包含 `sessionDataClasses`、`minConfidence`、`maxInputBytes`、`maxContentBytes`、`maxCandidates`（1–254）和 `deadlineMs`。Jev 读取当前文本及完整且有界的目录描述，不读取 Skill 正文或会话历史。稳定候选 id 为独立弃权选项保留位置。隐私拒绝、发现不完整、目录超限、低置信度、超时、元数据过期或正文超限时，保留原生模型与工具流程。目录超过 `maxCandidates` 时不声称自动搜索过全部 Skill；显式 `/name` 调用继续使用自身调用策略。

`system3/skill-decision` 记录准确请求、验证后的响应与提供方报告的用量、选择结果，以及拟注入的原生 `injectionMessageId`。加载的正文采用 `skill-invocation` 指令，只有 loop 提交准确的 `user/message` 后才成为模型可见内容，不授予工具权限。`system3Runtime` wire 投影分别呈现 `entry.suggested`、`entry.adopted` 和 `entry.used`，在 `history` 中保留最多 100 条输入已进入轮次的更早决策，并区分 `skill.selected` 与 `skill.injected`。实际使用须由准确输入所属 turn 的模型输出，或含内容增量、完整内容块的流式 attempt 确认。用量、块占位及仅含结束错误或取消的记录不证明已收到响应；真实内容之后发生错误仍保留响应事实。仅准入不代表已发送模型请求。回放会重建这些事实而不调用 Jev，客户端无法从投影取得提供方原始输入或完整概率。

<a id="understand-the-implementation"></a>
## 实现说明

服务不拥有第二套 agent loop。显式 `shadowDecision(session, request, signal)` consumer 只在捕获的隐私策略准入后调用可选 `ctx.jev` provider。每个策略方法只增加无敏感数据的 计数，然后委派给一个纯策略包。启用 `observeAgentLoop` 后，会为 `agent/pre-step`、`agent/request`、`agent/request-error` 和 `agent/turn-stopping` 安装不修改行为的监听器，边界计数会进入 `snapshot()`。隐私策略在挂载时捕获；Jev 偏好只是 advice，不能覆盖策略。

<a id="model-experience"></a>
## 模型体验

### 统一 System3 seam

#### What the model sees

未启用入口路由时，由宿主决定哪些服务结果进入模型历史。入口路由通过 `state.input` 向 Jev 提供当前文本，通过 `state.baseline` 提供当前模型选择，通过 `questions.route.criteria` 提供有界候选描述。Receipt 不进入生成模型历史。采纳后的模型变化遵循原生 Session API 的模型选择行为。配置 `handoffPack` 时，委派指令末尾可能附上用户更早提出的要求；`advise` 模式下，过程监督每触发一条规则就加入一条来源为 `system3-supervision` 的用户消息，例如：

##### 缺少验证的建议

```markdown
[System3 过程监督] 本轮修改了文件或完成了委派，但还没有运行通过的测试或构建来验证。请先运行项目的验证命令，再向用户报告结果；如果无法验证，请明确说明原因。
```

##### 交接包中的要求

```markdown
[System3 交接包] 用户在本会话前面提出过以下要求。委派时请把它们原文写进交给 <label> 的任务，并在核对结果时逐条检查：
- <earlier message, verbatim>
```

#### Token effect

在隐私和大小检查允许时，入口路由为每个符合条件的准入输入增加一次 Jev 调用；保留 provider 实际报告的 usage。evidence 方法限制调用方投影，usage 记录区分 provider 计数与估算。每条监督建议增加 50 到 100 个输入 token，交接包增加被转交消息本身、约 60 个 token 和一次 Jev 请求；`advise` 模式下 `missing-evidence` 每个轮次最多增加一个模型步骤。

#### KV Cache effect

观测与 shadow receipt 不改变生成请求前缀。监督建议追加在最新工具结果之后，缓存前缀不变。采纳生成模型切换可能失去 provider 缓存复用；工具 schema 不变。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 入口路由只覆盖 Session API 符合条件的空闲文本输入，不覆盖 headless、SDK、ACP、附件、排队批次或活跃 steering；不调度专家或控制任务完成。
- 服务不执行操作系统级隐私隔离。workspace、环境变量、子进程出网和导出授权仍 由 Host 负责。
- 入口决策不含会话历史；新文本依赖历史时应弃权。数据类别与候选描述由部署声明；本包无法验证其准确性，也不证明路由质量或成本收益。

<a id="dev-note"></a>
### 开发备注

服务测试会挂载 Cordis，验证本地优先回退、证据与监督组合、隐私拒绝、计数，并通过 MockAdapter 驱动一轮真实 AgentLoop。运行 `vitest run packages/experimental/system3/tests/service.spec.ts`。

**Runtime invariant:** 不发布 runtime invariant companion。纯策略包校验自身输入；Session projection registry 负责 receipt fold 一致性，本服务不维护独立决策权威。
