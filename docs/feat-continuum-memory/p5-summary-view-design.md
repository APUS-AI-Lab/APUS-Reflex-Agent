# Session-backed summary navigation

English | [中文](p5-summary-view-design.zh.md)

## Goal and authority

Continuum exposes deterministic summary navigation over the active records restored from `continuum/memory-record` Session events. Session remains the only durable authority. A tree is a disposable projection, not a separately persisted summary fact or model-generated assertion.

## API and files

`ContinuumMemoryController.summary(ticket, config)` returns a scope-authorized, bounded-text tree. `zoom(ticket, path, config)` resolves a node to current source-backed records. Both reject stale tickets and disabled switches. Callers pass zoomed records' source references to `readMemorySourceEvents` for exact durable source lookup. The controller does not return records from unauthorized scopes or retired revisions.

`summary-view.ts` owns projection and zoom helpers, `policy.ts` enforces switch/authorization, and package tests cover current revisions and a real JSONL restart. `maxItemsPerLeaf` bounds leaf membership; `maxSummaryBytes` bounds each summary's UTF-8 bytes. Tree metadata grows with the corpus; the tree is navigation data and is not automatically injected into a model request.

## Validation and limits

Tests compare restart reconstruction with the pre-restart tree, resolve original source events, remove superseded/deactivated records, enforce exact scope visibility and switch disablement, and exercise multibyte summary limits. Existing Session record events supply durability; no format generation or extra event is needed. Model-generated summaries, persisted materialized snapshots, background merging, and provider cache accounting remain separate work.
