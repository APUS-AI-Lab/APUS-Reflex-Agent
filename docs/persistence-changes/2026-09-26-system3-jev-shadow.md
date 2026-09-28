---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-26-system3-jev-shadow

English | [中文](2026-09-26-system3-jev-shadow.zh.md)

## Summary

Adds a non-model-visible system3/decision receipt for explicit Jev shadow supervision.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-26-system3-jev-shadow
baseline: false
changes:
  - root: "event:system3/decision"
    previous: null
    after: "b923b60d7839c5e3d3e03be20abbe587b9029440c839b8459cd1672149f971fe"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing records retain their declared schemas. The new event records the full structured Jev request and outcome beside the unchanged deterministic supervisor result. Older builds that do not know this required event refuse the log; this vocabulary addition does not change the Session envelope version.

<a id="verification"></a>
## Verification

The real Loader composition test drives llm-pi-ai and System One HTTP, flushes JSONL, restores both success and failure receipts, and confirms replay sends no new HTTP request. Protocol, privacy, timeout and cancellation behavior have focused tests.

<a id="dev-note"></a>
## Dev Note

None.
