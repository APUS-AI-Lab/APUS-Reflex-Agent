---
description: "Cordis service composing the experimental System3 policy, evidence, and supervision seams."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-system3

English | [中文](README.zh.md)

## Summary

Mount this opt-in service to expose one `ctx.system3` seam for local-first
route admission, recoverable evidence selection, completion supervision, shadow
comparison, and usage accounting. It composes pure libraries and deliberately
does not intercept AgentLoop traffic until a caller wires those events.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it in an experimental profile. The default policy is `local-only`; remote
routes require explicit configuration and remain subject to the per-call
candidate metadata.

```ts
import System3 from '@deepseek-ai/dsh-experimental-system3'

await ctx.plugin(System3, { privacyMode: 'local-only' })
const decision = ctx.system3.route(candidates, 'local-9b')
```

`ctx.system3.snapshot()` exposes only operation counters, never user text or
tool output. Callers persist the returned spans, supervision reasons, shadow
comparisons, and cost records in their own durable Session/audit layer.

<a id="understand-the-implementation"></a>
## Understand the implementation

The service owns no second agent loop and no network client. Each method
increments a non-sensitive counter and delegates to one pure package. The
privacy policy is captured at activation; a Jev preference remains a candidate
ordering hint and cannot override it.

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

- No AgentLoop, `session/event`, provider, or subagent hook is installed yet;
  this prevents an opt-in service from silently changing existing profiles.
- The service does not enforce OS privacy isolation. Workspaces, environment
  variables, subprocess egress, and export consent remain host responsibilities.
- A follow-up integration must pin event schemas, replay behavior, cancellation,
  and built-profile smoke tests before claiming end-to-end System3 behavior.

<a id="dev-note"></a>
### Dev Note

The service test mounts Cordis, verifies local-first fallback, composes evidence
and supervision, and checks privacy rejection plus counters. Run
`vitest run packages/experimental/system3/tests/service.spec.ts`.
