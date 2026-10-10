---
description: "Experimental Continuum record semantics for revisioned, source-backed memory."
kind: package-library
---

# Continuum record semantics

English | [中文](README.zh.md)

## Summary

This package currently owns the smallest testable part of APUS Continuum: immutable memory records with source references, revision checks, superseding, and deactivation. The store is an in-memory semantic projection. It does not register a product plugin, write Session events, build an index, call Reflex, or provide an unlimited-memory product mode.

The next slice will add a Session-backed provider that makes these operations durable and replayable. Until that provider exists, process restart loses the projection by design.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use this package

Import `MemoryRecordStore` when a test or a future provider needs deterministic revision semantics. A successful in-memory operation is not a durability promise; callers must add the Session-backed provider before exposing a “saved” state.

## Understand the implementation

`MemoryRecordStore` keeps immutable snapshots and requires the caller's observed revision for superseding or deactivation. Source references retain a Session ID and event sequence so a later provider can reopen the original evidence. The store is deliberately not a second durable source.

## Model Experience

None, as this library owns record semantics and registers no model context; a later Continuum consumer owns any injected evidence.

#### KV Cache effect

This package sends no model request and has no cache effect.

## Known Limitations and Deferred Work

- The current store is process-local and does not survive restart.
- It does not query, index, summarize, call Reflex, or inject context.
