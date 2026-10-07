---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-07-system3-output-fold

English | [中文](2026-10-07-system3-output-fold.zh.md)

## Summary

Adds the system3/output-fold event.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-07-system3-output-fold
baseline: false
changes:
  - root: "event:system3/output-fold"
    previous: null
    after: "a08b64e63b930ddf31679dc4de8424786c7f497169323a50ab043b260545e26f"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

This is an addition; existing Sessions do not contain it. System3 writes system3/output-fold only when outputFolding is configured and a matching shell result folds; the event records counts only and is not model-visible. The folded text itself is the logged tool result, and the tool's structured value keeps the complete output.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/experimental/system3/tests/output-folding.spec.ts: 12 tests passed, covering exact restoration of folded logs including CRLF, counted adjacent repeats, chained copies, the size and saving thresholds, active and shadow modes through the agent loop, skipped calls, and load-time rejection of invalid thresholds and patterns.

<a id="dev-note"></a>
## Dev Note

None.
