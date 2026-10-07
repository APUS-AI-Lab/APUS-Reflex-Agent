---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-02-system3-delegation-alert

English | [中文](2026-10-02-system3-delegation-alert.zh.md)

## Summary

Adds optional lastStepAt and note to system3/delegation-progress and adds the system3/delegation-alert event.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-02-system3-delegation-alert
baseline: false
changes:
  - root: "event:system3/delegation-alert"
    previous: null
    after: "20dcc98052694791c25e6c5320ca2cd95d97ec162b4665bc76648da80f7033e0"
    decision: same-version
  - root: "event:system3/delegation-progress"
    previous: "2026-10-02-system3-delegation-progress"
    after: "5c3f9b13622a7f3243d94ac99789f33f66bc78d2774ac24184ed53685f3bf88e"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing progress snapshots remain valid and omit the new fields, which readers treat as no step yet and no note. The alert event is a new ordinary type that System3 writes only when delegationProgress.monitor is configured: once when a run has no first step within startupMs, once per stall episode after stallMs without a new step, and at every overtimeMs multiple. Neither event is model-visible. The note carries only the child's own short progress messages, bounded to 200 characters by the subagent service.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/experimental/system3/tests packages/experimental/client-ui-system3/tests packages/subagent: all tests passed, including starting, stalled, and overtime alerts under fake timers, alert clearing in the projection, bounded notes, and the Client alert with keep-waiting and stop actions.

<a id="dev-note"></a>
## Dev Note

None.
