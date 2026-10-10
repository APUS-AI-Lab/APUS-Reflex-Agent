---
description: "Experimental Continuum record semantics for revisioned, source-backed memory."
kind: package-reference
---

# Continuum record semantics

English | [中文](README.zh.md)

## Summary

This package currently owns the smallest testable part of APUS Continuum: immutable memory records with source references, revision checks, superseding, and deactivation. The store is an in-memory semantic projection. It does not register a product plugin, write Session events, build an index, call Reflex, or provide an unlimited-memory product mode.

The next slice will add a Session-backed provider that makes these operations durable and replayable. Until that provider exists, process restart loses the projection by design.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Import `MemoryRecordStore` when a test or a future provider needs deterministic revision semantics. A successful in-memory operation is not a durability promise; callers must add the Session-backed provider before exposing a “saved” state.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`MemoryRecordStore` keeps immutable snapshots and requires the caller's observed revision for superseding or deactivation. Source references retain a Session ID and event sequence so a later provider can reopen the original evidence. The store is deliberately not a second durable source.

-----

<a id="further-exploration"></a>
## Further Exploration

Read the [Continuum proposal](../../../docs/feat-continuum-memory/continuum-memory-proposal.html) for the staged product design.

-----

<a id="model-experience"></a>
## Model Experience

### Record semantics

#### What the model sees

Nothing directly. `MemoryRecordStore` only creates source-backed records; a later Continuum consumer owns any injected evidence.

#### Token effect

Zero direct tokens; this package does not construct a model request.

#### KV Cache effect

This package sends no model request and has no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The current store is process-local and does not survive restart.
- It does not query, index, summarize, call Reflex, or inject context.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

The Session-backed provider is the next implementation slice.

</details>
