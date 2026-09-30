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

`minConfidence` is an acceptance threshold, not a calibrated success probability. Abstention, low confidence, denied privacy, no compatible candidates, unavailable Jev, and provider failures return no override. Cancellation rejects without authorizing prompt admission. A `system3/entry-decision` event preserves the exact Jev request (including text), validated response, and recommendation; `request` is null when no decision was dispatched. The host-only `providerId` in that request is omitted by the Jev HTTP serializer. The Session API's separate `model/automatic-selection` event identifies actual adoption with the same request id. Replaying either event performs no model call. Router registration is disposed with the plugin.

`entryRouting.deadlineMs` bounds baseline preparation, Jev advice, and selected-route preparation together (default 30000 ms; maximum `MAX_TIMER_DELAY_MS`). A timeout can admit only an already prepared legal baseline; incomplete baseline preparation rejects without inbox insertion. The baseline must match an admitted configured candidate or declare `baseline.executionDomain` and `baseline.dataClasses`; an independent remote baseline uses privacy route id `baseline`. Cancel and provider removal abort pending admission, and late advice never authorizes another admission. Native `resetModelSelection` restores automatic routing for later eligible inputs; a manual selection remains fixed until reset.

`skillSelection` enables one scoped, model-invocable Skill selection for surviving user input at the native `agent/pre-step` seam. Configure `sessionDataClasses`, `minConfidence`, `maxInputBytes`, `maxContentBytes`, `maxCandidates` (1–254), and `deadlineMs`. Jev receives current text and complete bounded catalog descriptions; it receives no Skill bodies or conversation history. Stable candidate ids reserve an independent abstention choice. Privacy refusal, incomplete discovery, catalog overflow, low confidence, timeout, stale metadata, or an oversized body leaves the original native model/tool path intact. A catalog exceeding `maxCandidates` is never claimed to have been automatically searched, and explicit `/name` invocations retain their own invocation policy.

A `system3/skill-decision` records the exact request, validated response and reported usage, selection, and proposed native `injectionMessageId`. The loaded body uses `skill-invocation` instructions and becomes model-visible only when the loop commits that exact `user/message`; it grants no tool permission. The `system3Runtime` wire projection exposes `entry.suggested`, `entry.adopted`, and `entry.used` independently, and `skill.selected` separately from `skill.injected`. Actual use requires model output or a nonempty streamed attempt in the exact input's turn, so admission alone never claims dispatch. Replay rebuilds these facts without Jev calls and exposes neither provider inputs nor complete probabilities to clients.

<a id="understand-the-implementation"></a>
## Understand the implementation

The service owns no second agent loop. Its explicit `shadowDecision(session, request, signal)` consumer calls the optional `ctx.jev` provider only after admission by the captured privacy policy. Each policy method increments a non-sensitive counter and delegates to one pure package. When `observeAgentLoop` is enabled, it adds non-mutating listeners for `agent/pre-step`, `agent/request`, `agent/request-error`, and `agent/turn-stopping`; the resulting boundary counters are included in `snapshot()`. The privacy policy is captured at activation; a Jev preference remains advice and cannot override it.

<a id="model-experience"></a>
## Model Experience

### Unified System3 seam

#### What the model sees

Without entry routing, a host chooses which service results enter model history. Entry routing sends the current text in `state.input`, baseline selection in `state.baseline`, and bounded choice descriptions in `questions.route.criteria` to Jev. Its receipt is not added to generation history. An adopted model change follows the native Session API model-selection behavior.

#### Token effect

Entry routing adds a Jev call for each eligible admitted prompt when privacy and size checks permit it; provider usage is retained when reported. The evidence method bounds caller projections, and usage records distinguish provider counts from estimates.

#### KV Cache effect

Observation and shadow receipts do not change the generation prefix. Automatic Skill injection appends bounded native instruction content before generation. An adopted generation-model switch may lose provider cache reuse; tool schemas are unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Entry routing covers the Session API's eligible idle text prompts, not headless, SDK, ACP, attachments, queued batches, or active steering. It does not dispatch experts or control task completion.
- The service does not enforce OS privacy isolation. Workspaces, environment variables, subprocess egress, and export consent remain host responsibilities.
- Entry decisions lack conversation history and must abstain when the new text needs it. Declared data classes and candidate descriptions are deployment facts; this package cannot verify their accuracy or prove routing quality and cost savings.

<a id="dev-note"></a>
### Dev Note

The service test mounts Cordis, verifies local-first fallback, composes evidence and supervision, checks privacy rejection plus counters, and drives one real AgentLoop turn through a mock adapter. Run `vitest run packages/experimental/system3/tests/service.spec.ts`.

**Runtime invariant:** No runtime invariant companion is published. The pure policy packages validate their own inputs; the Session projection registry owns receipt fold consistency, and this service keeps no independent decision authority.
