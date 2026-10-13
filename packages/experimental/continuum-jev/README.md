---
description: "Editable Session-backed memory defaults and protected Reflex/Jev relevance ranking for APUS product profiles."
kind: package-bundle
---

# @deepseek-ai/dsh-experimental-continuum-jev

English | [中文](README.zh.md)

## Summary

APUS Reflex Agent Full and Lite include this profile layer so users can enable Session-backed memory from Reflex configuration. Memory starts disabled; enabling it admits subsequent human input and projects bounded recall within that Session. Jev relevance ranking starts off and requires separate outbound approval. Active ranking preserves every locally budgeted candidate; provider failures retain the baseline.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

### Select the profile layer

The APUS Desktop and Web launchers select this installed bundle for new and existing normal profiles. Other profiles select its package name in `dsh.profile.bundles` through the [profile composition reference](../../boot/app-boot/README.md). The [bundle patch](cordis.patch.yml) mounts `continuum-memory` and the optional `continuum-jev` selector below the user's profile patch. It requires a separately mounted Reflex provider for memory to operate; Safe Mode retains its independent recovery profile.

Open **Settings → Reflex configuration → Continuum memory** to enable memory, or save this profile patch:

```yaml
- id: continuum-memory
  config:
    enabled: true
```

The product provider defaults to memory mode `active`, admission `user-message`, and scope `workspace`; its switch defaults to false. Partial saved configurations retain those defaults, while explicit `mode: off`, `admission: explicit` and empty scopes remain effective. Invalid switch edits leave accepted settings unchanged. Enabling memory admits future committed human input, retains original Session source references, and supplies bounded local recall. Disabling it stops new admission and recall projection; durable records and recall already recorded in conversation history remain. Reopening the same Session restores its records. This layer does not automatically combine unrelated Sessions or grant access to task memory.

### Configure relevance ranking

The selector defaults to `off` and `privacyPolicy: { mode: local-only }`. Configure `mode`, `timeoutMs` (default 2000), `maxRequestBytes` (default 32768), `privacyPolicy`, and `sessionDataClasses` (default null, which denies outbound requests). Every Jev route is conservatively classified as network. To authorize it, use controlled or cloud-approved policy, approve its actual provider ID in `approvedRemoteIds`, and approve every explicitly declared session data class in `approvedRemoteDataClasses`; cloud-approved also requires `cloudApproval: true`. Classify the complete query and candidates at deployment, for example `sessionDataClasses: [workspace]`; the model never supplies this classification. An endpoint or the memory switch never grants approval. Remove legacy `minConfidence` and `maxSelections`: startup rejects these single-choice settings instead of silently narrowing recall. Deployments with their own complete composition may still mount the default `ContinuumJevPlugin` service directly.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [product memory provider](src/product-memory.ts) inherits the [Core memory implementation](../../context/continuum/README.md) and changes only three schema defaults; it leaves Core defaults unchanged. Loader composition and ConfigForms use the same validated provider configuration. The [ranking service](src/index.ts) scores the first sixteen candidates in one bounded Jev request. Independent noul answers estimate relevance, not factual truth or calibrated accuracy. Active mode sorts the scored prefix stably and preserves remaining candidates, including low-probability candidates.

The profile appends a prepared unknown receipt, flushes the owning Session, and verifies that receipt through the persistence backend before dispatch. A settled receipt links its prepared event sequence and retains the exact request and validated response. Cancellation leaves prepared state without a false success; missing durability or a persistence I/O failure prevents dispatch and preserves baseline. Only prepared is guaranteed durable before dispatch; settled becomes durable with the ordinary Session flush. Historical version-one receipts remain readable, and replay never calls Jev. Session-owning `selectContinuumMemory` callers must supply a durable beforeDispatch checkpoint; only non-Session consumers may omit it and own input recording themselves. A lifecycle invalidated or selector unloaded while the checkpoint is pending cannot dispatch. Unloading after dispatch does not retract that request; late advice is discarded and the main model retains the full baseline.

</details>

<a id="model-experience"></a>
## Model Experience

### Bounded memory relevance

#### What the model sees

The main model receives Core's source-backed bounded recall after explicit opt-in. Jev sees only the query and bounded candidate metadata supplied by retrieval through `JevRequest.state` and independent `noul` questions after outbound approval. Active ranking changes order without removing candidates. The selector does not read workspace files.

#### Token effect

The sidecar makes at most one request, limited by complete resolved JSON bytes. Reordering preserves the candidate set and its complete recall byte count; it does not shorten main-model context.

#### KV Cache effect

Active reordering can change the main-model prompt suffix. Off and shadow preserve baseline ordering.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The selector does not implement retrieval or record admission. Core owns the bundle's Session-backed records and their lifecycle; relevance judgments do not establish facts.
- Real Jev quality and latency require a reachable configured gateway; fake-provider tests do not establish model effectiveness.
- Only the first sixteen candidates are scored; others remain unscored and retained. Semantic indexing, query expansion, and per-record classification are separate work. Declared session data classes cover supplied candidates and the query; no content classifier detects embedded secrets.

No invariant companion is published because the request and receipt adapter owns no independent persistent projection.

<a id="dev-note"></a>
### Dev Note

This package remains experimental. Product memory requires explicit opt-in, and the relevance selector starts off. Server deployments retain their own explicit composition and privacy policy.
