---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-08-system3-interjection

English | [中文](2026-10-08-system3-interjection.zh.md)

## Summary

Adds the system3/interjection event.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-08-system3-interjection
baseline: false
changes:
  - root: "event:system3/interjection"
    previous: null
    after: "92745119ec7ac2871a3716b932458c18b2cacff7cb3d4e9aaef08b968fe7184d"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

This is an addition; existing Sessions do not contain it. System3 writes system3/interjection only when taskFrame.interjection is configured and a person queues a plain-text message behind a running turn; it records the decision and whether the message moved. The move itself is the ordinary inbox steer, so it is logged as before; the event is not model-visible.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/experimental/system3/tests/task-frame.spec.ts: 17 tests passed, including a queued requirement that reaches the next step of the same turn and is not judged again when claimed, a side question kept for the next turn, shadow mode, a failed move and a missing controller that leave the item queued, and skipped steered, attached, and failed messages.

<a id="dev-note"></a>
## Dev Note

None.
