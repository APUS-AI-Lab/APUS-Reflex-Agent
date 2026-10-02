---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-02-system3-entry-retained-route

English | [中文](2026-10-02-system3-entry-retained-route.zh.md)

## Summary

Adds the optional retained route to System3 entry-decision receipts.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-02-system3-entry-retained-route
baseline: false
changes:
  - root: "event:system3/entry-decision"
    previous: "2026-09-29-system3-entry-routing"
    after: "be2c1d523179fc16f51f6b7c160c4e14def9b0bff4ea34ac29b64a76e47bb9fd"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing receipts remain valid and omit the field. The router writes it only when retainOnAbstain is enabled and Jev abstains or answers below the confidence threshold while the earlier route is still an admitted candidate. Readers that ignore it see the same abstain or low-confidence outcome; the System3 runtime projection version increases so cached folds are rebuilt with the retained route.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/experimental/system3/tests: 100 tests passed, including retention on abstain and low confidence, baseline on provider failure, and retention only for admitted candidates.

<a id="dev-note"></a>
## Dev Note

None.
