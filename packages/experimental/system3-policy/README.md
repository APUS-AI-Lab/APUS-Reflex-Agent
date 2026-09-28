---
description: "Deterministic local-first route admission for the experimental System3 harness."
kind: "package-library"
---

# @deepseek-ai/dsh-experimental-system3-policy

English | [中文](README.zh.md)

## Summary

This dependency-free library is the privacy boundary for the experimental System3 harness. Jev, DSH, or a provider registry may propose a route, but `admitSystem3Routes()` applies the user's local, controlled, or cloud-approved policy before any route is selected. A model score cannot bypass a blocked network route.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The package has no Cordis plugin and makes no network calls. Pass ordered route candidates to the pure functions and use the returned `selected` route only after admission.

```ts
import { selectSystem3Route } from '@deepseek-ai/dsh-experimental-system3-policy'

const decision = selectSystem3Route(
  { mode: 'local-only' },
  [
    { id: 'local-9b', executionDomain: 'local', dataClasses: ['workspace', 'secret'] },
    { id: 'codex', executionDomain: 'network', dataClasses: ['workspace'] },
  ],
  'codex', // a Jev preference; policy still wins
)
// decision.selected?.id === 'local-9b'
```

Use `controlled` or `cloud-approved` only with explicit remote route ids and data-class allowlists. If no candidate is legal, `requiresClarification` is true and the caller must ask for approval or fail closed.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Local candidates are retained. Network candidates require an approved route id and an allowlist entry for every data class they may receive. `cloud-approved` also requires `cloudApproval: true`. Duplicate ids are reduced to their first occurrence, and the original candidate order is preserved. This makes the function suitable as a deterministic, auditable seam between classification and execution.

**Runtime invariant:** No runtime invariant companion is published. This library computes results from explicit inputs and owns no independent mutable observations.

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Route admission

#### What the model sees

Nothing from this package is inserted into model context; a Jev `preferredId` remains an execution hint, and a blocked route never receives the candidate's model-visible input.

#### Token effect

None directly; the package performs local comparisons and emits no model request.

#### KV Cache effect

None; the package does not assemble or send model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The package checks declared route domains and data classes; it does not inspect a provider's actual network behavior or enforce OS-level isolation.
- Route metadata must come from a trusted host. The System3 consumer applies this policy before a Jev shadow request; callers own other execution paths.
- The package does not infer consent from model confidence. A user approval surface and durable export ledger are separate System3 work.

<a id="dev-note"></a>
### Dev Note

None.
