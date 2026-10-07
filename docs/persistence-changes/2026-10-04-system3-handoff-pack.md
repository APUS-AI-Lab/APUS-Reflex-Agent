---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-04-system3-handoff-pack

English | [中文](2026-10-04-system3-handoff-pack.zh.md)

## Summary

Adds the system3/handoff-pack event.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-04-system3-handoff-pack
baseline: false
changes:
  - root: "event:system3/handoff-pack"
    previous: null
    after: "c4519065a7d2c21ca6154ac2cfe65e97587ad8e210623c01371fee5f959d35d3"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

This is an addition; existing Sessions do not contain it. System3 writes system3/handoff-pack only when entryRouting.handoffPack is configured, in the pre-step that injects a delegation instruction, before that instruction. It records the exact Jev request or null, the response when one arrived, the outcome, and the ids of the earlier user messages forwarded as requirements. The event is not model-visible; the forwarded text reaches the model inside the logged system3-delegation instruction message.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/experimental/system3/tests/handoff-pack.spec.ts: 6 tests passed, covering verbatim forwarding with recorded message ids, no requirements, no history, privacy denial, an absent or failing Jev, the deadline, turn cancellation, and load-time rejection of invalid settings.

<a id="dev-note"></a>
## Dev Note

None.
