---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-08-session-format-v5

English | [中文](2026-11-08-session-format-v5.zh.md)

## Summary

Raises the Session writer version from 4 to 5 so the current schema can be acknowledged, and records the type changes that accumulated after the accepted V4 baseline. The breaking changes are the removal of the log-only `lsp/provider-selected` and `web/provider-selected` events, which the unified `tool/provider-selected` record replaced, and the widening of `continuum/memory-index.data.admission.source` from the literal `compaction` to `compaction | user-message`. The remaining roots add optional properties or new log-only events.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-08-session-format-v5
baseline: false
changes:
  - root: "SessionHeader"
    previous: "2026-09-16-session-format-v4"
    after: "22c6899a78214dd841c266348ae997027ef391174ddb21127f1b71dc1b362824"
    decision: version-bump
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-14-system3-prefetch"
    after: "1fe33cf301dd7e25fc4df76f0e3fb360f359653f4a085328eb6dd85e5337937b"
    decision: version-bump
  - root: "event:continuum/memory-budgeted"
    previous: null
    after: "3cc94e3b1009e365fd25bdd2dfb1181bf0ec5d3191195cc4a98fd2f2a7045ae8"
    decision: version-bump
  - root: "event:continuum/memory-index"
    previous: "2026-10-29-wp5-trajectory-facts"
    after: "d957369b30f16bf1f17c395b424b35915bc39bd8fbdf792403084feebc4cf681"
    decision: version-bump
  - root: "event:continuum/memory-index-queued"
    previous: null
    after: "90decc8b160b1783fbed0653e9e7c6f8ec2d8e9bf969494792e5d0e30dce77bd"
    decision: version-bump
  - root: "event:continuum/memory-index-rebuilt"
    previous: null
    after: "1e56911072efa80548cb770e4307a55d631abafc7c980a395b2dcfa1bcee9532"
    decision: version-bump
  - root: "event:continuum/memory-injected"
    previous: null
    after: "3544f425275428b971445968a34ba6235158d1c9078ac278c07cf5abcb41f21a"
    decision: version-bump
  - root: "event:continuum/memory-recall-decision"
    previous: null
    after: "ebc96301fd38bc561480ea9f1f751811bc92f787e5cd3e44449df6200fb69793"
    decision: version-bump
  - root: "event:continuum/memory-retrieval"
    previous: null
    after: "1436683bce21c83423016fc410d772eb5a4c96b41a8fbe19d4129451574bc803"
    decision: version-bump
  - root: "event:continuum/memory-scored"
    previous: null
    after: "d12879f833e7a326e0664e87bb3638d97194b612bd79541e8a1d07f824b1c10c"
    decision: version-bump
  - root: "event:developer/message"
    previous: "2026-10-14-system3-prefetch"
    after: "da37a00edc3c9ac64c5505fea471c0acfa882f5e88cdd6c5cf58bfc688cca16a"
    decision: version-bump
  - root: "event:job/settled"
    previous: null
    after: "3a2b9280ee61ea2cda5c13a1101a8d577bb6e84f7bf1c78088c9cfba6b781bf5"
    decision: version-bump
  - root: "event:lsp/provider-selected"
    previous: "2026-10-29-wp5-trajectory-facts"
    after: null
    decision: version-bump
  - root: "event:session/title-llm-request"
    previous: "2026-10-14-system3-prefetch"
    after: "2119ad33d027df8d72be2aad1a3a76105f41a5fde731a3913ee8631130429391"
    decision: version-bump
  - root: "event:subagent/model-selection-observation"
    previous: null
    after: "4beaa17506f917ebba34fef47f0821f19547052e3ab3e72a0aa7720d8d3c1822"
    decision: version-bump
  - root: "event:subagent/run-end"
    previous: null
    after: "1d61ae85033c15eebce776bb95fdb65c9a8d1c81c02a972d6f306ff9cfb66049"
    decision: version-bump
  - root: "event:tool/catalog-resolved"
    previous: null
    after: "83edb7db54322540b15557d28e4eb4b0e282e6b27fa86145c9b7053dbbc3b8ad"
    decision: version-bump
  - root: "event:tool/execute-deadline"
    previous: null
    after: "15db0c5f5a596478297789f216b9c8180b17053a1eadb8d1d2dc2b53053cde2b"
    decision: version-bump
  - root: "event:tool/pre-execute-decision"
    previous: null
    after: "15ed1d7b80ecfd8e8b68ac190c84a439bad72263663c3adf7cad8c84419741f5"
    decision: version-bump
  - root: "event:tool/provider-selected"
    previous: null
    after: "63422af78a373fa2bc05cc0f201cbf6da367dde32effcf485e289b6032915052"
    decision: version-bump
  - root: "event:tool/result-rewrite"
    previous: null
    after: "0df20de5e4cd6ff603bdc6388a8d845ae1b216856b8d93f030d0f6c1d863bd40"
    decision: version-bump
  - root: "event:tool/retry-started"
    previous: null
    after: "db13c63746926d32ed5cc3dd232e0ae0d84f981b94f404637538b524345e3a80"
    decision: version-bump
  - root: "event:turn/stopping"
    previous: null
    after: "f85859dd522a7f907dc3ec6701b19b0e4797d9cc8c819ae9503fd75edc330bef"
    decision: version-bump
  - root: "event:user/message"
    previous: "2026-10-14-system3-prefetch"
    after: "406ffcd4751c5c68f6b67e097472b84eefa8ea805fbf05229b12d202a0c3423a"
    decision: version-bump
  - root: "event:web/deepseek-search-llm-request"
    previous: "2026-09-11-initial"
    after: "07b5fbbfe375e1587aff38307c4ee1e521cb0e5f2dfba47d6571fe1f8eff826d"
    decision: version-bump
  - root: "event:web/provider-selected"
    previous: "2026-10-29-wp5-trajectory-facts"
    after: null
    decision: version-bump
  - root: "event:web/search-route"
    previous: null
    after: "14704222bd712300a108fa710fd70e97aaf866e13b9abf5853f16b8bbfb834b3"
    decision: version-bump
```

<a id="compatibility"></a>
## Compatibility

The V5 writer keeps the V4 physical row framing and appends no transformed payload, so a V4 runtime that reads a V5 log must refuse it by version instead of misreading it. The new edge `@deepseek-ai/dsh-session-format-v4-to-v5` promotes the header only: it forwards every event unchanged, derives the inherited cut from the last inherited end-seed marker when a seeded source leaves it unknown, and validates the target with the released V4 admission rules. Ordinary event additions and optional payload properties do not by themselves require a version step; the per-event `ignorable` guard covers vocabulary growth. This version step exists because the accepted V4 baseline already classified the two event removals and the admission-source type change as breaking, and `verify-persistence-changes` refused to acknowledge them under the finalized v4 checkpoint. Records written before this change remain readable, and the V4 generation stays on disk unchanged. The removed events were never emitted by a released V4 writer: the deploy change that introduced provider selection already appended `tool/provider-selected`, so no committed log carried the removed names and the edge needs no event rename. Readers that still encounter `lsp/provider-selected` or `web/provider-selected` treat them as historical records; V5 adds no interpretation for them.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/session/session-format-v4-to-v5/tests/migration.spec.ts: 10 tests passed. The suite covers header-only promotion, unchanged event objects and coordinates, compact-run forwarding, independent stage state, inherited-cut derivation and disagreement refusal, V4-framing round trips, V5 header and physical refusals, sparse rows, unknown-required refusal with ignorable payloads retained, the seeded marker agreement, and V5 delivery ownership. A deliberate defect in the delivery check made the ownership test fail before the fix was restored.

<a id="dev-note"></a>
## Dev Note

None.
