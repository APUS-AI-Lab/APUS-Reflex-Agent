---
description: "Experimental Continuum record semantics for revisioned, source-backed memory."
kind: package-reference
---

# Continuum record semantics

English | [中文](README.zh.md)

## Summary

This package owns the durable Continuum record and profile service: immutable memory records with source references, revision checks, superseding, deactivation, a log-only Session event that can rebuild the projection, exact source-event reads, deterministic bounded retrieval, an optional mounted Jev selector, a lifecycle-aware same-step consumer, and an explicit profile switch. The service does not silently invent records or provide an unlimited-memory mode without Reflex.

The Session event uses the existing persistence backend and becomes durable after the caller completes `ctx.sessions.flush(session)`. Record admission remains explicit; when the companion `continuum-jev` profile service is mounted, shadow/active selection and its receipt are part of the same-step consumer.

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

`MemoryRecordStore` keeps immutable snapshots and requires the caller's observed revision for superseding or deactivation. `ContinuumMemory` restores one projection per Agent from the Agent Session and persists explicit create/supersede/deactivate calls as `continuum/memory-record`. Folding applies events without model calls or a second durable source.

-----

<a id="further-exploration"></a>
## Further Exploration

Read the [Continuum proposal](../../../docs/feat-continuum-memory/continuum-memory-proposal.html) for the staged product design.

-----

<a id="lifecycle-and-evaluation"></a>
## Lifecycle and evaluation

`ContinuumMemoryController` owns the Reflex-only switch, exact scope authorization, and a generation token for in-flight reads. Disabling the switch preserves durable records but invalidates a pending projection; deactivation does the same. When Reflex is absent, `resolveContinuumMemorySwitch` resolves to the original path. If the companion selector is mounted, active mode filters the bounded working set through Jev and persists `continuum/memory-decision`; shadow mode calls Jev but retains the baseline. The local tree/cache experiment is generated at `docs/feat-continuum-memory/continuum-ablation.json`; it measures retrieval coverage separately from estimated stable-prefix reuse and does not claim provider billing or cache hits.

<a id="model-experience"></a>
## Model Experience

### Record semantics

#### What the model sees

When `installContinuumMemoryContext` is mounted, the model sees a bounded `continuum-memory` recall message built from active records and the current user text.

#### Token effect

The recall message consumes the configured byte budget in the same model request; no separate model call is made.

#### KV Cache effect

The consumer appends a bounded recall message, so the existing request prefix remains stable until the selected working set changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The record projection is process-local; restart recovery requires reading and folding the Session event log.
- The service has no full text index, summary tree, or provider cache accounting; those remain explicit evaluation work. Record admission is caller-owned and source-backed.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

The Session event is durable. The system3 runtime patch loads this service and the companion Jev selector with the feature off by default; enabling it remains an explicit protected deployment choice.

</details>
