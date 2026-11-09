---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-08-recall-query-origin

English | [中文](2026-11-08-recall-query-origin.zh.md)

## Summary

Adds optional `queryOrigin` to the retrieval and recall-decision events and `alreadyPresentRecords` to the recall-decision event, recording where a recall query came from and how many records the request already contained.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-08-recall-query-origin
baseline: false
changes:
  - root: "event:continuum/memory-recall-decision"
    previous: "2026-11-08-session-format-v5"
    after: "62c71a62e2a2750232cda7672d1505ca1f8742249e4d44017e6766b30cb36b05"
    decision: same-version
  - root: "event:continuum/memory-retrieval"
    previous: "2026-11-08-session-format-v5"
    after: "5078a685d07859721694955c12182f6f793ba6bfdb95841b65bf7098d217ef18"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing records remain valid and unchanged. All three properties are optional log-only facts that never reach the model surface; readers that predate them omit them, and replay derives no record or injection from them. `querySource` keeps its existing type because it is part of every old record; a query that now comes from the Session goal or executed text is recorded only in `queryOrigin`, and `querySource` keeps its old value so the change needs no Session format version bump. An already-present recall reports the existing `no-query-match` reason with `alreadyPresentRecords` set, because the reason union cannot gain a member without a version bump.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/context/continuum/tests/context.spec.ts: 42 tests passed; pnpm run gen-persistence-catalog --check: up to date.

<a id="dev-note"></a>
## Dev Note

None.
