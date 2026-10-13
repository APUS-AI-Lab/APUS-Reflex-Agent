---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-13-continuum-relevance-evaluation

English | [中文](2026-10-13-continuum-relevance-evaluation.zh.md)

## Summary

Adds optional batch relevance evaluation to Continuum memory decision receipts, with prepared and settled phases, exact bounded request and response, and complete ranking metadata.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-13-continuum-relevance-evaluation
baseline: false
changes:
  - root: "event:continuum/memory-decision"
    previous: "2026-10-11-continuum-memory-decision"
    after: "24a0ed8247a7e53928a16190a4db75daac26f27c02f705a4d36dc0daee5ba804"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Historical version-one receipts remain valid without evaluation. New receipts retain existing fields and version. Prepared unknown receipts record approved input before dispatch; cancellation or process failure need not have a settled result. Replay never invokes the provider.

<a id="verification"></a>
## Verification

Continuum Jev unit and real Loader/JSONL/OpenJev/Typesafe HTTP composition: 39 tests passed; selector source statements, branches, functions and lines reached 100% coverage. Tests retain complementary and low-score memories, deny unknown classification, verify durable preparation before HTTP, and prevent dispatch after lifecycle invalidation.

<a id="dev-note"></a>
## Dev Note

None.
