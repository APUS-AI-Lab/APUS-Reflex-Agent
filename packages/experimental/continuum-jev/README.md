---
description: "Experimental Reflex/Jev controller for bounded APUS Continuum memory selection."
kind: package-reference
---

# @deepseek-ai/dsh-experimental-continuum-jev

English | [中文](README.zh.md)

## Summary

This package is the Reflex-only decision adapter for APUS Continuum. It keeps a deterministic local baseline, supports `off`, `shadow`, and `active` modes, bounds Jev input to retrieved candidates, rejects invented IDs, and falls back on provider failure or low confidence. It can append a replayable decision receipt to the Session log. It does not retrieve records or claim unlimited context by itself.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Call `selectContinuumMemory` after a bounded local retrieval step. `off` preserves the baseline path. `shadow` records Jev advice for comparison while returning the baseline. `active` accepts only a supplied candidate above `minConfidence`.

<a id="understand-the-implementation"></a>
## Understand the implementation

The adapter sends candidate IDs, labels, excerpts, scores, and the query to the provider-neutral `ctx.jev` capability. The choice set is closed over the supplied IDs plus `none`; an unknown choice, unavailable provider, cancellation, or low confidence cannot introduce memory into the active result. `recordContinuumMemoryDecision` stores the mode, baseline and selected IDs, outcome, confidence, and failure reason as `continuum/memory-decision`; `latestContinuumMemoryDecision` replays the newest receipt without calling Jev.

<a id="model-experience"></a>
## Model Experience

### Bounded memory choice

#### What the model sees

Only the query and bounded candidate metadata supplied by `selectContinuumMemory`. The adapter does not read the workspace or add messages to the main model request.

#### Token effect

The Jev sidecar has its own request. Main-model token accounting is unchanged until a later consumer explicitly injects the selected records.

#### KV Cache effect

No direct main-route cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The adapter does not implement retrieval, same-step injection, or the product switch; the receipt API only records the decision and does not make it model-visible.
- Real Jev quality and latency require a reachable configured gateway; fake-provider tests do not establish model effectiveness.
- Multi-selection, summary-tree navigation, cache measurement, and permission filtering remain later Continuum stages.

<a id="dev-note"></a>
### Dev Note

This package remains experimental and is not loaded by default profiles.
