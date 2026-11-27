---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-08-execution-write-decision

English | [中文](2026-11-08-execution-write-decision.zh.md)

## Summary

Adds the log-only `continuum/memory-write-decision` event, which records the terminal outcome of one post-step execution-fact judgement.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-08-execution-write-decision
baseline: false
changes:
  - root: "event:continuum/memory-write-decision"
    previous: null
    after: "a5f3fe5e1e3f8d21f5f3f49cfa208259eb73207b04674fb2b213f87715cb3c21"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing records remain valid. The event is an ordinary optional addition that older readers may ignore because it never reaches the model surface and replay derives no record from it; record content stays in `continuum/memory-record`. Readers that do not know the type refuse the log unless the envelope marks it ignorable, as for every ordinary event.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/context/continuum/tests/execution-admission.spec.ts: 14 tests passed; pnpm run gen-persistence-catalog --check: up to date.

<a id="dev-note"></a>
## Dev Note

None.
