---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-13-reflex-input-intent

English | [中文](2026-10-13-reflex-input-intent.zh.md)

## Summary

Adds an optional bounded input-intent classification to System3 Skill decision receipts and their replayable Client view.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-13-reflex-input-intent
baseline: false
changes:
  - root: "event:system3/skill-decision"
    previous: "2026-10-01-system3-entry-skill"
    after: "adb7756e9caefc250f3b00df121661a0a1c99baee3ed8587b99f865d165d9675"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing v4 receipts omit intent and remain valid. New writers emit only six declared intent labels; absence means classification was unavailable and never implies execution. The derived system3Runtime cache version advances from 16 to 17 and is rebuilt from the immutable Session log.

<a id="verification"></a>
## Verification

Focused Skill selection, Desktop profile Loader composition, and runtime projection tests pass; malformed and low-confidence labels are not published, and a new turn clears the previous label.

<a id="dev-note"></a>
## Dev Note

None.
