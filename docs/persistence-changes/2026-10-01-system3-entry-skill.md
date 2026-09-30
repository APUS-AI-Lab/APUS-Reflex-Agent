---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-01-system3-entry-skill

English | [中文](2026-10-01-system3-entry-skill.zh.md)

## Summary

Records automatic-mode reset, entry-decision start, and bounded native Skill selection receipts.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-01-system3-entry-skill
baseline: false
changes:
  - root: "event:model/selection-reset"
    previous: null
    after: "55cccc53a50e1f166343b888724ec2785af115ec14afffb49fe8bd94f3ee3425"
    decision: same-version
  - root: "event:system3/entry-start"
    previous: null
    after: "0f109d50397f1d347b2f62df20bd1e21a200c839428c8bca5449e8ed37ab633a"
    decision: same-version
  - root: "event:system3/skill-decision"
    previous: null
    after: "2da260ec5f7fe67028206d4c6254ff01a52dfe9a7f9aa67dedf72324ac4748ce"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

These additions introduce required event names without changing existing payloads or Session format 4. Builds that do not know these events refuse their logs. Skill instructions use the existing skill-invocation source; the receipt identifies the exact committed message. Existing fixed and automatic selection histories retain their meaning.

<a id="verification"></a>
## Verification

SessionController, Jev and System3 regression: 51 files and 966 tests passed before the final source reuse refinement. Focused refinement: 8 files and 80 tests passed, including native Skill injection, JSONL replay, deadline fallback, cancellation and actual-use correlation. Host build passed.

<a id="dev-note"></a>
## Dev Note

None.
