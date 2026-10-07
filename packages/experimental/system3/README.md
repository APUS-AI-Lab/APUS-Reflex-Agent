---
description: "Cordis service composing the experimental System3 policy, evidence, and supervision seams."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-system3

English | [中文](README.zh.md)

## Summary

Mount this service for local-first route admission, evidence selection, completion supervision, shadow comparison, and usage accounting. Optional observation leaves AgentLoop behavior unchanged. Separately, `entryRouting` enables Jev model recommendations for idle text prompts admitted through the Session API; the API owns adoption and cancellation.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it in an experimental profile. The default policy is `local-only`; remote routes require explicit configuration and remain subject to the per-call candidate metadata.

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

`ctx.system3.snapshot()` exposes only operation counters, never user text or tool output. Callers persist the returned spans, supervision reasons, shadow comparisons, and cost records in their own durable Session/audit layer.


### Explicit Jev shadow decisions

Mount the Jev plugin beside System3, then call `shadowDecision(session, request, signal)` with classified decision facts and independent supervisor checks. System3 constructs the Jev state from those checks and goal metadata; it accepts no raw task or tool text. System3 generates the closed action candidates. The returned receipt retains the deterministic baseline even when Jev suggests completion. Timeout, invalid response, a missing provider, or denied privacy admission yields `unknown`. Caller cancellation records a cancelled receipt and rejects.

`jevExecutionDomain` defaults to `network`; set it to `local` only when Jev actually executes on the same host. A loopback SSH tunnel to RunPod is still `network`. Controlled remote execution requires the configured `jevRouteId` (default `jev`) and every input data class in the privacy allowlists. `jevEffort` selects `low` or `high` (default `low`).

Each explicit call appends `system3/decision` with a state digest, evidence references, model identity, full answer probabilities, usage when reported, and the unchanged baseline. The complete structured Jev payload is recorded for reconstruction; raw task text, tool output, and provider error text are omitted. `lastDecision(session)` reads the latest projected receipt from a live or restored Session without invoking Jev. Evidence references identify external checks; evidence storage remains the host's responsibility.

### Session API entry routing

`entryRouting` defaults to `false`. Enabling it requires `candidates`, `sessionDataClasses`, `minConfidence`, and `maxInputBytes`. Each candidate declares a unique `id`, task `description`, generation `provider` and `model`, optional `reasoningEffort`, actual `executionDomain`, and allowed `dataClasses`. Candidate ids use lower-kebab-case; `abstain` and `unknown` are reserved. Duplicate model/effort selections are rejected. `sessionDataClasses` conservatively classifies the whole session that generation may read, not just the new text; the host owns this classification.

Candidate and Jev network admission both use the privacy policy before sending task text. Candidate metadata must expose context capacity at least as large as the baseline and support every baseline input modality; unknown metadata excludes that candidate. Unsupported reasoning efforts reject configuration at the first model resolution. Jev receives only the current text, baseline model identity, and admitted choice descriptions, with an explicit abstain choice for missing context or uncertain selection. `maxInputBytes` bounds the complete resolved Jev request in UTF-8, including criteria and metadata. Oversized inputs are not truncated and retain the baseline.

`minConfidence` is an acceptance threshold, not a calibrated success probability. Abstention, low confidence, denied privacy, no compatible candidates, unavailable Jev, and provider failures return no override. With `retainOnAbstain: true`, abstention and low confidence instead continue the route chosen or retained by the Session's previous entry decision when that route is still an admitted, compatible candidate; the receipt records it as `retained` with the originating request id and carries no `selected`. Provider failures still keep the baseline. This option requires `sessionProjections`. A delegation candidate replaces `provider`/`model` with `delegate: { provider, tool }`, naming a registered subagent provider and its model-facing tool; it is offered to Jev only while that provider is registered and the tool is visible to the requesting Agent. Choosing it keeps the baseline model, records the target in the receipt's `candidate.delegate`, and injects one user message attributed to `system3-delegation` in the pre-step that first carries the input, asking the model to call the tool; the model may decline. The projection reports the injected instruction and the later tool call separately, and retention never continues a delegation. A delegation candidate's optional `explicitPatterns` lists case-insensitive regular expressions for the person's explicit request, such as `交给\s*codex`; once the admission and availability checks pass, a matching input selects that candidate without a Jev request, and the receipt records `explicit: true` with `request` null. Invalid or blank patterns fail at load. A candidate's optional `label` is recorded with the decision so the Client can name the route as soon as the decision arrives. `keepWarm: { windowMs, intervalMs }` sends Jev warm-up requests at that interval for `windowMs` after plugin start and after each turn ends, so the next entry decision reuses an open connection; set `intervalMs` below the gateway's idle connection timeout. Candidates must accept every input modality present in the Session: image input is required once a user message or tool result carries an image. Without the System3 runtime projection, candidates must accept every modality the baseline accepts. Cancellation rejects without authorizing prompt admission. A `system3/entry-decision` event preserves the exact Jev request (including text), validated response, and recommendation; `request` is null when no decision was dispatched. The host-only `providerId` in that request is omitted by the Jev HTTP serializer. The Session API's separate `model/automatic-selection` event identifies actual adoption with the same request id. Replaying either event performs no model call. Router registration is disposed with the plugin.

`entryRouting.handoffPack: { recentMessages, maxMessageChars, minProbability, deadlineMs }` reviews the person's earlier messages before the delegation instruction is injected. It takes the latest `recentMessages` (at most 16) committed text-only user messages of at most `maxMessageChars` characters, excluding the delegated input, and sends Jev one request with the delegated text in `state.task` and one yes/no question per message that quotes it and asks whether it is a working requirement still in force for the task, such as a naming rule, a file that must not change, or a check that must pass. Messages whose probability is at least `minProbability` are appended verbatim to the instruction, oldest first, with a request to write them into the delegated task and check the result against them. A `system3/handoff-pack` event records the exact request, the response, the outcome, and the ids of the forwarded messages before the instruction. Privacy denial, an absent or failing Jev, and a review exceeding `deadlineMs` send the instruction alone; cancelling the turn rejects the pre-step.

`entryRouting.deadlineMs` bounds baseline preparation, Jev advice, and selected-route preparation together (default 30000 ms; maximum `MAX_TIMER_DELAY_MS`). A timeout can admit only an already prepared legal baseline; incomplete baseline preparation rejects without inbox insertion. The baseline must match an admitted configured candidate or declare `baseline.executionDomain` and `baseline.dataClasses`; an independent remote baseline uses privacy route id `baseline`. Cancel and provider removal abort pending admission, and late advice never authorizes another admission. Native `resetModelSelection` restores automatic routing for later eligible inputs; a manual selection remains fixed until reset.

`entryRouting.routeHealth: { window, sampleTtlMs, minSamples, maxFirstTokenMs, minTokensPerSecond, minOutputTokens, maxErrorRate, probe }` measures every model stream that passes `llm/stream` in this context. Each completed stream records its first-token latency from the start of the stream, its output tokens per second after the first token when it produced at least `minOutputTokens`, and whether it ended with an error; cancelled streams record nothing. A route keeps its latest `window` samples younger than `sampleTtlMs`. With at least `minSamples` samples for a metric, a route is degraded when its error share exceeds `maxErrorRate`, its median first-token latency exceeds `maxFirstTokenMs`, or its median output rate falls below `minTokensPerSecond`, checked in that order. Entry routing leaves degraded model candidates out of the Jev request while another compatible candidate remains, records them with their reasons in the decision's `avoided`, and never avoids a delegation candidate. With `probe: { idleMs, maxTokens }`, each model candidate without a sample for `idleMs` receives a fixed request of at most `maxTokens` output tokens that contains no Session data, so an avoided route is measured again. Samples are process-local and start empty after a restart. The runtime projection exposes the avoided labels as `entry.avoided`, and the Client appends them to the route notice.

`delegationProgress: { intervalMs, monitor? }` writes `system3/delegation-progress` snapshots of every subagent run an Agent delegates to that Agent's Session: once at start, at most once per `intervalMs` while steps arrive, and once at the end with the stop reason. A snapshot carries the provider, start time, elapsed time, completed step counts per category, the step in progress, the time of the latest step, and the child's latest short progress note; it never carries commands, paths, tool input, or results and is not model-visible. With `monitor: { overtimeMs, stallMs, startupMs }`, System3 also writes `system3/delegation-alert` when a run has no first step within `startupMs`, once per stall after `stallMs` without a new step, and at every `overtimeMs` multiple. Snapshots also record whether the run accepts mid-run input (`steerable`). The runtime projection exposes the latest run as `subagentRun` with its note, unresolved alert, `steerable` while it runs, and the latest three `subagent/steer` texts it accepted; the Client shows the note, an alert with keep-waiting, steer, and stop actions, and a steer form that sends text through `subagents.steerByParent`. Only providers that report activity (Codex and Claude Code) produce running snapshots.

`processSupervision: { mode, repeatedError, failedAttempts, stalledSteps, delegateFailures, editTools, delegationTools, shellTools, verifyPattern }` applies deterministic rules to each top-level Agent turn and writes `system3/process-notice` when one fires: the same tool failure `repeatedError` times (a failure key combines tool name, error code or exit code, and the first line of the result with digits folded), `failedAttempts` failed calls, `stalledSteps` consecutive calls without a successful edit, delegation, or passing verification, a turn about to end after edits or delegation without a passing verification (`missing-evidence`), and `delegateFailures` failed commands inside one delegated run. A shell call fails when its result is an error or reports a nonzero `exitCode`; a verification is a successful shell call whose `command` matches the case-insensitive `verifyPattern` and contains no pipe, because a pipeline reports the exit code of its last stage. Each rule fires at most once per turn and subject, and a person's new message starts fresh counts. `observe` only records; `advise` also gives the main model advice: tool-result rules attach it as additional context on the triggering result, and `missing-evidence` steers the turn once so the model runs another step. Delegated-run failures are recorded but never advised. Supervision never blocks, rewrites, or retries a tool call. The runtime projection exposes the current turn's latest five findings as `notices`, which the Client lists in the dock.

`skillSelection` enables one scoped, model-invocable Skill selection for surviving user input at the native `agent/pre-step` seam. Configure `sessionDataClasses`, `minConfidence`, `maxInputBytes`, `maxContentBytes`, `maxCandidates` (1–254), and `deadlineMs`. Jev receives current text and complete bounded catalog descriptions; it receives no Skill bodies or conversation history. Stable candidate ids reserve an independent abstention choice. Privacy refusal, incomplete discovery, catalog overflow, low confidence, timeout, stale metadata, or an oversized body leaves the original native model/tool path intact. A catalog exceeding `maxCandidates` is never claimed to have been automatically searched, and explicit `/name` invocations retain their own invocation policy.

A `system3/skill-decision` records the exact request, validated response and reported usage, selection, and proposed native `injectionMessageId`. The loaded body uses `skill-invocation` instructions and becomes model-visible only when the loop commits that exact `user/message`; it grants no tool permission. The `system3Runtime` wire projection exposes `entry.suggested`, `entry.adopted`, and `entry.used` independently, keeps up to 100 earlier decisions whose input reached a turn in `history`, and `skill.selected` separately from `skill.injected`. Actual use requires model output or a streamed attempt carrying content deltas or completed content blocks in the exact input's turn. Usage, block placeholders, and finish-only errors or aborts do not confirm a response; content received before a later error still does. Admission alone never claims dispatch. Replay rebuilds these facts without Jev calls and exposes neither provider inputs nor complete probabilities to clients.

<a id="understand-the-implementation"></a>
## Understand the implementation

The service owns no second agent loop. Its explicit `shadowDecision(session, request, signal)` consumer calls the optional `ctx.jev` provider only after admission by the captured privacy policy. Each policy method increments a non-sensitive counter and delegates to one pure package. When `observeAgentLoop` is enabled, it adds non-mutating listeners for `agent/pre-step`, `agent/request`, `agent/request-error`, and `agent/turn-stopping`; the resulting boundary counters are included in `snapshot()`. The privacy policy is captured at activation; a Jev preference remains advice and cannot override it.

<a id="model-experience"></a>
## Model Experience

### Unified System3 seam

#### What the model sees

Without entry routing, a host chooses which service results enter model history. Entry routing sends the current text in `state.input`, baseline selection in `state.baseline`, and bounded choice descriptions in `questions.route.criteria` to Jev. Its receipt is not added to generation history. An adopted model change follows the native Session API model-selection behavior. With `handoffPack`, the delegation instruction may end with the person's earlier requirements, and in `advise` mode, process supervision adds one user message with source `system3-supervision` per fired rule, for example:

##### Missing verification advice

```markdown
[System3 过程监督] 本轮修改了文件或完成了委派，但还没有运行通过的测试或构建来验证。请先运行项目的验证命令，再向用户报告结果；如果无法验证，请明确说明原因。
```

##### Hand-off requirements

```markdown
[System3 交接包] 用户在本会话前面提出过以下要求。委派时请把它们原文写进交给 <label> 的任务，并在核对结果时逐条检查：
- <earlier message, verbatim>
```

#### Token effect

Entry routing adds a Jev call for each eligible admitted prompt when privacy and size checks permit it; provider usage is retained when reported. The evidence method bounds caller projections, and usage records distinguish provider counts from estimates. Each supervision advice adds 50 to 100 input tokens, and a hand-off pack adds its forwarded messages plus about 60 tokens and one Jev request; `missing-evidence` in `advise` mode adds at most one model step per turn.

#### KV Cache effect

Observation and shadow receipts do not change the generation prefix. Automatic Skill injection appends bounded native instruction content before generation. Supervision advice is appended after the latest tool result, so the cached prefix is unchanged. An adopted generation-model switch may lose provider cache reuse; tool schemas are unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Entry routing covers the Session API's eligible idle text prompts, not headless, SDK, ACP, attachments, queued batches, or active steering. It does not dispatch experts or control task completion.
- The service does not enforce OS privacy isolation. Workspaces, environment variables, subprocess egress, and export consent remain host responsibilities.
- Entry decisions lack conversation history and must abstain when the new text needs it. Declared data classes and candidate descriptions are deployment facts; this package cannot verify their accuracy or prove routing quality and cost savings.

<a id="dev-note"></a>
### Dev Note

The service test mounts Cordis, verifies local-first fallback, composes evidence and supervision, checks privacy rejection plus counters, and drives one real AgentLoop turn through a mock adapter. Run `vitest run packages/experimental/system3/tests/service.spec.ts`.

**Runtime invariant:** No runtime invariant companion is published. The pure policy packages validate their own inputs; the Session projection registry owns receipt fold consistency, and this service keeps no independent decision authority.
