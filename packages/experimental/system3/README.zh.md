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

`processSupervision: { mode, repeatedError, failedAttempts, stalledSteps, delegateFailures, editTools, delegationTools, shellTools, progressTools, verifyPattern, failurePattern }` 对每个顶层 Agent 轮次应用确定性规则，规则触发时写入 `system3/process-notice`：同一工具失败达到 `repeatedError` 次（失败键由工具名、错误码或退出码，以及数字归一后的结果首行组成）；失败调用达到 `failedAttempts` 次；连续 `stalledSteps` 次调用没有成功的修改、委派、通过的验证，或 `progressTools`（例如联网搜索）中工具的成功调用；轮次在修改或委派之后、没有通过的验证就要结束（`missing-evidence`）；单次委派运行中失败命令达到 `delegateFailures` 条。结果为错误或报告非零 `exitCode` 的 shell 调用算失败；命令列表或管道（`;`、`&&`、`||`、`|`）只报告最后一条命令的退出码，因此退出码为 0 但输出匹配 `failurePattern` 时也算失败。`command` 匹配不区分大小写的 `verifyPattern` 且成功的 shell 调用算验证。每条规则在每个轮次、每个对象上最多触发一次，用户的新消息会重新计数。`observe` 只记录；`advise` 还会给主模型建议：工具结果类规则把建议作为附加上下文挂在触发它的结果上，`missing-evidence` 对该轮次 steer 一次，让模型再运行一步。委派运行中的失败只记录、不建议。监督从不阻止、改写或重试工具调用。运行时投影以 `notices` 暴露当前轮次最近五条发现，客户端在 dock 中列出。

`outputFolding: { mode, shellTools, commandPattern, minLines, minChars, minNetChars, minNetShare }` 对顶层 `shellTools` 调用中 `command` 匹配不区分大小写的 `commandPattern` 的单段文本结果折叠重复行，例如测试运行为每个失败都打印同一段 diff 或堆栈。连续至少 `minLines` 行、`minChars` 个字符、与前面保留下来的行逐字节相同的一段，换成一行标记，标记按顺序并带次数写明它重复的是折叠后文本的哪几行，因此展开所有标记即可逐字节还原输出；标记还引用被重复那段的第一行（最多 60 个字符），方便阅读终端卡片的人在没有行号时找到它。比标记还短的一段保持原样。只有节省至少 `minNetChars` 个字符且至少 `minNetShare` 比例时才折叠。每次折叠写入 `system3/output-fold`，包含工具、折叠行数、节省字符数和是否已应用；`shadow` 只记录、不改变结果，`active` 替换模型可见文本。错误结果、委派中的子调用，以及 `value` 已被后续监听器替换的结果不折叠；工具的结构化 `value` 保留完整输出。该规则沿用 mu 的测试日志准入（MIT）。

`taskFrame: { mode, yes, no, deadlineMs, sessionDataClasses, maxItems, maxMessageChars, interjection? }` 为每个顶层 Agent 记住用户的目标和之后提出的要求。创建 DSH 目标时以目标的 objective 建立任务卡，修改 objective 时更新任务并保留已记的要求；目标未完成也未清除期间，任何消息都不会替换它。没有进行中的目标时，Session 的第一条纯文本消息建立任务卡。之后每条不超过 `maxMessageChars` 的消息在所在步骤取走后再判断，步骤不必等待：一次 Jev 请求引用当前任务和这条消息，问一道选择题（`continue`、`side`、`switch`、`unclear`），以及几道是非题：是否要求做具体工作，是否提出要求或完成标准，是否让 AI 停下或改做正在进行的操作，是否纠正之前的做法。要求、完成标准、纠正任一回答为是（概率不低于 `yes`），或在选择为 `continue` 时“停下或改做”回答为是，消息原文追加进任务卡，只保留最近 `maxItems` 条；选 `switch`、要求做具体工作且不是纠正时，以这条消息开始新的任务卡；其他情况不变。每次判断写入 `system3/judgement`，包含完整请求和响应；失败、超过 `deadlineMs` 和隐私拒绝都不改变任务卡。`active` 模式下每次变化写入 `system3/task-frame`，任务卡里有要求后通过 `system3:task-frame` 运行时上下文进入模型；`shadow` 模式下任务卡只在内存中，只记录判断；`off` 不发请求。配置 `interjection` 时，用户在运行中的轮次之后排队的纯文本消息在到达时就判断，之后该消息被取走时复用这次判断：`active` 模式下，属于当前任务的要求、完成标准或纠正，会通过会话控制器的队列 `steer` 操作移入正在运行的轮次，这与用户自己点击插入按钮是同一操作；如果该 Agent 有正在运行且接受输入的委派，还会通过 `subagents.steerByParent`（dock 补充说明表单走的同一通道）把文本发给它；旁支问题、新任务和闲聊保持排队；`shadow` 只记录判断。每条这样的消息写入 `system3/interjection`，包含判断、是否已移入，以及也接收了它的委派 provider（`forwardedTo`）；轮次已结束，或用户已编辑、删除该条目时，消息留在原处。移入需要 `active` 的任务卡。委派出的子 Agent、带附件的消息和更长的消息都跳过。运行时投影以 `taskFrame` 暴露任务卡，客户端在 dock 中显示为一行计数，点开可见任务和每条要求；以 `interjection` 暴露正在运行的轮次最近一条已移入的消息，dock 用一行提示，直到该轮结束。问法依据在已部署 Jev 上运行的标注集确定（[报告](../../../docs/feat-jev-decision-kernel/task-frame-report.json)）。

`skillSelection` 在原生 `agent/pre-step` 扩展点为下游保留的用户输入选择至多一个当前作用域允许模型调用的 Skill。配置包含 `sessionDataClasses`、`minConfidence`、`maxInputBytes`、`maxContentBytes`、`maxCandidates`（1–254）和 `deadlineMs`。Jev 读取当前文本及完整且有界的目录描述，不读取 Skill 正文或会话历史。稳定候选 id 为独立弃权选项保留位置。隐私拒绝、发现不完整、目录超限、低置信度、超时、元数据过期或正文超限时，保留原生模型与工具流程。目录超过 `maxCandidates` 时不声称自动搜索过全部 Skill；显式 `/name` 调用继续使用自身调用策略。

`system3/skill-decision` 记录准确请求、验证后的响应与提供方报告的用量、选择结果，以及拟注入的原生 `injectionMessageId`。加载的正文采用 `skill-invocation` 指令，只有 loop 提交准确的 `user/message` 后才成为模型可见内容，不授予工具权限。`system3Runtime` wire 投影分别呈现 `entry.suggested`、`entry.adopted` 和 `entry.used`，在 `history` 中保留最多 100 条输入已进入轮次的更早决策，并区分 `skill.selected` 与 `skill.injected`。实际使用须由准确输入所属 turn 的模型输出，或含内容增量、完整内容块的流式 attempt 确认。用量、块占位及仅含结束错误或取消的记录不证明已收到响应；真实内容之后发生错误仍保留响应事实。仅准入不代表已发送模型请求。回放会重建这些事实而不调用 Jev，客户端无法从投影取得提供方原始输入或完整概率。

### 记忆评分

`memoryScoring: { mode, yes, no, deadlineMs, sessionDataClasses, maxCandidates, maxMessageChars, maxItems }` 默认为 `false`；所有字段必填，`maxCandidates` 最大为 16，即 Jev 问题上限。System3 在顶层 Agent 的用户纯文本消息（不超过 `maxMessageChars`）提交时记住它们。当 `compaction/summary` 替换了其中一部分时，下一步会发起一次 Jev 请求（决策 `memory.score`），且不等待其结果：区间内最近的至多 `maxCandidates` 条消息各对应一个是非问题，逐条引用原话，询问之后的工作是否仍须逐字遵守或引用它。概率不低于 `yes` 的消息被保留。`active` 模式下，至少保留一条消息的区间写入 `system3/memory-score`，包含检查点 id（`compaction/summary` 的序号）、扫描条数，以及每条保留消息的序号、id、原文与概率；最近的 `maxItems` 条保留消息通过 `system3:memory` 运行时上下文交给模型，内容读取自 `system3Runtime` 投影，因此恢复会话后仍然存在。`shadow` 只记录 `system3/judgement`，`off` 不发起询问。隐私拒绝、Jev 失败与 `deadlineMs` 超时都不保留任何消息。插件启动前提交的消息、委派的子 Agent、附件与超长消息不参与评分。投影以 `memory` 暴露保留的消息，客户端在 dock 中显示为记忆卡。检查点 id 即 `dsh-tool-history-recall` 接受的 id。

### 记忆召回

`memoryRecall: { mode, yes, no, deadlineMs, sessionDataClasses, maxCandidates, maxInputChars, maxMessageChars }` 默认为 `false`，可以单独启用，也可以与 `memoryScoring` 同时启用。所有字段必填，`maxCandidates` 最大为 16，即 Jev 问题上限。`system3Runtime` 投影逐字、完整地记录会话里用户的每条纯文本输入；某条输入被 `compaction/summary` 遮蔽后，连同该检查点移入归档（L2）。在此之前没有可召回的内容，也不发起 Jev 请求。当循环领取顶层 Agent 的用户纯文本输入时，下一次请求组装会在请求发出前等待一次 Jev 请求（决策 `memory.recall`）：每条归档输入对应一个是非问题，引用当前输入的前 `maxInputChars` 个字符与归档输入的前 `maxMessageChars` 个字符，询问主模型处理当前输入时是否需要看到它。归档输入多于 `maxCandidates` 条时，先取与输入共享字符对最多的，其次取记忆评分保留的（L1），再取较新的。概率不低于 `yes` 的输入被召回。`active` 模式下，召回的原文成为该次请求的 `system3:memory` 运行时上下文，超过 `maxMessageChars` 的输入显示开头部分，并注明原文长度和供 `history_read` 读取的检查点；同时写入 `system3/memory-recall`，包含输入的消息 id、判断条数，以及每条召回输入的检查点、序号、id、完整原文与概率；某条输入什么都没有召回而之前显示过召回时，写入一次空召回，使后续步骤不再显示旧内容。`active` 召回独占 `system3:memory` 上下文，因此 `memoryScoring` 保留的消息只通过召回交给模型。`shadow` 只记录 `system3/judgement`，`off` 不发起询问。隐私拒绝、Jev 失败与 `deadlineMs` 超时时，该输入不召回任何内容。Jev 只挑选原文，从不改写、提炼或删减。投影以 `recall` 暴露最近一次召回。

### 完成核验

`completionReview: { mode, yes, no, deadlineMs, sessionDataClasses, maxRefusals, evidenceCalls, resultChars }` 默认为 `false`，且依赖 `taskFrame`；没有任务卡时启用会在加载时失败。`active` 或 `shadow` 核验要求 `taskFrame.mode` 为 `active` 或 `shadow`；`off` 核验可以搭配 `off` 任务卡。所有字段都必填。顶层 Agent 对任务卡所跟随的 DSH 目标调用 `update_goal` 且 action 为 `complete` 时，工具运行前发一次 Jev 请求（决策 `completion.review`），为目标和任务卡中的每条要求各问一道是非题（`goal`、`r1`…`rN`）。Jev 只读取最近 `evidenceCalls` 次工具调用的摘要：每次调用的主要参数（命令、路径、action、查询或 URL），以及结果开头和结尾各 `resultChars` 个字符；模型自己的文字和它的 `update_goal` 调用不进入摘要。概率不高于 `no` 是有把握的“未满足”，不低于 `yes` 是“已满足”。`active` 模式下，目标或任一要求被有把握地判为未满足时拒绝这次调用，模型收到的工具结果就是拒绝说明；同一目标被拒绝 `maxRefusals` 次后，该目标之后的完成不再被拒绝。`shadow` 只记录核验、不拒绝，`off` 不发请求。插件卸载会取消在途核验，将调用交给其余工具策略，不拒绝，也不新增核验记录。用户取消仍阻止执行。决策调用在进入时已被取消则不发请求；取消后收到的提供方答复不写判断记录。每次核验先写入 `system3/judgement`，包含完整请求和响应，再写入 `system3/completion-review`，包含 `goalId`、`decision`（`complete`、`incomplete` 或 `unsure`）、未满足要求的消息 id（`unmet`）、`goalUnmet` 和 `refused`。隐私拒绝、Jev 失败和超过 `deadlineMs` 时按 `unsure` 放行。委派出的子 Agent、嵌套调用、其他目标操作，以及任务卡未跟随的目标都不核验。问法和阈值依据在已部署 Jev 上运行的标注集确定（[测试](tests/completion-review.e2e.ts)）。 拒绝额度按 Session 和目标隔离，独立 root fork 不共享。等待成功 Jev 答复期间任务卡改变时，旧答案记录为 `unsure`；active 使用同一额度拒绝过期申请，并引用当前任务卡原话要求重新核验。

<a id="understand-the-implementation"></a>
## 实现说明

服务不拥有第二套 agent loop。显式 `shadowDecision(session, request, signal)` consumer 只在捕获的隐私策略准入后调用可选 `ctx.jev` provider。每个策略方法只增加无敏感数据的 计数，然后委派给一个纯策略包。启用 `observeAgentLoop` 后，会为 `agent/pre-step`、`agent/request`、`agent/request-error` 和 `agent/turn-stopping` 安装不修改行为的监听器，边界计数会进入 `snapshot()`。隐私策略在挂载时捕获；Jev 偏好只是 advice，不能覆盖策略。

<a id="model-experience"></a>
## 模型体验

### 统一 System3 seam

#### What the model sees

未启用入口路由时，由宿主决定哪些服务结果进入模型历史。入口路由通过 `state.input` 向 Jev 提供当前文本，通过 `state.baseline` 提供当前模型选择，通过 `questions.route.criteria` 提供有界候选描述。Receipt 不进入生成模型历史。采纳后的模型变化遵循原生 Session API 的模型选择行为。配置 `handoffPack` 时，委派指令末尾可能附上用户更早提出的要求；`advise` 模式下，过程监督每触发一条规则就加入一条来源为 `system3-supervision` 的用户消息；`active` 模式下，输出折叠把 shell 结果中的重复行换成标记，任务卡加入运行时上下文快照；`active` 模式下，被拒绝的目标完成以拒绝说明作为 `update_goal` 的结果，例如：

##### 缺少验证的建议

```markdown
[System3 过程监督] 本轮修改了文件或完成了委派，但还没有运行通过的测试或构建来验证。请先运行项目的验证命令，再向用户报告结果；如果无法验证，请明确说明原因。
```

##### 交接包中的要求

```markdown
[System3 交接包] 用户在本会话前面提出过以下要求。委派时请把它们原文写进交给 <label> 的任务，并在核对结果时逐条检查：
- <earlier message, verbatim>
```

##### 折叠后的 shell 输出

```markdown
[System3 已折叠 12 行：与上文第 6-17 行逐字相同，开头是 "- Expected"]
```

##### 任务卡

```markdown
[System3 任务卡] 用户在当前任务中提出了以下要求（均为原话）。在整个任务中遵守它们，宣布完成前逐条核对：
任务：<the message that started the task, verbatim>
- <later requirement, verbatim>
```

##### 记忆

```markdown
[System3 记忆] 以下用户原话所在的对话已被压缩，经评分判断之后仍须遵守或引用（均为原话）。需要上下文时，用 history_read 读取对应检查点的原文：
- 检查点 <checkpoint id>，#<seq>：<kept message, verbatim>
```

##### 记忆召回

```markdown
[System3 记忆召回] 以下用户原话所在的对话已被压缩，经评分判断与当前输入相关（均为原话）。需要上下文时，用 history_read 读取对应检查点的原文：
- 检查点 <checkpoint id>，#<seq>：<recalled message, verbatim>
```

##### 完成核验的拒绝说明

```markdown
[System3 完成核验] 执行记录里还看不到以下内容已经完成的证据：
- 目标：<the goal, verbatim, when judged not met>
- 用户要求：<each unmet requirement, verbatim>
请先完成并验证；如果做不到或要求之间有冲突，请向用户说明并请用户决定，不要标记完成。
```

##### 过期完成核验

```markdown
[System3 完成核验] 任务卡在核验期间更新，请按当前目标和要求重新核验后再标记完成。
- 当前目标：<当前目标原话>
- 当前用户要求：<当前要求原话>
```

#### Token effect

在隐私和大小检查允许时，入口路由为每个符合条件的准入输入增加一次 Jev 调用；保留 provider 实际报告的 usage。evidence 方法限制调用方投影，usage 记录区分 provider 计数与估算。每条监督建议增加 50 到 100 个输入 token，交接包增加被转交消息本身、约 60 个 token 和一次 Jev 请求；`advise` 模式下 `missing-evidence` 每个轮次最多增加一个模型步骤。输出折叠不调用模型，并从工具结果中去掉被折叠的字符。任务卡为之后的每条消息增加一次 Jev 请求，与步骤并行；每次变化追加一条包含目标和已记要求的运行时上下文快照。完成核验为每次被核验的完成增加一次 Jev 请求，`update_goal` 调用最多等待 `deadlineMs`；一次拒绝增加约 80 个 token，外加引用的目标和要求。 任务卡忽略基于已替换卡的判断；仍排队的消息保留到下一轮，已送入步骤的消息最多补判一次。保留了记忆时，记忆召回会在每条符合条件的输入的首次请求前增加一次 Jev 请求，并把记忆上下文换成只包含被召回的消息。

#### KV Cache effect

观测与 shadow receipt 不改变生成请求前缀。监督建议追加在最新工具结果之后，缓存前缀不变。工具结果在进入历史前就已折叠，之后的请求原样复用。任务卡变化时在最新消息之后追加新的运行时上下文快照，缓存前缀不变。完成核验的拒绝说明是追加在最新消息之后的工具结果，缓存前缀不变。采纳生成模型切换可能失去 provider 缓存复用；工具 schema 不变。一次召回只改变追加在最新消息之后的运行时上下文快照，缓存前缀不变。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 入口路由只覆盖 Session API 符合条件的空闲文本输入，不覆盖 headless、SDK、ACP、附件、排队批次或活跃 steering；不调度专家或控制任务完成。
- 服务不执行操作系统级隐私隔离。workspace、环境变量、子进程出网和导出授权仍 由 Host 负责。
- 入口决策不含会话历史；新文本依赖历史时应弃权。数据类别与候选描述由部署声明；本包无法验证其准确性，也不证明路由质量或成本收益。
- 完成核验依赖 9B 的 Jev 模型阅读有界摘要：它可能拒绝已完成的工作，也可能放过未完成的工作；它只看到摘要保留的内容，并在失败时放行。同一目标的 `maxRefusals` 次拒绝用完后，该目标之后的完成即使被判为未满足也会执行。
- 记忆召回每条输入最多用 9B Jev 模型判断 16 条保留的记忆；保留的记忆更多时，字符对预筛可能漏掉相关记忆，且这次判断的耗时会加在该输入的首次请求上。

<a id="dev-note"></a>
### 开发备注

服务测试会挂载 Cordis，验证本地优先回退、证据与监督组合、隐私拒绝、计数，并通过 MockAdapter 驱动一轮真实 AgentLoop。运行 `vitest run packages/experimental/system3/tests/service.spec.ts`。

**Runtime invariant:** 不发布 runtime invariant companion。纯策略包校验自身输入；Session projection registry 负责 receipt fold 一致性，本服务不维护独立决策权威。
