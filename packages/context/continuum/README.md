---
description: "Experimental Continuum record semantics for revisioned, source-backed memory."
kind: package-reference
---

# Continuum record semantics

English | [中文](README.zh.md)

## Summary

This package owns the smallest durable part of APUS Continuum: immutable memory records with source references, revision checks, superseding, deactivation, and a log-only Session event that can rebuild the projection. It does not register a product plugin, build an index, call Reflex, or provide an unlimited-memory product mode.

The Session event uses the existing persistence backend and becomes durable after the caller completes `ctx.sessions.flush(session)`. Reflex admission, retrieval, and model injection remain later slices.

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

Import `MemoryRecordStore` for deterministic revision semantics. Use `appendMemoryRecordEvent` after a store transition and `foldMemoryRecordEvents` when rebuilding from a Session log. A successful append is not a durability promise until the caller completes `ctx.sessions.flush(session)`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`MemoryRecordStore` keeps immutable snapshots and requires the caller's observed revision for superseding or deactivation. `continuum/memory-record` stores the complete post-transition record in the existing append-only Session log. Folding applies events without model calls or a second durable source.

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

- The record projection is process-local; restart recovery requires reading and folding the Session event log.
- It does not query, index, summarize, call Reflex, or inject context.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

The Session event is durable, but this package still has no product profile or Reflex integration.

</details>
