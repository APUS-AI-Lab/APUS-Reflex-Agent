---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-17-recall-prefix-audit

English | [中文](2026-11-17-recall-prefix-audit.zh.md)

## Summary

Adds audit and grouping facts to recorded events: the last committed offset a request was built from on assistant attempts, recall ids on scored and budgeted facts, question-to-candidate bindings on the rerank evaluation, optional terms on rebuilt index entries, admission outcome/reason/request status, and the session/flushed root that records how far the log reached persistence.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-17-recall-prefix-audit
baseline: false
changes:
  - root: "event:assistant/attempt"
    previous: "2026-09-16-session-format-v4"
    after: "463a4598379da6d544ad3c456c39600f7f41d88633cfb0e2e10f26464c1dc2a7"
    decision: same-version
  - root: "event:assistant/message"
    previous: "2026-09-16-session-format-v4"
    after: "6c56797e4410ca9f31eeba31f721a387450754c9b5a26acd2b3f05156e797641"
    decision: same-version
  - root: "event:continuum/memory-admission"
    previous: "2026-11-09-continuum-source-facts"
    after: "d4c56ac107ceba993dcdfe7b1bbc475c015b24e4debba1f3c8fec345119567a6"
    decision: same-version
  - root: "event:continuum/memory-budgeted"
    previous: "2026-11-08-session-format-v5"
    after: "9eee829dcefab670816662d26caf5cdbd72030c8857a37439418124a6fb022f4"
    decision: same-version
  - root: "event:continuum/memory-decision"
    previous: "2026-11-09-continuum-source-facts"
    after: "5d5f00d8934a742f06e5417646bd0876e256c8a99dd34d4df60b793ccb2a0a91"
    decision: same-version
  - root: "event:continuum/memory-index-rebuilt"
    previous: "2026-11-09-continuum-source-facts"
    after: "a980fdffd572f50c0481ce57f650d631392d9fec505bdca57ce86ed618fdded2"
    decision: same-version
  - root: "event:continuum/memory-scored"
    previous: "2026-11-08-session-format-v5"
    after: "927c6ea728c0514f44446d0c4a4ab9c1269c7104696dcce089ed6da315a58762"
    decision: same-version
  - root: "event:session/flushed"
    previous: null
    after: "1ef4c7e0eefff1ceef90bce6d860e01d17c31e2f105f70abe4c09ccf134ab90d"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Every change is an optional body property or a required property made optional; existing records stay valid and no reader needs the new fields. absent prefixEnd on historical attempts means the pairing is unverifiable, not that it matched; absent recallId means the recall identity was not recorded, so grouping by adjacency would be a guess. session/flushed is log-only and informational: a build that does not know the type still reads the log.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/core/session/tests/session.spec.ts packages/core/agent-loop/tests/cancel.spec.ts packages/context/continuum/tests/execution-scan.spec.ts: 3 files, 127 tests passed. The prefixEnd -0 case failed on its first run; the validator now rejects -0 the same way it already rejects it for turn/step. AutoEval side re-checked against the recorded trace: residual=0, node_missing=0, new=0.

<a id="dev-note"></a>
## Dev Note

None.
