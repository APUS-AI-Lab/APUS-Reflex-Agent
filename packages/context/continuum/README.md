---
description: "Experimental Continuum record semantics for revisioned, source-backed memory."
kind: package-reference
---

# Continuum record semantics

English | [中文](README.zh.md)

## Summary

Save original text with exact source references, retrieve bounded excerpts, and retain explicit corrections for audit. The optional task plugin lets a new Session recover inputs from the same persistent task; the memory-record plugin separately supports Reflex selection. Continued work uses a finite model window; complete processing coverage and scale acceptance remain unfinished.

Session events use the existing persistence backend and become durable after `ctx.sessions.flush(session)`. Admission is explicit by default; the opt-in `user-message` and `compaction` modes record human messages with exact Session references. The companion `continuum-jev` service adds Reflex selection, admission, and receipts.

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

`ContinuumConfigFields` exposes the validated schema fields for profile providers that define their own defaults. Core still defaults to `enabled: false`, `mode: off`, `admission: explicit`, `candidatePool: lexical` and empty scopes. With the Reflex-only switch enabled, `admission: 'user-message'` records every committed human message, and `admission: 'compaction'` records the human messages a compaction checkpoint replaces once a mounted Reflex admitter keeps them. `candidatePool: all` also offers records that share no term with the input, newest first after every lexical hit, so a mounted selector can judge them; without a selector only records that share a term are injected.

-----

The optional `@deepseek-ai/dsh-continuum/tasks` plugin attaches distinct Sessions to one host-configured task. Its separate JSONL journal has a single writer, durable revision checks, exact request deduplication and complete original text; the business Session list excludes that journal. Configuration fixes `root`, `workspace`, `domainId`, `principalId` and `taskId`. `maxContextBytes` and `maxPageBytes` default to 8192. The host grants one local principal access to the exact canonical workspace; this is not a multi-user authentication service.

Human text is admitted without trimming, item-count eviction or length truncation. Live sources are flushed through their owning Session; cold sources require temporary exclusive write ownership before flush and exact readback. An externally owned source is refused. Domain commits publish only after append, flush and exact readback; uncertain persistence stops further reads and writes until recovery. Task revisions are serialized with model requests through stream settlement, including downstream middleware, so an in-flight request delays corrections and other admissions. Auxiliary compaction calls retain authority and retirement checks while using their own selected message ranges.

`read_continuum_task` returns byte-bounded JSON pages with source event/block references, SHA-256, task revision and a continuation cursor. A stale cursor must restart from the current first page. `pending` means more active text remains to read; neither reading nor saving means processing or completion. The context snapshot reflects its assembly revision; the current human message is saved before provider dispatch and may advance that revision. Explicit host corrections retire a named predecessor but retain its original text. Shipped profiles retain a lightweight task guard: a bound Session without its matching authority refuses model dispatch. Already-bound Sessions also refuse dispatch after retirement because previous summaries or outputs may contain stale content; a fresh Session uses the current task. Automatic history repair, assistant/tool progress capture, input processing receipts, Reflex ranking of this task projection, and measured window-scale acceptance remain separate work.

See the [cross-session design and acceptance](../../../docs/feat-cross-session-memory/design.html) and [optional profile overlay](../../../apps/cli/config/examples/continuum-task.patch.yml). The task store is durable; its complete in-memory projection is not a claim of constant-memory or unlimited-scale operation.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`MemoryRecordStore` keeps immutable snapshots and requires the caller's observed revision for superseding or deactivation. `ContinuumMemory` pairs each Agent's controller and record store in one owned projection, restores it from the Agent Session, and persists explicit create/supersede/deactivate calls as `continuum/memory-record`. In `user-message` admission mode, a committed human `user/message` is converted after the Session append completes; generated recall messages and non-user sources are ignored. Mounting the service after an Agent already exists uses the current initiating Agent only when it owns the same Session; agentless input and input from another Session are left unadmitted. In `compaction` admission mode, each committed `compaction/summary` queues its shadowed human messages that have text and no record yet; the optional `continuumMemoryAdmitter` returns the IDs to keep, an admitter failure keeps every candidate, and an admitter removed before it runs keeps none. Without a mounted admitter this mode neither admits nor recalls. The next same-step read waits for queued admissions, so records from a compaction that ran before the request are visible to it. Its controller keeps a disposable index current after committed transitions; indexed candidates preserve the same lexical substring matches as direct retrieval; folding applies events without model calls or a second durable source.

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

When `installContinuumMemoryContext` is mounted, the model sees a bounded `continuum-memory` recall message built from active records and the current user text. Each excerpt is an unchanged window around the first matching term in the record content, or a prefix when only the kind or scope matches. It includes the record ID, revision, source event references, UTF-16 range within the record content, and omitted-side markers. These offsets do not identify positions within the source event. Selector filtering preserves the same metadata. The source event references name the event `history_read` accepts as `event`.

#### Token effect

`maxExcerptBytes` bounds each excerpt; `maxTotalBytes` bounds the complete recall text, including its heading, metadata and separators. Retrieval shortens excerpts to fit or omits a candidate when its metadata and a character cannot fit. The context consumer adds no model call; an optional Jev selector has its own request cost.

#### KV Cache effect

The consumer appends a bounded recall message, so the existing request prefix remains stable until the selected working set changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The record projection is process-local; restart recovery requires reading and folding the Session event log. `MemoryRecordIndex` is disposable derived state maintained by the controller; it can still be rebuilt from the projection or drained with a bounded backlog budget.
- The service has no full text index and does not automatically attach the summary tree to lifecycle retrieval. Summary navigation is rebuilt from Session events after restart; it is not a persisted model-summary snapshot. The tree and cache helpers are deterministic, local instrumentation; they do not report provider cache accounting. Records remain source-backed; admission is caller-owned by default and can be enabled for human messages explicitly.
- Automatic user-message admission is deliberately opt-in, uses the first configured scope, and stores message text as a source-backed fact. Deployments handling private or sensitive conversations should keep `admission: explicit` and provide a domain-specific admission caller.
- Compaction admission covers human messages only; assistant answers and tool results stay readable through `history_read` but do not become records. A process that exits while an admission is queued loses that judgement, and the checkpoint is not offered again after restart.

No invariant companion is published because this package exposes no independently owned runtime observation to reconcile with its Session-backed projection.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

The Session event is durable. The system3 runtime patch loads this service and the companion Jev selector with the feature off by default; enabling it remains an explicit protected deployment choice.

</details>
