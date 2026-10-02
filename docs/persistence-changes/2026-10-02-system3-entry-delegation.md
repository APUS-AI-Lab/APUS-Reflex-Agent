---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-02-system3-entry-delegation

English | [中文](2026-10-02-system3-entry-delegation.zh.md)

## Summary

Adds the optional delegation target to System3 entry-decision candidates and the system3-delegation user message source.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-02-system3-entry-delegation
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-16-session-format-v4"
    after: "ce37491ebd158783a03c8dc4cf95f6395e68d32db64c4991ab6974e468afdc1e"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-16-session-format-v4"
    after: "2b3c955cf3c1fa480a9e90cf19c76025db80138be75bb24ca05a4e544d2b0ebf"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-16-session-format-v4"
    after: "29eb43aa171e65a15bc49c632bb092af59f21f1d9131a62bbdd56d71d08448df"
    decision: same-version
  - root: "event:system3/entry-decision"
    previous: "2026-10-02-system3-entry-candidate-label"
    after: "0cfb145b502a904af1045bbed75063afa0713b8155f27b54d2fcc0d0ff2e6f29"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-16-session-format-v4"
    after: "2e5ce80ebb1064ff297c922fbfa63b984d84fdca0cdfea45eb3c1254f4a6e412"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing receipts and messages remain valid. The router writes the delegation target only when Jev chooses a delegation candidate; System3 then injects one user message attributed to system3-delegation that names the subagent tool. The decision, the injected instruction, and any later tool call stay separate Session facts. Readers that ignore the new source treat the instruction as an ordinary user message.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/experimental/system3/tests packages/experimental/client-ui-system3/tests: all tests passed, including delegation offered only when the provider and tool are available, one instruction per delegated input, and the projected injected and called stages.

<a id="dev-note"></a>
## Dev Note

None.
