---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-13-system3-memory-score

English | [中文](2026-10-13-system3-memory-score.zh.md)

## Summary

Adds the system3/memory-score event recording which compacted person messages memory scoring kept.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-13-system3-memory-score
baseline: false
changes:
  - root: "event:system3/memory-score"
    previous: null
    after: "7432947d80eb37a0c3ad872e726a41b90c752cd14eb78aef8a0a684e8509f62d"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

New optional producer: the event is written only when System3 memoryScoring is configured in active mode and a compaction replaced person messages that Jev judged still needed. Existing logs remain valid, and builds that do not know the event refuse only logs that contain it.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/experimental/system3/tests/memory.spec.ts: 7 tests passed; vitest --config vitest.e2e.config.ts packages/experimental/system3/tests/memory-scoring.e2e.ts: 1 test passed.

<a id="dev-note"></a>
## Dev Note

None.
