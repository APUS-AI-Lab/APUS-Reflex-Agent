---
description: "Experimental Continuum record semantics for revisioned, source-backed memory."
kind: package-reference
---

# Continuum record semantics

English | [中文](README.zh.md)

## Summary

This package owns Continuum’s durable record/profile service: immutable source-backed records with revision checks, superseding, deactivation, replayable Session events, exact source reads, bounded retrieval, a rebuildable derived index, optional Jev selection, same-step lifecycle consumption, and an explicit switch. It never invents records or enables unlimited memory without Reflex.

Session events use the existing persistence backend and become durable after `ctx.sessions.flush(session)`. Admission is explicit by default; opt-in `admission: 'user-message'` records committed human messages with exact Session references when the Reflex-only switch is enabled. The companion `continuum-jev` service adds shadow/active selection and receipts.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Lifecycle and evaluation](#lifecycle-and-evaluation)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Import `MemoryRecordStore` for deterministic revision semantics. Use `appendMemoryRecordEvent` after a store transition, `foldMemoryRecordEvents` when rebuilding from a Session log, `readMemorySourceEvents` for exact source readback, and `retrieveMemoryWorkingSet` for bounded candidates. A successful append is not a durability promise until the caller completes `ctx.sessions.flush(session)`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`MemoryRecordStore` keeps immutable snapshots and requires the caller's observed revision for superseding or deactivation. `ContinuumMemory` pairs each Agent's controller and record store in one owned projection, restores it from the Agent Session, and persists explicit create/supersede/deactivate calls as `continuum/memory-record`. In `user-message` admission mode, a committed human `user/message` is converted after the Session append completes; generated recall messages and non-user sources are ignored. Mounting the service after an Agent already exists uses the current initiating Agent only when it owns the same Session; agentless input and input from another Session are left unadmitted. Its controller keeps a disposable index current after committed transitions; indexed candidates preserve the same lexical substring matches as direct retrieval; folding applies events without model calls or a second durable source.

-----

<a id="further-exploration"></a>
## Further Exploration

Read the [Continuum architecture and acceptance design](../../../docs/feat-lossless-memory/design.html) for the overall target design and staged acceptance plan.

-----

<a id="lifecycle-and-evaluation"></a>
## Lifecycle and evaluation

`ContinuumMemoryController` owns the Reflex-only switch, exact scope authorization, and a generation token for in-flight reads. Committed enable/mode changes invalidate pending projections, including a disable–reenable cycle. Removing the Jev service invalidates pending reads, even if Jev remounts before selection returns; Jev bindings in another Cordis isolation realm do not invalidate this service's reads. Scope changes remount the service and invalidate its previous projections. Disposing either context consumer or its owner prevents pending pre-step hooks and selector results from injecting recall. Disposing an Agent removes its controller; disposing the service invalidates and releases all its controllers. Rejected configuration edits leave current projections valid. These changes preserve durable records; record deactivation also invalidates pending projections. When Reflex is absent, `resolveContinuumMemorySwitch` resolves to the original path. If the companion selector is mounted, active mode ranks the complete bounded working set through Jev and persists `continuum/memory-decision`; shadow mode calls Jev but retains baseline order. The consumer preserves selector order, deduplicates IDs, ignores unknown IDs, and supplies a lifecycle check that prevents dispatch after a pending persistence barrier invalidates. `summary` builds a disposable authorized navigation view from the current Session-backed record projection, and `zoom` returns exact source references for one node; neither adds a second fact log. `buildContinuumSummaryTree` provides deterministic scope/kind navigation and `measureContinuumStableCacheLayouts` reports local stable-prefix reuse. The local tree/cache experiment is generated at `docs/feat-continuum-memory/continuum-ablation.json`; it measures retrieval coverage separately from layout reuse and does not claim provider billing or cache hits.

<a id="model-experience"></a>
## Model Experience

### Record semantics

#### What the model sees

When `installContinuumMemoryContext` is mounted, the model sees a bounded `continuum-memory` recall message built from active records and the current user text. Each excerpt is an unchanged window around the first matching term in the record content, or a prefix when only the kind or scope matches. It includes the record ID, revision, source event references, UTF-16 range within the record content, and omitted-side markers. These offsets do not identify positions within the source event. Selector filtering preserves the same metadata.

#### Token effect

`maxExcerptBytes` bounds each excerpt; `maxTotalBytes` bounds the complete recall text, including its heading, metadata and separators. Retrieval shortens excerpts to fit or omits a candidate when its metadata and a character cannot fit. The context consumer adds no model call; an optional Jev selector has its own request cost.

#### KV Cache effect

The consumer appends a bounded recall message, so the existing request prefix remains stable until the selected working set changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The record projection is process-local; restart recovery requires reading and folding the Session event log. `MemoryRecordIndex` is disposable derived state maintained by the controller; it can still be rebuilt from the projection or drained with a bounded backlog budget.
- The service has no full text index and does not automatically attach the summary tree to lifecycle retrieval. Summary navigation is rebuilt from Session events after restart; it is not a persisted model-summary snapshot. The tree and cache helpers are deterministic, local instrumentation; they do not report provider cache accounting. Records remain source-backed; admission is caller-owned by default and can be enabled for human messages explicitly.
- Automatic user-message admission is deliberately opt-in, uses the first configured scope, and stores message text as a source-backed fact. Deployments handling private or sensitive conversations should keep `admission: explicit` and provide a domain-specific admission caller.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

The Session event is durable. The system3 runtime patch loads this service and the companion Jev selector with the feature off by default; enabling it remains an explicit protected deployment choice.

</details>
