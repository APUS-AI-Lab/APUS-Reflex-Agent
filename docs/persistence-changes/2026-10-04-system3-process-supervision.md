---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-04-system3-process-supervision

English | [中文](2026-10-04-system3-process-supervision.zh.md)

## Summary

Adds the system3/process-notice event and the system3-supervision message source.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-04-system3-process-supervision
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-02-system3-entry-delegation"
    after: "522a5e09d8f11b02fed1ef9c5d50591aed0eb9fa59f993d3e17b975f16d462ee"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-02-system3-entry-delegation"
    after: "7f16f9eee70e108e75e21fde7700f3491a8fe6235f7bf2793b09cd70afaf67a6"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-02-system3-entry-delegation"
    after: "8bf9b5c7cdc780c031c64a3a78ed5c85ce86118a9c5bdad6256b4052b3874e27"
    decision: same-version
  - root: "event:system3/process-notice"
    previous: null
    after: "310a36ad49580b64f5f22ee000de5d58ec37334a253610f83bb3cf9102023108"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-02-system3-entry-delegation"
    after: "bd80919d08e6f675e935b38577dc71c66e9cc5dc18cb2261e607987e161ec0f0"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Both are additions; existing Sessions contain neither. System3 writes system3/process-notice only when processSupervision is configured and a stall or evidence rule fires; the event is not model-visible by itself. In advise mode the advice reaches the model as a user message whose source is system3-supervision, an attribution-only kind that readers without the producer preserve as ordinary content.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/experimental/system3/tests/process-supervision.spec.ts: 9 tests passed, covering repeated failures, failure counts, stalled steps, missing verification after changes, observe mode without advice, delegated command failures, and load-time rejection of invalid thresholds and patterns.

<a id="dev-note"></a>
## Dev Note

None.
