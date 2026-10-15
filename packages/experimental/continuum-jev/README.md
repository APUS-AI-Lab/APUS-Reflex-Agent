---
description: "Editable Session-backed memory defaults and protected Reflex/Jev admission and relevance judgements for APUS product profiles."
kind: package-bundle
---

# @deepseek-ai/dsh-experimental-continuum-jev

English | [中文](README.zh.md)

## Summary

APUS Reflex Agent Full and Lite include this profile layer so users can enable lossless Session memory from Reflex configuration. While Reflex is enabled, every human message that compaction removes from the model window is judged by Reflex; the ones later work still needs become verbatim memory records, every turn recalls only the records Reflex judges relevant to the new input, and `history_read` reads any compacted original back. Memory starts disabled, and Reflex judgement starts off and requires separate outbound approval. Without enabled Reflex the profile behaves as the base profile.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

### Select the profile layer

The APUS Desktop and Web launchers select this installed bundle for new and existing normal profiles. Other profiles select its package name in `dsh.profile.bundles` through the [profile composition reference](../../boot/app-boot/README.md). The [bundle patch](cordis.patch.yml) mounts `continuum-memory` and the `continuum-jev` Reflex service below the user's profile patch. Memory needs a separately mounted Reflex provider and `continuum-jev` in `shadow` or `active` mode; Safe Mode retains its independent recovery profile.

Open **Settings → Reflex configuration → Continuum memory** to enable memory, or save this profile patch:

```yaml
- id: continuum-memory
  config:
    enabled: true
```

The product provider defaults to memory mode `active`, admission `compaction`, candidate pool `all`, and scope `workspace`; its switch defaults to false. Partial saved configurations retain those defaults, while explicit `mode: off`, `admission: explicit` or `user-message`, and empty scopes remain effective. Invalid switch edits leave accepted settings unchanged. With compaction admission, enabling memory changes nothing until Reflex is also enabled: each compaction then offers the human messages it replaced to the Reflex admitter, and the admitted ones become records with their original Session source references. Disabling memory or Reflex stops new admission and recall; durable records and recall already recorded in conversation history remain. Reopening the same Session restores its records. This layer does not automatically combine unrelated Sessions or grant access to task memory.

### Configure Reflex judgement

The service defaults to `off` and `privacyPolicy: { mode: local-only }`. Configure `mode`, `selection` (`rank` by default; the bundle sets `threshold`), `minRelevance` (default 0.7), `routeAbove` (default 16), `minRouteProbability` (default 0.5), `tags` (eight personal-agent tags by default), `minTagProbability` (default 0.5), `maxQuotedChars` (default 600, the head and tail of a long message each tag question quotes), `maxQueryChars` (default 500), `timeoutMs` (default 2000), `maxRequestBytes` (default 32768; the bundle sets 65536), `privacyPolicy`, and `sessionDataClasses` (default null, which denies outbound requests). `rank` reorders every recall candidate; `threshold` keeps only candidates whose relevance reaches `minRelevance`, and without a Reflex answer keeps only candidates that share a query term. Admission asks one question per tag for each compacted message, assigns every tag whose probability reaches `minTagProbability`, and indexes only messages with at least one tag; the default tags are `people`, `health`, `plans`, `dates`, `money`, `places`, `work`, and `preferences`. `shadow` records both judgements but indexes every compacted message and recalls by shared terms. Every Jev route is conservatively classified as network. To authorize it, use controlled or cloud-approved policy, approve its actual provider ID in `approvedRemoteIds`, and approve every explicitly declared session data class in `approvedRemoteDataClasses`; cloud-approved also requires `cloudApproval: true`. Classify the complete query and candidates at deployment, for example `sessionDataClasses: [workspace]`; the model never supplies this classification. An endpoint or the memory switch never grants approval. Remove legacy `minConfidence` and `maxSelections`: startup rejects these single-choice settings instead of silently narrowing recall. Deployments with their own complete composition may still mount the default `ContinuumJevPlugin` service directly.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [product memory provider](src/product-memory.ts) inherits the [Core memory implementation](../../context/continuum/README.md) and changes only four schema defaults; it leaves Core defaults unchanged. Loader composition and ConfigForms use the same validated provider configuration. The [Reflex service](src/index.ts) scores the first sixteen recall candidates in one bounded Jev request; each question quotes the leading `maxQueryChars` of the input and the candidate excerpt. Independent noul answers estimate relevance, not factual truth or calibrated accuracy. `rank` sorts the scored prefix stably and preserves remaining candidates; `threshold` keeps the scored candidates at or above `minRelevance` and the unscored ones that share a query term. With `threshold` and more candidates than `routeAbove`, a routing request first asks, per tag, whether answering the input needs that kind of memory; only candidates carrying a picked tag, or no tag, are then judged, and no picked tag recalls nothing. The routing question is Chinese and names each tag's `label` and `description`, the wording that routed every target on the deployed model, and its request and picked tags are recorded in the decision receipt. While Reflex is turned off in settings, selection and admission record `provider-unavailable` with failure `reflex-disabled`: `rank` keeps the baseline order, `threshold` recalls nothing, and admission indexes nothing, as without Continuum; other Jev configuration and protocol errors still fail.

Only in `shadow` or `active` mode, and only while a Jev provider is mounted, the service provides `continuumMemoryAdmitter` and mounts [`dsh-tool-history-recall`](../../session-query/tool-history-recall/README.md) in the same scope, so the admitter and the history tools appear and disappear together. The admitter selects and tags compacted human messages for the L1 index: each message receives one Noul question per tag quoting it verbatim, so one request holds `floor(16 / tags)` messages (two with the default tags), and each batch is recorded as `continuum/memory-admission` with the indexed IDs and their tags. Off and shadow modes and every failure index the whole batch untagged; Core never discards a compacted message because Reflex failed.

For both judgements the profile appends a prepared receipt, flushes the owning Session, and verifies that its exact data reads back through the persistence backend before dispatch. A settled receipt links its prepared event sequence and retains the exact request and validated response. Cancellation leaves prepared state without a false success; missing durability or a persistence I/O failure prevents dispatch and preserves baseline. Only prepared is guaranteed durable before dispatch; settled becomes durable with the ordinary Session flush. Historical version-one receipts remain readable, and replay never calls Jev. Session-owning `selectContinuumMemory` callers must supply a durable beforeDispatch checkpoint; only non-Session consumers may omit it and own input recording themselves. A lifecycle invalidated or selector unloaded while the checkpoint is pending cannot dispatch. Unloading after dispatch does not retract that request; late advice is discarded and the main model retains the full baseline.

</details>

<a id="model-experience"></a>
## Model Experience

### Bounded memory relevance

#### What the model sees

The main model receives Core's source-backed bounded recall after explicit opt-in; with `threshold` selection it contains only the records Reflex judged relevant to the current input, and each names its source event for `history_read`. After outbound approval, Jev sees independent `noul` questions: a relevance question quotes the leading input characters and one bounded excerpt, and an admission question quotes one complete compacted human message. The service does not read workspace files.

#### Token effect

Each turn makes at most one relevance request, and each compaction one admission request per sixteen compacted messages, each limited by complete resolved JSON bytes. `rank` preserves the candidate set and its recall byte count; `threshold` removes unrelated candidates, so an unrelated input adds no recall text.

#### KV Cache effect

Recall is a new message appended after the existing history, so the existing request prefix stays stable; only the appended recall differs between selections.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- While Reflex is turned off in settings, the Jev service stays mounted, so `history_read` and `history_search` remain offered and admission still records `provider-unavailable` receipts; no index entry or recall is produced.
- The service does not implement retrieval or records. Core owns the bundle's Session-backed records and their lifecycle; Reflex judgements do not establish facts.
- Real Jev quality and latency require a reachable configured gateway; fake-provider tests do not establish model effectiveness. The live headless acceptance covers one constraint-recall scenario, and `minRelevance` and `minTagProbability` are not yet calibrated on a labeled set. The relevance request sits on the turn's critical path.
- Only the first sixteen candidates are scored; `rank` retains the rest and `threshold` keeps only those that share a query term. Semantic indexing, query expansion, and per-record classification are separate work. Declared session data classes cover supplied candidates and the query; no content classifier detects embedded secrets.

No invariant companion is published because the request and receipt adapter owns no independent persistent projection.

<a id="dev-note"></a>
### Dev Note

This package remains experimental. Product memory requires explicit opt-in, and Reflex judgement starts off. Server deployments retain their own explicit composition and privacy policy.
