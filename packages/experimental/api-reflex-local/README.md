---
description: "Expose local decision engine preparation and enablement through the authenticated Web Remote."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-api-reflex-local

English | [中文](README.zh.md)

## Summary

The `reflexLocal` Remote connects the browser to `ctx.reflexLocal`. It streams device support, model inventory, preparation, runner, and enablement snapshots and forwards the connection mode choice (`chooseLocal`), model selection, preparation, pause, cancel, enable, disable, notice acknowledgement, and model deletion (`deleteModel`) commands.

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

Compose with the local decision engine service and Typert. The browser UI mounts this package’s generated `/remote` contribution when enabled. `prepare({ variant, downloadSource })` forwards one variant and one advertised source to the engine; omission uses the device recommendation and the configured origins. `select(variant)` makes a tested downloaded model active at once or prepares another one in the background. While a different variant is being prepared, `select()` and `prepare()` fail with the Remote code `reflexLocal/preparing-other` and details `{ preparing, requested }`, so a client can offer to pause the current download; other engine rejections reach the caller unchanged. `deleteModel(variant)` deletes one model, and `deleteModel()` deletes every model. `acknowledgeSwitch()` clears a background switch notice.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`follow()` streams complete snapshots for the lifetime of one Client observation; a disconnected observer never cancels Host-owned preparation. Every other method delegates to the service without adding state, so no runtime invariant companion is published. The controller throws no `RemoteError`; Host rejections reach the Client as `gateway/internal` failures carrying the service message.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Local decision engine experience design](../../../docs/feat-local-jev-mlx/local-inference-experience.html)

-----

<a id="model-experience"></a>
## Model Experience

None, as preparation state and commands stay outside model requests; Jev decisions reach the model only through their existing consumers.

#### KV Cache effect

No direct effect; the controller adds nothing to any request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The namespace exposes no per-decision history; decision receipts stay in the Session log written by System3.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
