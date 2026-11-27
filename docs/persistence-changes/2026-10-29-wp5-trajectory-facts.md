---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-29-wp5-trajectory-facts

English | [中文](2026-10-29-wp5-trajectory-facts.zh.md)

## Summary

Adds ten log-only observation events and optional event-body properties that no probe-side reader can derive. The agent loop records each turn's pre-step disposition (a rejected proposal never starts a step, so the log is the only place the refusal survives) and each step's execution plan; the tool pipeline records the stage and thrower of a pipeline error; the timeout policy, spill policy, skill registry, web and LSP provider selection, the approval seam's no-service degradation, the answerer's receipt, and the Continuum journal receipt each record the fact their owner observes at the commit point. Existing events gain optional fields on compaction start/end, request header and context, turn end, tool results, PTC dispatches, Continuum memory and task binding, reflex cache anchors, approval decisions and workspace changes. Every fact a probe can read from a public seam (resolved tool catalog, pre-execute and post-execute decisions, result rewrites, deadline timings, turn-stopping aggregates, inbox cancellations, tool attribution) stays in the probe and is not written here.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-29-wp5-trajectory-facts
baseline: false
changes:
  - root: "event:approval/decided"
    previous: "2026-09-11-initial"
    after: "1d6245c887b3b46dd7380b030aff9ca37d82b411dadcd1ff319f82f19103c720"
    decision: same-version
  - root: "event:approval/unavailable"
    previous: null
    after: "bfc9af609afd6a5f25784896f522ef859446bb4abc5539166605db095f57eff4"
    decision: same-version
  - root: "event:compaction/end"
    previous: "2026-09-11-initial"
    after: "465928649d1f783833f94c56e32973f4c8d83d4ddfac4a9fb08b2367c81d1e35"
    decision: same-version
  - root: "event:compaction/start"
    previous: "2026-09-11-initial"
    after: "7a555dc46fd3452b9511462391a26980c6a6f6bebd0fdc8a64aa882331a4cf47"
    decision: same-version
  - root: "event:continuum/memory-admission"
    previous: "2026-10-14-continuum-memory-admission"
    after: "58e4b099d1f8aa9b18b563fd18444a507b523e3f8ee31ae14a7dd2f0ef568a93"
    decision: same-version
  - root: "event:continuum/memory-decision"
    previous: "2026-10-14-continuum-tag-routing"
    after: "cc3669886d11f489c62a8d05718124468f4cdb4bf87707c0c04e1e1c3a6fa530"
    decision: same-version
  - root: "event:continuum/memory-index"
    previous: "2026-10-14-continuum-memory-admission"
    after: "a584d92e1bdb0edb34cbeabf743208dee4e8faf4eb22f1c27c9b5a8a17827e4f"
    decision: same-version
  - root: "event:continuum/memory-record"
    previous: "2026-10-11-continuum-memory-record"
    after: "58dcdae3ef200ae86529df4759b462debbcb50070ada273c374b4a7fa7c2c77b"
    decision: same-version
  - root: "event:continuum/task-binding"
    previous: "2026-10-13-cross-session-tasks"
    after: "2f27b8a61e281bcfa57508f9871ecd2420e03e84cbc632226df4fd7ccd5f9c5b"
    decision: same-version
  - root: "event:continuum/task-receipt"
    previous: null
    after: "28f74c18a98cc0e36c93365eacfde691e48edbbdf572a7f781fadee7b88e460a"
    decision: same-version
  - root: "event:lsp/provider-selected"
    previous: null
    after: "f0f6ac6fd0819e816149b8f81e5ecb7ef9963f0b6c252788c2c4604c3929bcbe"
    decision: same-version
  - root: "event:reflex/context-cache-anchor"
    previous: "2026-10-10-reflex-control"
    after: "fbb61681de5d23d2e3154affd1d933cae2c1c28810ffc687dc83d3738efb025c"
    decision: same-version
  - root: "event:request/context"
    previous: "2026-09-11-initial"
    after: "3868c8800c2d32e50fb47365a6d6da405985ae69e9b08ef5541de2a0df66435b"
    decision: same-version
  - root: "event:request/header"
    previous: "2026-09-16-session-format-v4"
    after: "01e171dca28ceb008e4dedee5f179edbcbed51167f8109566a7850a1b7e6cd99"
    decision: same-version
  - root: "event:skill/loaded"
    previous: null
    after: "960d0d368eb8e26ba92090024267e3307c43f94979b9bf035259470495386d98"
    decision: same-version
  - root: "event:spill/spilled"
    previous: null
    after: "6042f95f9dbb962193d0ddf844c3abfe78018e8f76119ef3e3444d6125657368"
    decision: same-version
  - root: "event:tool/execution-plan"
    previous: null
    after: "bf1ec7cfd073c2c4c718ff1e0a7cf6e9f91d2495184e5d2b554df8772e5fd491"
    decision: same-version
  - root: "event:tool/pipeline-error"
    previous: null
    after: "5f4beefbb20ee0571cfad0a210e73e3007140b956658e3687ef41321ad20bda8"
    decision: same-version
  - root: "event:tool/ptc-dispatch"
    previous: "2026-09-16-session-format-v4"
    after: "83355b96d5212116e4067b73f9d592254d8fe5e8ce5bc376af7d232dfffa5e35"
    decision: same-version
  - root: "event:tool/ptc-dispatch-start"
    previous: "2026-09-11-initial"
    after: "81d3eada05c8dd4912687ee8d0b2e0f73ff64d7fb5135549b2821d479c1d9672"
    decision: same-version
  - root: "event:turn/end"
    previous: "2026-09-16-session-format-v4"
    after: "522768b39af8ace05e9bd642bbf93d0b42a61c2460d1af4673d5bb15848886aa"
    decision: same-version
  - root: "event:turn/pre-step"
    previous: null
    after: "08eb09eac7a6489c7d0c19d0d4e7396340e7027ee7c7ae7dab57265bce8ec76a"
    decision: same-version
  - root: "event:user-question/answered"
    previous: null
    after: "678323dcfa591b76f6d5bf0d83ea61a7e1f126bf200aa8a7189de4b71fb006fb"
    decision: same-version
  - root: "event:web/provider-selected"
    previous: null
    after: "21f900ba604573e685be0623cd2d34b944512fbb6dde68724ee4f200bc1d0f2c"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Every detected change is additive and classified same-version. Optional properties are absent in records written before this change; readers treat absence as 'the fact was not recorded' and never infer it. New ordinary event types are logged through Session.append, which cannot set the envelope ignorable marker, so an older build refuses a log that contains one under the required-on-read rule — the intended safe failure rather than a silent misread, and the reason no SESSION_FORMAT_VERSION bump is required for additive vocabulary that the current generator registers in KNOWN_SESSION_EVENT_TYPES. No digest is recorded over model-visible or run-varying text: request/context carries section names without per-section hashes, the pre-step rewrite carries id deltas without batch digests, and the spill record omits stored-text and preview digests, because that text embeds wall-clock times, per-run locator names and the interpolated cwd, which snapshot fixtures cannot normalize and no reader can reverse. All new records are log-only: deriveMessages() ignores them, and no recovery, authorization, projection, or scheduling path reads them; tool/result keeps the durable result authoritative, and the Continuum isolation journal remains the sole authority behind its read-only receipt.

<a id="verification"></a>
## Verification

Ran verify-persistence-changes --check --json: every detected root is same-version. Regenerated the persistence catalog and schema inventory so KNOWN_SESSION_EVENT_TYPES matches the events that still have writers. Ran the affected package suites: core/agent-loop, core/tools and guard/timeout-policy (892 tests), the spill-policy suite (57), and the interaction, web and LSP suites. Keyless recorded-session snapshots were refreshed and re-verified after the run-varying digests were removed; model-visible message content is unchanged when compared field by field against the pre-change fixtures.

<a id="dev-note"></a>
## Dev Note

None.
