---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-04-system3-route-health

English | [中文](2026-10-04-system3-route-health.zh.md)

## Summary

Adds optional avoided to system3/entry-decision.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-04-system3-route-health
baseline: false
changes:
  - root: "event:system3/entry-decision"
    previous: "2026-10-03-system3-entry-explicit-delegation"
    after: "9c7cecd646b7d0ce7f1fbf3b341f2d1c1c31135d0de9e1cb556a51a0d33177ff"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing decisions remain valid and omit the field. System3 writes avoided only when entryRouting.routeHealth is configured and at least one model candidate was degraded while another candidate remained; each entry names the candidate id, its label when configured, and the reason (errors, slow-first-token, or slow-output). Candidates in avoided are absent from candidateIds and from the Jev request. Readers that ignore the field see an ordinary decision over the remaining candidates.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/experimental/system3/tests/route-health.spec.ts: 7 tests passed, covering first-token, output-rate, and error-rate degradation, the sample window and expiry, idle probes, a degraded candidate left out of the Jev request with its reason recorded, delegations never avoided, and no exclusion when every candidate would be avoided.

<a id="dev-note"></a>
## Dev Note

None.
