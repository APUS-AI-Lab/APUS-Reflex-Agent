---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-08-system3-completion-review

English | [中文](2026-10-08-system3-completion-review.zh.md)

## Summary

Adds the System3 completion-review audit event.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-08-system3-completion-review
baseline: false
changes:
  - root: "event:system3/completion-review"
    previous: null
    after: "75ad06e893027545fee49d958f7cdaaee1ef6411d8de5d14295a5befca1e1214"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing Session records remain valid. The new event records the reviewed goal, judgement, unmet requirement message ids, and whether the tool call was refused. It is required on read: builds that do not know this event reject its non-ignorable record. Reopening reads the audit without repeating Jev or the goal update. This ordinary event addition keeps the current Session format version.

<a id="verification"></a>
## Verification

The System3 package passed 243 tests across 18 spec files, with 100% statements, branches, functions and lines on completion-review.ts, task-frame.ts and decision-kernel.ts. Deterministic barriers cover obsolete task frames, late goal writes, fork allowances, disabled dependencies, plugin removal and caller cancellation. The real Loader/native Goal/JSONL regression failed on the unknown event before regeneration and passed afterwards. Two live DeepSeek/Jev cases refused premature completion, performed production filesystem reads and writes, completed native goals and reopened identical logs; the second included a real user requirement in the actual Jev questions. TypeScript SDK keyless replay and Python SDK smoke use the current runtime. Local built Web browser acceptance records the actual refusal, file work, completion and retained history after reload.

<a id="dev-note"></a>
## Dev Note

None.
