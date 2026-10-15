---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-14-continuum-tag-routing

English | [中文](2026-10-14-continuum-tag-routing.zh.md)

## Summary

Adds optional tag routing to Continuum memory decision receipts: the routing request, response and picked L1 tags; an empty tag list with no ranking means routing picked no tag.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-14-continuum-tag-routing
baseline: false
changes:
  - root: "event:continuum/memory-decision"
    previous: "2026-10-13-continuum-relevance-evaluation"
    after: "b74161b6a6e4a4a87014a0b73610e5cf71d5ecf04e6989b31e47a0cbcd1dcc95"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Optional field; existing receipts remain valid and replay unchanged. Routing runs only with threshold selection when the candidates exceed routeAbove, so receipts without routing keep their meaning. Replay never re-calls Jev.

<a id="verification"></a>
## Verification

Continuum Jev selection tests cover routing by tag, no picked tag, routing failure, and the routing state and wording; Continuum core tests cover the selector pool with tags and the recall byte budget.

<a id="dev-note"></a>
## Dev Note

None.
