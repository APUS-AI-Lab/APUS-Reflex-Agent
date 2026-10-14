---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-14-system3-prefetch

English | [中文](2026-10-14-system3-prefetch.zh.md)

## Summary

Adds the system3-prefetch user-message source for read-only workspace facts System3 prefetches before a step's model request.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-14-system3-prefetch
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-11-continuum-memory-decision"
    after: "8a20a925a9b09e6fad61d844d4b2c16b1144907cd1b00a9b9f039cfc392055f4"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-11-continuum-memory-decision"
    after: "923ca7339c013d032ff7fc02324bfa57d4f49096eec6af7abfbf26088d23091f"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-11-continuum-memory-decision"
    after: "c1da67d8f0567d12008e6d45383c94d42deb0e63c0e5af74183638efb420e168"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-11-continuum-memory-decision"
    after: "74b1aabf947a4793d44fe4d5728f9da74e034803f6f9f912e1f6631f35035220"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Attribution only: the message content is ordinary text that readers preserve without this producer. Existing records remain valid and no existing source kind changes.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/experimental/system3/tests/prefetch.spec.ts: 7 tests passed.

<a id="dev-note"></a>
## Dev Note

None.
