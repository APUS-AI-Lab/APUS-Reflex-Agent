---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-09-continuum-source-facts

English | [中文](2026-11-09-continuum-source-facts.zh.md)

## Summary

Adds read-only source facts to Continuum recall and write events: query/retrieval/filter/selection facts, a recall id, write and attempt attribution, per-version index evidence, and two new log-only write events.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-09-continuum-source-facts
baseline: false
changes:
  - root: "event:continuum/memory-admission"
    previous: "2026-10-29-wp5-trajectory-facts"
    after: "931970c6934a41874dabb1a169ccd4d7e8c43adb47ec4eba4030a961ea002c12"
    decision: same-version
  - root: "event:continuum/memory-decision"
    previous: "2026-10-29-wp5-trajectory-facts"
    after: "26297c7dac1296c937844127fae35de765e377c35b071079ee7ce34c0f7fb2ad"
    decision: same-version
  - root: "event:continuum/memory-index"
    previous: "2026-11-08-session-format-v5"
    after: "8d13957d44bf5fe029187cc8dcd7d2136b485a368ecc0491f2de6636faa0608d"
    decision: same-version
  - root: "event:continuum/memory-index-queued"
    previous: "2026-11-08-session-format-v5"
    after: "e026850b847da4f077e1e21bb40df80ef0fb1bff2cfe667a7d86ef954484a37f"
    decision: same-version
  - root: "event:continuum/memory-index-rebuilt"
    previous: "2026-11-08-session-format-v5"
    after: "366f0e845a3940a6ad50d7277c5d3434f3aba7a76f9329780b0a59641537114b"
    decision: same-version
  - root: "event:continuum/memory-injected"
    previous: "2026-11-08-session-format-v5"
    after: "c46d236e588f7d38794fb580b7c90c251de6aa5756906f41ef8db5f1b7446675"
    decision: same-version
  - root: "event:continuum/memory-recall-decision"
    previous: "2026-11-08-recall-query-origin"
    after: "1abc944f3eef75ac0346381e6ecc12da6af6a56b790ccc1c25ca44769ab48475"
    decision: same-version
  - root: "event:continuum/memory-record"
    previous: "2026-10-29-wp5-trajectory-facts"
    after: "40cb7d19124fbfbbd259eecb397bb2a162acd382957d9f8648471f25bfa0dad1"
    decision: same-version
  - root: "event:continuum/memory-retrieval"
    previous: "2026-11-08-recall-query-origin"
    after: "18ace0606da6896b111dd56771f9aedf478b6c47d546f9fc277e7dc24ad4eab3"
    decision: same-version
  - root: "event:continuum/memory-write-candidates"
    previous: null
    after: "6782125f181bab4354969675b89e25da90b25659375045a0fa3c01893086c612"
    decision: same-version
  - root: "event:continuum/memory-write-result"
    previous: null
    after: "edda07db25b874a2fcecc8ff7901408aebcc313e12815bc450fb39e3c704506a"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Every addition is an optional property, and the two new event roots describe facts that did not exist before, so existing records remain valid and the Session format version is unchanged. Readers that do not know the new roots refuse a log containing them unless the event carries ignorable, exactly as for any repository-declared event; a build with this change declares both. Historical events keep their original meaning: a missing recallId, writeId or appliedRecords means the fact was never recorded, never that it is zero.

<a id="verification"></a>
## Verification

./node_modules/.bin/vitest run packages/context/continuum/tests packages/experimental/continuum-jev/tests: 396 tests passed. vitest run packages/context/continuum/tests/recall-facts.spec.ts and write-facts.spec.ts cover the new fields; tsc --noEmit on both packages and oxlint on the changed files pass.

<a id="dev-note"></a>
## Dev Note

None.
