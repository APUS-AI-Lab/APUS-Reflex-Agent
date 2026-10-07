---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-08-system3-task-frame-goal

English | [中文](2026-10-08-system3-task-frame-goal.zh.md)

## Summary

Lets the task frame's goal be a DSH goal objective as well as a message.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-08-system3-task-frame-goal
baseline: false
changes:
  - root: "event:system3/task-frame"
    previous: "2026-10-07-system3-task-frame"
    after: "77495110dac52ca61c5c0e3cf585ab45269bcf0e36d5273f2c06f9cb09c343f5"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

goal.messageId becomes optional and goal.goalId is added as an optional property; exactly one of them is present. Existing system3/task-frame events keep their message goal and stay valid. Events written when a DSH goal sets the task carry goalId and the objective text.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/experimental/system3/tests/task-frame.spec.ts: 13 tests passed, including a frame started by GoalService.create, an objective edit that keeps the requirements, a message that cannot replace an open goal, a completed or cleared goal that lets a message start a new frame, and an open goal restored from a seeded Session.

<a id="dev-note"></a>
## Dev Note

None.
