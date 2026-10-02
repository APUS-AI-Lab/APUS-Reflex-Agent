---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-02-system3-delegation-progress

English | [中文](2026-10-02-system3-delegation-progress.zh.md)

## Summary

Adds the system3/delegation-progress event: throttled, content-free progress snapshots of subagent runs in the delegating Agent's Session.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-02-system3-delegation-progress
baseline: false
changes:
  - root: "event:system3/delegation-progress"
    previous: null
    after: "b7a5287089022cc0d2f384d42fef9d4b853a4192785d29543b9502569d12423b"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

This is a new ordinary event type; existing logs remain valid and contain none. System3 writes it only when delegationProgress is enabled: once at run start, at most once per interval while steps arrive, and once at run end with the stop reason. Snapshots carry step categories and counts, never child content, and are not model-visible. Readers that do not know the type refuse the log as for any new required event type.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/experimental/system3/tests packages/experimental/client-ui-system3/tests: all tests passed, including start, throttled running, and end snapshots through the real subagent service, failed runs, disposal, the projected latest run, and the Client run card.

<a id="dev-note"></a>
## Dev Note

None.
