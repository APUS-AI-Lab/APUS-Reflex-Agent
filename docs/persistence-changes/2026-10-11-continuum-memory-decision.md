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
    previous: "2026-10-10-reflex-control"
    after: "31c881e980e85cee57c4e8ad47d4eaafa4d637e8f5997fb125be0d5038a6ac21"
    decision: same-version
  - root: "event:continuum/memory-decision"
    previous: null
    after: "774ecfa0befd8db48043c917a9f9beb3cc41f4d35e1e645ef2cfb97804900151"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-10-reflex-control"
    after: "7797ffd1aaf1f5f1b2beffedfa16180439e5353890f9664c77c3c3edaa446ef1"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-10-reflex-control"
    after: "001ed762898ce13eac7b3922981e388b65c287a69ad541114c62d436a31a4de9"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-10-reflex-control"
    after: "e2ebe93b42d3b577703c8724408e2e0a9c2aa6a983bdeedbae6835c989ee7df0"
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
