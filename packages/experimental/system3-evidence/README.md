---
description: "Deterministic lossless evidence span selection for long System3 tool output."
kind: "package-library"
---

# @deepseek-ai/dsh-experimental-system3-evidence

English | [中文](README.zh.md)

## Summary

This dependency-free library bounds model-visible tool output without deleting the source. `selectSystem3Evidence()` retains explicit character spans, records omitted ranges, and carries an `artifactRef` for recovery. Required error terms are preferred before head and tail fallbacks, so Jev can classify a compact evidence view without pretending it is the original log.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

```ts
import { selectSystem3Evidence } from '@deepseek-ai/dsh-experimental-system3-evidence'

declare const completeOutput: string

const selection = selectSystem3Evidence({
  artifactRef: 'tool:run-42', text: completeOutput, maxChars: 8192,
  requiredTerms: ['error', 'failed'], contextChars: 160,
})
```

Persist `completeOutput` under `artifactRef`. Send only `retainedSpans` to a model and keep `omittedRanges` available for an explicit expand or verifier request. Offsets are half-open character ranges in the original artifact.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The selector is pure and deterministic. It first retains case-insensitive windows around required terms, then applies head and tail budgets, merges overlaps, and computes explicit omissions. If the artifact fits, it returns a single `full` span. It never summarizes, hashes, or sends data by itself.

**Runtime invariant:** No runtime invariant companion is published. This library computes results from explicit inputs and owns no independent mutable observations.

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Evidence projection

#### What the model sees

The model receives only the selected spans and the stable `artifactRef`; omitted ranges remain recoverable but are not silently represented as model text.

#### Token effect

The configured `maxChars` bounds the projected artifact before any optional Jev summary, making token impact measurable against the unpruned baseline.

#### KV Cache effect

Stable span ordering and unchanged prefixes help preserve cache reuse; a new required term or artifact revision produces a new projection.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Character limits are not tokenizer limits; provider usage must still be measured from actual input tokens.
- The selector trusts the caller's artifact reference and complete text. It does not provide filesystem retention, encryption, or access control.
- Line-aware snippets, structured JSON fields, and provider-specific token budgets are deferred until the DSH integration supplies their contracts.

<a id="dev-note"></a>
### Dev Note

None.
