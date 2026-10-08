---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-08-system3-interjection-forward

English | [中文](2026-10-08-system3-interjection-forward.zh.md)

## Summary

Adds the optional forwardedTo field to system3/interjection.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-08-system3-interjection-forward
baseline: false
changes:
  - root: "event:system3/interjection"
    previous: "2026-10-08-system3-interjection"
    after: "9780e6c61638f34589fadb53836173b40d7c8a18ab51dc805ad9c7ffd15cbbd0"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

forwardedTo is a new optional property; existing system3/interjection events stay valid. System3 sets it to the provider of a running delegated run that also accepted a moved message; the forwarded text is recorded by the ordinary subagent/steer event.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/experimental/system3/tests/task-frame.spec.ts: 19 tests passed, including forwarding to a running steerable run and no forwarding to a finished or non-steerable run, a run that refuses, or without the subagent service.

<a id="dev-note"></a>
## Dev Note

None.
