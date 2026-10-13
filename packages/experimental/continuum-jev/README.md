---
description: "Experimental Reflex/Jev controller for bounded APUS Continuum memory selection."
kind: package-reference
---

# @deepseek-ai/dsh-experimental-continuum-jev

English | [中文](README.zh.md)

## Summary

This package ranks APUS Continuum candidates without removing any memory from the bounded local baseline. One Jev request scores up to sixteen independent relevance propositions. Active mode applies the order, shadow mode records advice, and off mode makes no request. Outbound permission, complete request budgets, and a durable prepared receipt precede profile dispatch. Provider failures retain the complete baseline.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Load the default `ContinuumJevPlugin` profile service after bounded local retrieval. Configure `mode`, `timeoutMs` (default 2000), `maxRequestBytes` (default 32768), `privacyPolicy` (default `{ mode: local-only }`), and `sessionDataClasses` (default null, which denies outbound requests). Every Jev route is conservatively classified as network. To authorize it, use controlled or cloud-approved policy, approve its actual provider ID in `approvedRemoteIds`, and approve every explicitly declared session data class in `approvedRemoteDataClasses`; cloud-approved also requires `cloudApproval: true`. Classify the complete query and candidates at deployment, for example `sessionDataClasses: [workspace]`; the model never supplies this classification. An endpoint alone never grants approval. Remove legacy `minConfidence` and `maxSelections`: startup rejects these single-choice settings instead of silently narrowing recall.

<a id="understand-the-implementation"></a>
## Understand the implementation

The adapter sends the query and the first sixteen candidates in one bounded request. Independent noul answers estimate relevance; they do not establish factual truth or calibrated accuracy. Active mode sorts the scored prefix stably and preserves all remaining candidates in place, including low-probability candidates. The profile appends a prepared unknown receipt, flushes the owning Session, and verifies that receipt through the persistence backend before dispatch. A settled receipt links its prepared event sequence and retains the exact request and validated response. Cancellation leaves prepared state without a false success; missing durability or a persistence I/O failure prevents dispatch and preserves baseline. Only prepared is guaranteed durable before dispatch; settled becomes durable with the ordinary Session flush. Historical version-one receipts remain readable, and replay never calls Jev. Session-owning `selectContinuumMemory` callers must supply a durable beforeDispatch checkpoint; only non-Session consumers may omit it and own input recording themselves. A lifecycle invalidated or selector unloaded while the checkpoint is pending cannot dispatch. Unloading after dispatch does not retract that request; late advice is discarded and the main model retains the full baseline.

<a id="model-experience"></a>
## Model Experience

### Bounded memory relevance

#### What the model sees

Jev sees only the query and bounded candidate metadata supplied by retrieval through `JevRequest.state` and independent `noul` questions. The main model receives every previously budgeted candidate, reordered only in active mode. The adapter does not read workspace files.

#### Token effect

The sidecar makes at most one request, limited by complete resolved JSON bytes. Reordering preserves the candidate set and its complete recall byte count; it does not shorten main-model context.

#### KV Cache effect

Active reordering can change the main-model prompt suffix. Off and shadow preserve baseline ordering.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The adapter does not implement retrieval or record admission. The profile service only selects among the bounded candidates supplied by Continuum; it does not invent facts.
- Real Jev quality and latency require a reachable configured gateway; fake-provider tests do not establish model effectiveness.
- Only the first sixteen candidates are scored; others remain unscored and retained. Semantic indexing, query expansion, and per-record classification are separate work. Declared session data classes cover supplied candidates and the query; no content classifier detects embedded secrets.

<a id="dev-note"></a>
### Dev Note

This package remains experimental. The system3 runtime patch declares it with mode `off`; enabling Continuum remains an explicit protected deployment choice.
