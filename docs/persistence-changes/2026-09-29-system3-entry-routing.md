---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-29-system3-entry-routing

English | [中文](2026-09-29-system3-entry-routing.zh.md)

## Summary

Adds separate persisted Jev entry recommendations and automatically adopted model selections, correlated by input request ID.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-29-system3-entry-routing
baseline: false
changes:
  - root: "event:model/automatic-selection"
    previous: null
    after: "8cf64ffe0f1b4f590140051634a0abb3513a07fd9c699d393620189321536a92"
    decision: same-version
  - root: "event:system3/entry-decision"
    previous: null
    after: "b391a61506715ea660db7c77d9b23bd3bd69942e758dab5b3e8ee88354b47631"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing event payloads remain unchanged. Both additions are required-on-read events: older builds that do not recognize them refuse these logs. The new event names do not change the Session envelope format. The API model-selection projection rebuilds its versioned cache from existing records and the new automatic-selection records.

<a id="verification"></a>
## Verification

node_modules/.bin/vitest run packages/experimental/system3/tests passed 25 tests across four files, including the Loader HTTP composition. node_modules/.bin/tsc -b packages/experimental/system3 --pretty false passed. Persistence classification reports two added event roots with no required format-version increase. Built TypeScript SDK replay passed both System3 scenarios. The Python SDK entry-route smoke passed against this checkout’s official dsh launcher with no model credentials, matching SDK event payloads against persisted JSONL; this checks protocol and persistence, not the packaged executable.

<a id="dev-note"></a>
## Dev Note

None.
