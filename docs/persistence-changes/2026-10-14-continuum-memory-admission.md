---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-14-continuum-memory-admission

English | [中文](2026-10-14-continuum-memory-admission.zh.md)

## Summary

Adds two Continuum events: continuum/memory-index, one L1 index entry holding Reflex tags and a pointer to an original human message, never its text; and continuum/memory-admission, the receipt of one Reflex selection-and-tagging judgement over compacted human messages.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-14-continuum-memory-admission
baseline: false
changes:
  - root: "event:continuum/memory-admission"
    previous: null
    after: "ebb630c555c99590587ad1ba0e4d02ee6f0d60f83c1673b7a1bb8e7c2c2ca0fe"
    decision: same-version
  - root: "event:continuum/memory-index"
    previous: null
    after: "09503da0d57aee064fcb4a8d523dc35879c3042ce1a4be9d9f8afb6f1c4ea077"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

New event types; existing logs are unaffected. An index entry's text is resolved from its source event when the log is folded, so the log never stores a second copy. A prepared admission receipt is durably read back before the Jev request is sent and may lack a settled successor after cancellation or process failure; the settled receipt names every judged candidate, the indexed subset, and each one's tags. Replay never re-calls Jev. Builds that predate these types refuse logs that contain them.

<a id="verification"></a>
## Verification

Continuum and Continuum Jev unit tests: 334 passed, including index folding from L2 sources, per-tag judgement, durable prepared receipts before dispatch, and failure fallbacks. The shipped headless CLI e2e runs every turn in its own process against a local Reflex gateway.

<a id="dev-note"></a>
## Dev Note

None.
