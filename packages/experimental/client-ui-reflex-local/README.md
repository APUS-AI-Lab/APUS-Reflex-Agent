---
description: "Prepare and enable local decisions from the bundle page with one primary action at a time."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-reflex-local

English | [中文](README.zh.md)

## Summary

This optional browser plugin renders the local decision engine card as the This Mac connection mode of Settings → Reflex configuration and on its bundle page, offers a one-click download when the bundle is switched on, shows background preparation above the composer, and announces local enablement with an undo action. Every surface follows one Host readiness subscription.

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

Enable the [local decision engine bundle](../reflex-local-bundle/README.md) from Plugins. When this Mac can run the engine and no model is downloaded, a dialog offers Download and turn on with the download size, or Later; when free space is short it opens the details instead. The card shows one primary action at a time: Download and turn on before the download, Pause and Cancel during it, Resume download after a pause, Turn off and Delete model once on, Turn on (Turn on anyway on a slow Mac) once downloaded, and Retry after a failure. A device that cannot run the engine gets its reason and no action. When free space cannot hold the recommended variant, the disabled primary button states need against free space and Use the compact version downloads the smaller variant when it fits. The primary download uses the Host's recommendation, the largest stable option that fits this Mac's memory and free disk. Change model lists every offered model and quantization with its download size and memory need; options that do not fit stay listed but disabled with the unmet requirement, and 35B-A3B is marked experimental. When the Reflex master switch is off, the card states that local judgments do not run. Download source choices appear under Download source only when the Host advertises more than one origin. While a download runs, is paused, or is being checked, and while a slow Mac waits for a decision, a chip above the composer shows the state; its menu offers Pause or Resume download, Cancel, Turn on anyway, and View details as the state allows. Not now hides the slow-Mac chip until the page reloads without changing Host state. When the self-test turns local decisions on, a banner says Judgments now run on this Mac with Undo, which turns them off; it appears on the next load if no page was open.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The plugin mounts the generated `reflexLocal` Remote and registers five entries: `settings.reflex.local`, `plugins.bundle.config` and `plugins.bundle.activation` keyed by the bundle name, a `conversation.input.dock` chip at order 6 that renders nothing outside the states above, and a `shell.overlay` notice that outlives the plugin page and also reports failed chip commands. One readiness mirror reconnects through the gateway stream and keeps the last snapshot during an outage. The Host keeps an automatic enablement as `unacknowledgedAutoEnableAt` across restarts, so a page closed during the self-test still gets the notice: the plugin shows it once per marker value and calls `acknowledge()` when the notice closes, so a page closed while it is visible announces it again; Undo calls `disable()`, which also clears the marker. Command failures appear in place on the card or prompt. No runtime invariant companion is published because readiness comes from one Host subscription and the notice has one owner.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Local decision engine experience design](../../../docs/feat-local-jev-mlx/local-inference-experience.html)

-----

<a id="model-experience"></a>
## Model Experience

None, as the card, prompt, and notice only control preparation and enablement; Jev decisions reach the model only through their existing consumers.

#### KV Cache effect

No direct effect; the plugin adds nothing to any request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The invitation card and decision-source badge from the experience design are not implemented. Downloads start from Settings → Reflex configuration or the bundle page; View details and the activation prompt open the bundle page because no service opens a specific Settings section.
- Progress uses the native `progress` element because the primitives offer no progress component.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
