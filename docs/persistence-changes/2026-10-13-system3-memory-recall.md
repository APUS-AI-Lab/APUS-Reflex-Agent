---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-13-system3-memory-recall

English | [中文](2026-10-13-system3-memory-recall.zh.md)

## Summary

Adds the system3/memory-recall event recording which kept memories per-turn memory recall showed for a person input.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-13-system3-memory-recall
baseline: false
changes:
  - root: "event:system3/memory-recall"
    previous: null
    after: "e467cf9bf8c7f6c3ea3843bd6df1ceae8107078a893b7deb386af8e26f8d30b7"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

New optional producer: the event is written only when System3 memoryRecall is configured in active mode, alongside memoryScoring, and an input recalled at least one kept memory or cleared an earlier recall. Existing logs remain valid, and builds that do not know the event refuse only logs that contain it.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/experimental/system3: 22 files, 280 tests passed; vitest --config vitest.e2e.config.ts packages/experimental/system3/tests/memory-recall.e2e.ts and memory-scoring.e2e.ts: 2 tests passed; memory-recall-live.e2e.ts against DeepSeek's official API and the deployed APUS Reflex endpoint: 1 test passed.

<a id="dev-note"></a>
## Dev Note

None.
