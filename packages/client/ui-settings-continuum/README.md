---
description: "Reflex-only Continuum memory switch in the dsh web client's General settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-continuum

English | [中文](README.zh.md)

## Summary

The General settings row exposes the Reflex-only APUS Continuum memory switch while the Host serves the `continuum-memory` namespace. It is absent when Continuum is not composed.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose this browser companion with the Web settings shell. The row writes the accepted `enabled` value through the shared revision-aware ConfigForms queue. A deployment that does not serve `continuum-memory` shows no row and keeps the original Harness behavior.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half is an empty `apply`, while the browser half watches `continuum-memory` through `ctx.configForms.whileServed`. `ContinuumSettingsController` owns the accepted-value snapshot, busy state, write failure, and disposal. `ContinuumRow` renders the localized Switch into `settings.general.item`. The switch does not grant permissions or bypass Jev availability; Session events remain the memory authority.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-settings](../ui-settings/README.md) — the settings mirror and revision-aware write queue.
- [ui-settings-general](../ui-settings-general/README.md) — the General section and item slot.
- [ui-primitives](../ui-primitives/README.md) — the Switch control.
- [continuum](../../context/continuum/README.md) — Session-backed memory records and Reflex policy.

-----

<a id="model-experience"></a>
## Model Experience

### Continuum setting

#### What the model sees

This browser settings package adds no model-visible input; `ctx.configForms` only writes the Host setting. the Continuum context package owns any bounded recall message.

#### Token effect

Changing the switch changes future profile behavior and adds no model call by itself.

#### KV Cache effect

This package does not assemble a provider request or change a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Deployment dependency** — the Host must serve `continuum-memory`; the row does not create that namespace.
- **Reflex dependency** — enabling the setting remains subject to the Continuum service's Reflex/Jev switch and does not create a no-Reflex infinite-memory mode.
- **Deferred product surface** — summary-tree browsing, runtime activity projection, and cache billing remain separate P4/P5 work.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
