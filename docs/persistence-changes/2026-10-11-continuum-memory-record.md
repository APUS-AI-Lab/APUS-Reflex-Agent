---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-11-continuum-memory-record

English | [中文](2026-10-11-continuum-memory-record.zh.md)

## Summary

Adds the log-only Continuum memory-record event for source-backed record transitions.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-11-continuum-memory-record
baseline: false
changes:
  - root: "event:continuum/memory-record"
    previous: null
    after: "229669c953c776861d1f8dd4e6f2e99eb572237979a2fd4ffc8a5c0fab7b2569"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

This is a new event root and does not change existing event payloads or the Session format version. Older readers that do not know the event must refuse the log under the existing fail-closed unknown-event policy; the feature is only enabled by a harness that declares this event.

<a id="verification"></a>
## Verification

The Continuum persistence test appends create, supersede, and deactivate events, flushes the existing JSONL Session persistence, remounts a new Context, reads the event log, and folds it back to the exact record snapshots. The package TypeScript build and focused event test pass.

<a id="dev-note"></a>
## Dev Note

None.
