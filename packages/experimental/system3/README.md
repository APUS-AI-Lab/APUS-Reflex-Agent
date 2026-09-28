---
description: "Cordis service composing the experimental System3 policy, evidence, and supervision seams."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-system3

English | [中文](README.zh.md)

## Summary

Mount this opt-in service to expose one `ctx.system3` seam for local-first route admission, recoverable evidence selection, completion supervision, shadow comparison, usage accounting, and an opt-in AgentLoop observation seam. It composes pure libraries; observation records boundaries but does not mutate prompts, routes, or model results.

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
import System3 from '@deepseek-ai/dsh-experimental-system3'

await ctx.plugin(System3, { privacyMode: 'local-only', observeAgentLoop: true })
const decision = ctx.system3.route(candidates, 'local-9b')
```

`ctx.system3.snapshot()` exposes only operation counters, never user text or tool output. Callers persist the returned spans, supervision reasons, shadow comparisons, and cost records in their own durable Session/audit layer.


### Explicit Jev shadow decisions

Mount the Jev plugin beside System3, then call `shadowDecision(session, request, signal)` with classified decision facts and independent supervisor checks. System3 constructs the Jev state from those checks and goal metadata; it accepts no raw task or tool text. System3 generates the closed action candidates. The returned receipt retains the deterministic baseline even when Jev suggests completion. Timeout, invalid response, a missing provider, or denied privacy admission yields `unknown`. Caller cancellation records a cancelled receipt and rejects.

`jevExecutionDomain` defaults to `network`; set it to `local` only when Jev actually executes on the same host. A loopback SSH tunnel to RunPod is still `network`. Controlled remote execution requires the configured `jevRouteId` (default `jev`) and every input data class in the privacy allowlists. `jevEffort` selects `low` or `high` (default `low`).

Each explicit call appends `system3/decision` with a state digest, evidence references, model identity, full answer probabilities, usage when reported, and the unchanged baseline. The complete structured Jev payload is recorded for reconstruction; raw task text, tool output, and provider error text are omitted. `lastDecision(session)` reads the latest projected receipt from a live or restored Session without invoking Jev. Evidence references identify external checks; evidence storage remains the host's responsibility.

<a id="understand-the-implementation"></a>
## Understand the implementation

The service owns no second agent loop. Its explicit `shadowDecision(session, request, signal)` consumer calls the optional `ctx.jev` provider only after admission by the captured privacy policy. Each policy method increments a non-sensitive counter and delegates to one pure package. When `observeAgentLoop` is enabled, it adds non-mutating listeners for `agent/pre-step`, `agent/request`, `agent/request-error`, and `agent/turn-stopping`; the resulting boundary counters are included in `snapshot()`. The privacy policy is captured at activation; a Jev preference remains advice and cannot override it.

<a id="model-experience"></a>
## Model Experience

### Unified System3 seam

#### What the model sees

Nothing is added automatically. A host decides which `ctx.system3` result enters its existing AgentLoop request or Session projection.

#### Token effect

None by itself. The evidence method can bound a caller's projection, while the usage ledger records whether the resulting token count came from a provider or an estimate.

#### KV Cache effect

None by itself; mounting the service does not rewrite prompts or change tool schemas.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Observation does not edit messages, select a generation provider, or dispatch a subagent. Jev runs only through an explicit `shadowDecision` call; its receipt is not added to the main model history.
- The service does not enforce OS privacy isolation. Workspaces, environment variables, subprocess egress, and export consent remain host responsibilities.
- A follow-up integration must pin event schemas, replay behavior, cancellation, and built-profile smoke tests before claiming end-to-end System3 behavior.

<a id="dev-note"></a>
### Dev Note

The service test mounts Cordis, verifies local-first fallback, composes evidence and supervision, checks privacy rejection plus counters, and drives one real AgentLoop turn through a mock adapter. Run `vitest run packages/experimental/system3/tests/service.spec.ts`.

**Runtime invariant:** No runtime invariant companion is published. The pure policy packages validate their own inputs; the Session projection registry owns receipt fold consistency, and this service keeps no independent decision authority.
