---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-02-subagent-steer

English | [中文](2026-10-02-subagent-steer.zh.md)

## Summary

Adds the subagent/steer event and optional steerable to system3/delegation-progress.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-02-subagent-steer
baseline: false
changes:
  - root: "event:subagent/steer"
    previous: null
    after: "124270b202ad483c85f6c8bbb226d0e6e7f58f8510d5d22aadeb246f77671ec5"
    decision: same-version
  - root: "event:system3/delegation-progress"
    previous: "2026-10-02-system3-delegation-alert"
    after: "d2a568622f9a85d22c3f32d648d2f9a0b80f05b8f76e0c39268ddbc4c2e36ee2"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

subagent/steer is a new ordinary event type that the subagent service appends to the delegating parent's Session only after a running one-shot child accepted a person's input through subagents.steerByParent; it carries the lifecycle run id, the provider name, and the exact text, and it is not model-visible to the parent. Existing progress snapshots remain valid and omit steerable, which readers treat as false.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/subagent packages/experimental/system3 packages/experimental/client-ui-system3: all tests passed, including acceptance, refusal, foreign-parent, settled-run, and text-bound cases for steerByParent, the Codex turn/steer request, the projection's latest three steers, and the Client steer form.

<a id="dev-note"></a>
## Dev Note

None.
