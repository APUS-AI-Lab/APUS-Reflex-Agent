---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-11-continuum-memory-decision

English | [中文](2026-10-11-continuum-memory-decision.zh.md)

## Summary

Adds the durable continuum/memory-decision receipt and the continuum-memory message source used by Reflex memory recall.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-11-continuum-memory-decision
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-04-system3-process-supervision"
    after: "9dc6e47a65591c4d4ea39afad833ad7f1084bf7a7833d6e68f5ac6186eb6fb28"
    decision: same-version
  - root: "event:continuum/memory-decision"
    previous: null
    after: "774ecfa0befd8db48043c917a9f9beb3cc41f4d35e1e645ef2cfb97804900151"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-04-system3-process-supervision"
    after: "95151d8f2c5e89c4d929e950f1b8907bcb69314fb21680a83157129b4e152e96"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-04-system3-process-supervision"
    after: "d5e2cf00a3746feb82ebb29c7f5f25e3ad1a5abfc3dc962c2935704a436fc4bf"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-04-system3-process-supervision"
    after: "eed210e05c1fa38ff4a06376a3f82d77288418ec38028bfbf570b59c71bf638c"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The new receipt is optional and unknown event types remain ignorable to older readers under the existing event envelope rules. The continuum-memory source is attribution-only: readers that do not load the Continuum producer preserve the message content while retaining its source kind. No Session format version bump is required.

<a id="verification"></a>
## Verification

The Continuum record, persistence, retrieval, context, and Jev adapter tests pass locally. Persistence catalog generation and the acknowledgement checker are run against the changed source. The real Jev gateway was not accepted as a pass because the configured RunPod and official DeepSeek HTTPS endpoints timed out during this validation window.

<a id="dev-note"></a>
## Dev Note

None.
