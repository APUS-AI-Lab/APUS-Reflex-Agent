---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-03-system3-entry-explicit-delegation

English | [中文](2026-10-03-system3-entry-explicit-delegation.zh.md)

## Summary

Adds optional explicit to system3/entry-decision.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-03-system3-entry-explicit-delegation
baseline: false
changes:
  - root: "event:system3/entry-decision"
    previous: "2026-10-02-system3-entry-delegation"
    after: "b21037892a17d8375f1124a35300ccf73135bc598404d2f9d39ddcd03807d896"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing decisions remain valid and omit the field. System3 writes explicit: true only when the input matched the selected delegation candidate's explicitPatterns after the admission and availability checks; such a decision keeps outcome selected, sends no Jev request, and records request as null. Readers that ignore the field still see an ordinary selected delegation.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/experimental/system3/tests/delegation.spec.ts: 7 tests passed, including an explicit request that delegates without calling Jev, an unrelated input that still asks Jev, an unavailable delegate whose pattern is ignored, and blank or invalid patterns rejected at load.

<a id="dev-note"></a>
## Dev Note

None.
