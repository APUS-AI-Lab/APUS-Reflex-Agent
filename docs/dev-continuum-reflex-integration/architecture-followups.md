# Architecture follow-up tasks for a new contributor

English | [中文](architecture-followups.zh.md)

This assignment reference distinguishes existing code and test cases from the remaining acceptance work. A linked test is a starting point, not a claim that it passed on the release revision. Record the tested revision, command, result and evidence location before closing a task. Review risks below remain unconfirmed until reproduced.

## P0 — release and user trust

| Task | Existing evidence or starting point | Remaining increment and acceptance | Newcomer fit |
| --- | --- | --- | --- |
| Restart evidence isolation | [Headless process test](../../apps/cli/tests/profiles/headless/tests/continuum-memory.e2e.ts) now separates process logs and checks durable source references. | Record all five source/built, disabled/no-Jev and new-Session results on the release revision. The resumed query must not repeat the original canary; only the resumed request can satisfy the recall assertion. | Fixture-owner acceptance; extend the existing test. |
| CI and publication | [Release readiness](release-readiness.md) | Check current required workflows in both repositories; resolve any capacity blocker, rerun and record run URLs. Audit tracked data, Markdown, HTML and history for secrets and private operational details. Skipped and unstarted checks remain unverified. | Release owner; newcomer can inventory documents. |
| Supervision and desktop release | [Supervision tests](../../packages/experimental/system3/tests/reflex-supervision.spec.ts), [release notes](../feat-reflex-control/release-notes.md) | Run healthy long tasks and mid-run Goal changes through Web/Electron; reject stale supervision results. Validate startup recovery, Session reopen and signed/notarized packages on supported runners. | Senior engineer and release owner. |
| User-visible latency | [Entry routing tests](../../packages/experimental/system3/tests/entry-routing.spec.ts) | Measure admission, remote first-byte, total latency and visible fallback using a reproducible fixture and a real endpoint. Report workload, p50/p95 and failed requests separately. | Paired work; owner supplies provider access. |

## P1 — architecture hardening

Start with the first two tasks: they have narrow code ownership and keyless acceptance. A maintainer must approve retrieval semantics and budget definitions before runtime changes.

| Task | Existing evidence or starting point | Remaining increment and acceptance | Newcomer fit |
| --- | --- | --- | --- |
| Retrieval consistency | [Index](../../packages/context/continuum/src/memory-index.ts), [retrieval](../../packages/context/continuum/src/retrieval.ts), [index tests](../../packages/context/continuum/tests/memory-index.spec.ts) | Reproduce the possible mismatch between exact-token index lookup and substring scoring. Compare indexed/unindexed candidates for partial English terms, Chinese text, Unicode and retired records. Agree the intended matching semantics, then make the comparison pass. | Recommended first task with review. |
| Recall byte budget | [Retrieval tests](../../packages/context/continuum/tests/retrieval.spec.ts), [context renderer](../../packages/context/continuum/src/context.ts) | Existing accounting bounds excerpt bytes; tags, separators and the heading add bytes. Define whether the limit covers content or the complete injected message. Verify the agreed limit with long IDs, multibyte text, multiple candidates and a too-small budget. | Recommended second task; maintainer owns API meaning. |
| Shipped selector matrix | [Headless process test](../../apps/cli/tests/profiles/headless/tests/continuum-memory.e2e.ts), [selector tests](../../packages/experimental/continuum-jev/tests/index.spec.ts) | Extend existing restart and disabled/no-Jev cases with mounted shadow, active and unavailable selectors. Verify persisted receipts, resumed model requests and fallback in source/artifact modes. Keep deterministic-provider evidence separate from real Jev quality. | Intermediate; pair with fixture owner. |
| Provider change | [Durable admission test](../../packages/context/continuum/tests/durable-admission.spec.ts) | Persist with generation provider A, resume the same Session with B, and inspect recall and attribution in B's request. A new Session is a separate access-policy task. | Intermediate; keyless fixture first. |
| Memory lifecycle and isolation | [Record tests](../../packages/context/continuum/tests/records.spec.ts), [scope and invalidation tests](../../packages/context/continuum/tests/policy.spec.ts) | Preserve existing supersede/deactivate and scope tests. Define retention, physical deletion and per-user authorization; then test separate users/Sessions and unchanged source events after projection. Deactivation alone is not physical erasure. | Senior design; newcomer can add approved cases. |
| Scale and auditability | [Tree/cache experiments](../../packages/context/continuum/tests/ablation.spec.ts), [decision receipts](../../packages/experimental/continuum-jev/tests/index.spec.ts) | Measure large-set retrieval precision/recall, selected bytes/tokens, latency and irrelevant candidates. Verify independent retrieval of proposed, adopted and executed decisions. Local cache-layout results do not establish provider billing savings. | Intermediate with benchmark review. |

## P2 — newcomer-sized improvements

| Task | Existing evidence or starting point | Remaining increment and acceptance | Newcomer fit |
| --- | --- | --- | --- |
| Disable memory during use | [Browser switch tests](../../apps/web/tests/continuum-memory.e2e.ts), [late-selection test](../../packages/context/continuum/tests/context.spec.ts) | Hidden-row and reload persistence cases already exist. Add enabled-to-disabled behavior during use: the next request has no recall, reload stays disabled, and persisted records remain available for an authorized re-enable. | Recommended UI task with fixture review. |
| Clean-checkout examples | [README](../../README.md), [Continuum package](../../packages/context/continuum/README.md) | Exercise no-Jev and explicitly enabled Reflex examples. Explain same-Session recovery, bounded projections and the Reflex-only memory switch. Record exact successful commands and any missing prerequisites. | Suitable independently. |
| Config and safe diagnostics | [Service tests](../../packages/context/continuum/tests/service.spec.ts), [configuration](../../packages/context/continuum/src/service.ts) | Inventory uncovered parser cases before adding tests. Add focused invalid-config cases; if adding diagnostics, derive actual mode and availability from runtime state and verify that credentials and private content are absent. | Suitable after choosing one small case. |

## Do not assign as a first independent task

- Changes to Session event types, persistence generations and migrations require the [released-format rules](../session-format-status.md) and both SDK replay surfaces.
- Changes to `agent-loop`, context projection, cache-prefix protection and cancellation require design review and cross-process regression evidence.
- Jev safety policy, credentials, signing/notarization and repository transfers belong to the release owner. Transfer to APUS-AI-Lab requires a separate permission check and review of historical material; membership alone does not establish permission to create repositories or complete the transfer.
- Existing disabled/no-Jev, scope filtering, shadow/active selection and browser visibility tests should be extended rather than recreated. Mock tests do not establish real-provider effectiveness.

## Suggested onboarding order

1. Read [architecture](../architecture.md), [release readiness](release-readiness.md) and the [Continuum limitations](../../packages/context/continuum/README.md#known-limitations-and-deferred-work).
2. Inspect the linked tests, select retrieval consistency or byte budgeting, and reproduce one boundary case before proposing a fix.
3. For UI work, choose disable-during-use and reuse the browser scaffold; preserve existing visibility and persistence assertions.
4. Submit one focused change with its acceptance evidence and relevant documentation checks. Mark a task complete only after its remaining increment is verified.
