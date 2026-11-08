---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-08-sdk-dispatch-facts

English | [中文](2026-11-08-sdk-dispatch-facts.zh.md)

## Summary

Adds two log-only Session events recording minimal model-dispatch facts: llm/dispatch (session, exact committed prefix end, turn/step) and llm/dispatch-settled (the dispatch record and the assistant settlement event that closed it).

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-08-sdk-dispatch-facts
baseline: false
changes:
  - root: "event:llm/dispatch"
    previous: null
    after: "51dc09b0cc092ccf146dc03542d280da687fbb519436865f78426991b6cbd609"
    decision: same-version
  - root: "event:llm/dispatch-settled"
    previous: null
    after: "5044ddd4d7ae6ef58098ffda9b908d944166c0b3d421608c3e58044bcf449696"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Both events are additive, log-only, and carry no model content. Existing records remain readable because the events are absent; a log written with them is read by this build, and an older build rejects the unknown types under the ordinary vocabulary-growth rule. Nothing in request reconstruction depends on them: a log without them rebuilds exactly as before.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/sdk/server/tests packages/sdk/protocol/tests packages/sdk/client/tests: 174 tests passed. Python: PYTHONPATH=src python3 -m pytest tests/test_request_view.py tests/test_client.py tests/test_service.py: 78 tests passed.

<a id="dev-note"></a>
## Dev Note

None.
