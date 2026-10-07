---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-07-system3-task-frame

English | [中文](2026-10-07-system3-task-frame.zh.md)

## Summary

Adds the system3/judgement and system3/task-frame events.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-07-system3-task-frame
baseline: false
changes:
  - root: "event:system3/judgement"
    previous: null
    after: "a916521e7d79713dffb82460a2790977991d333ee61739f4c3c768964e0afcb4"
    decision: same-version
  - root: "event:system3/task-frame"
    previous: null
    after: "ac45da2b86d3e15e2fb89536caa52be80e721155be5489e1242afaf860661c42"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Both are additions; existing Sessions contain neither. System3 writes system3/judgement for each task-frame judgement when taskFrame is configured in shadow or active mode, with the exact Jev request and response; it is not model-visible. In active mode System3 writes system3/task-frame whenever the frame changes; the frame reaches the model only through the system3:task-frame runtime context, which the agent loop logs as a runtime-context user message.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/experimental/system3/tests/task-frame.spec.ts packages/experimental/system3/tests/decision-kernel.spec.ts: 15 tests passed, covering frame start, kept requirements, the runtime context in later requests, the item limit, new tasks, skipped messages, shadow and off modes, restore from the log, and failure handling; the Loader composition test persists and restores a Session with a frame.

<a id="dev-note"></a>
## Dev Note

None.
