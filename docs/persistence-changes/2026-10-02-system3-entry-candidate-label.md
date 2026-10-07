---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-02-system3-entry-candidate-label

English | [中文](2026-10-02-system3-entry-candidate-label.zh.md)

## Summary

Adds the optional chosen candidate and its display label to System3 entry-decision receipts.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-02-system3-entry-candidate-label
baseline: false
changes:
  - root: "event:system3/entry-decision"
    previous: "2026-10-02-system3-entry-retained-route"
    after: "dda31555cc43297d5150dde4b465457b4043b0c62583a9fa260104192fcddfe8"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing receipts remain valid and omit the field. The router writes it when Jev selects a candidate or the previous route is retained, so the Client can show the configured route name as soon as the decision is recorded. Readers that ignore it see the same outcome and selection.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/experimental/system3/tests packages/experimental/client-ui-system3/tests: all tests passed, including the candidate and label in selected and retained receipts, the projected route, and the Client route notice.

<a id="dev-note"></a>
## Dev Note

None.
