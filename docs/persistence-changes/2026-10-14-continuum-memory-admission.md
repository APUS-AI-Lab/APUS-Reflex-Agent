---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-14-continuum-memory-admission

English | [中文](2026-10-14-continuum-memory-admission.zh.md)

## Summary

Adds the continuum/memory-admission event: the receipt of one Reflex judgement of which compacted human messages Continuum keeps as memory records.

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
    after: "c85c189b80b451a3ad4e24fbc5af77a470329f90f33cfdb00a4e5b9ded830b28"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

New event type; existing logs are unaffected. A prepared receipt is durably read back before the Jev request is sent and may lack a settled successor after cancellation or process failure. The settled receipt names every judged candidate and the admitted subset; replay reads it and never re-calls Jev. Builds that predate this type refuse logs that contain it.

<a id="verification"></a>
## Verification

Continuum Jev admission tests: 13 passed, including durable prepared receipts before dispatch, batches of at most sixteen, and failure fallbacks. The shipped headless CLI e2e runs every turn in its own process against a local Reflex gateway: 6 scenarios passed.

<a id="dev-note"></a>
## Dev Note

None.
