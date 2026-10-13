---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-13-cross-session-tasks

English | [中文](2026-10-13-cross-session-tasks.zh.md)

## Summary

Adds durable cross-session task operations and immutable business Session task bindings.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-13-cross-session-tasks
baseline: false
changes:
  - root: "event:continuum/task-binding"
    previous: null
    after: "a7f4ecd9f59ad6b3bf422e50f046b234701a59499580ab11671a42aaf8865de8"
    decision: same-version
  - root: "event:continuum/task-operation"
    previous: null
    after: "a58e387cc30b034ac55f2cb8ffa9a2d6b00e908e4937320f8b6c0f787a1b1913"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing Session events and headers remain unchanged. The new required-on-read event types are additive at the current writer version; readers without these event types reject affected logs. Domain journals use a separate JSONL root and are not business Sessions. Accepted persistence records remain unchanged.

<a id="verification"></a>
## Verification

TaskJournal: 39 tests passed, including JSONL cold reopen, CAS, idempotency, flush/readback failures and corrupted journals. Task source: 28 tests passed, including canonical workspace authorization, targeted durability flush and exact human text readback. Task service: 20 tests passed, including distinct Session recovery, authority isolation, retirement rejection, dispatch serialization and a disabled-serialization negative control.

<a id="dev-note"></a>
## Dev Note

None.
