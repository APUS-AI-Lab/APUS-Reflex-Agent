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

Enable the [local decision engine bundle](../reflex-local-bundle/README.md) from Plugins. When this Mac can run the engine and no model is downloaded, a dialog offers Download and turn on with the download size, or Later; when free space is short it opens the details instead. The card is the only bordered group on the Reflex page: its header is a model dropdown with one status, one primary action, and a More actions menu, followed by one fact line and, during a download, a progress bar. The dropdown lists every offered model and quantization, grouped by model size, with its download size and memory need and the tags Recommended, Experimental, Downloaded, In use, and Not enough memory or Not enough disk space; options this Mac cannot run stay listed but disabled. Choosing an option changes only what the card describes; the card keeps describing it, and any model acted on, through pauses and failures; deleting a model, and reopening the card, describe the active model, else the model the Host's preparation names, else the recommendation. For the described model the status is In use, Off, Downloaded, Not downloaded, Preparing with a percent, Paused, Checking, Self-test, Fault, or Reflex is off. The primary action is Download and turn on, or Download and switch when another model is active, with the download size; Pause during a download; Resume download for a paused or partial file; Use (Use anyway after a slow self-test) for another downloaded model, and Verify and turn on, or Verify and switch when another model is active, for a downloaded file without a passing self-test; Turn off while in use; Turn on (Turn on anyway on a slow Mac) while off; and Retry after a failure. More actions holds Delete this model, which asks first only for the model in use while local judgments are on, Cancel download, which asks before deleting the downloaded bytes, and Download source. For the active model the fact line states the runner: running with its approximate memory and, after a self-test, the seconds per judgment; loading, also while turning local judgments on starts the runner; stopped; or Failed with the Host's reason. While another model prepares in the background, the active model keeps answering and a second line names both; choosing a model while another downloads asks before pausing that download. A device that cannot run the engine gets its reason and no action. When free space cannot hold the described model, the disabled primary button states need against free space. Download sizes use decimal gigabytes with one decimal; memory tiers use binary gigabytes shown as whole GB, as Macs are sold. The card follows the master switch live from the Jev settings form (the Host snapshot's copy only where no form is served). While the Reflex master switch is off, the dropdown, More actions, and every primary action except Pause are disabled, and the active model's status reads Reflex is off. While a download runs, is paused, or is being checked, and while a slow Mac waits for a decision, a chip above the composer shows the state; its menu offers Pause or Resume download, Cancel (with the same confirmation as the card's Cancel download), Turn on anyway, and View details as the state allows. Not now hides the slow-Mac chip until the page reloads without changing Host state. When the self-test turns local decisions on, a banner says Judgments now run on this Mac with Undo, which turns them off; when a background model passes its self-test and replaces the active one, a banner names the new model with Undo, which selects the previous model again. Each banner appears on the next load if no page was open. The plugin also provides `ctx.reflexLocalMode`: the Host's persisted local-mode choice and `chooseLocal()`, which the Reflex page uses to keep This Mac selected.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The plugin mounts the generated `reflexLocal` Remote and registers five entries: `settings.reflex.local`, `plugins.bundle.config` and `plugins.bundle.activation` keyed by the bundle name, a `conversation.input.dock` chip at order 6 that renders nothing outside the states above, and a `shell.overlay` notice that outlives the plugin page and also reports failed chip commands. One readiness mirror reconnects through the gateway stream and keeps the last snapshot during an outage. Every card action that makes a model active calls `prepare({ variant, downloadSource? })`, which the Host treats as `select()` of that variant. The Host keeps an automatic enablement as `unacknowledgedAutoEnableAt` and a background switch as `unacknowledgedSwitch` across restarts, so a page closed during the self-test still gets the notice: the plugin shows each marker value once and calls `acknowledge()` or `acknowledgeSwitch()` when its notice closes, so a page closed while it is visible announces it again; Undo calls `disable()`, which also clears both markers, or `select(from)`. Command failures appear in place on the card or prompt. No runtime invariant companion is published because readiness comes from one Host subscription and the notice has one owner.

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
