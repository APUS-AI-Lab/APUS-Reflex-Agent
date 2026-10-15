---
description: "Enable experimental local APUS Reflex decisions from the plugin manager."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-reflex-local-bundle

English | [中文](README.zh.md)

## Summary

This optional bundle composes the Jev service, the local decision engine, its authenticated Remote and browser card, and System3 with local-only privacy. Local decisions are the only Jev provider in this composition. Shipped profiles leave it disabled.

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

Open Plugins in the Web sidebar and enable Local decision engine. On a Mac with Apple silicon running the desktop app, a dialog offers Download and turn on; the bundle details show the same card with download progress, Pause, and the later Turn off and Delete model actions. A passing, fast self-test turns local decisions on and shows a banner with Undo. Until then, and whenever the engine is off, System3 decision points fall back to their default rules. Outside the desktop app the card states that local judging needs the desktop app on Apple silicon.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The static `cordis.patch.yml` inserts six rows. The `jev` row sets `defaultProviderId: reflex-local` without an endpoint, so the built-in System One provider is not registered. The `reflex-local` row stores data under `dshHomePath('reflex-local')` and reads `runnerPath` from `DSH_DESKTOP_PRIMARY_RUNTIME_SOURCE`, which only the desktop Host exports; without it the option is undefined and the engine reports `runner-missing`. The `system3` row uses `privacyMode: local-only` with `jevExecutionDomain: local` and enables only decision points that need no cloud generation route: task frame (active), completion review (shadow), and skill selection with at most 16 candidates, the local model's label limit. Their thresholds and limits follow `deploy/system3/runtime.patch.yml`; local routes are admitted for every data class, so `sessionDataClasses` lists `workspace`. `tests/loader-composition.e2e.ts` boots this patch over the headless profile through the Loader. No runtime invariant companion is published because this configuration-only package has no independently mutable runtime state.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Local decision engine experience design](../../../docs/feat-local-jev-mlx/local-inference-experience.html)

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through System3 task frame and skill selection, which turn local Jev decisions into model-visible instructions while owning every prompt.

#### KV Cache effect

The bundle contributes no request-prefix content itself; System3 owns the task frame and skill instruction placement.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Entry routing, delegation, and the hand-off pack are not composed because they need cloud generation routes; compose System3 with a cloud Jev provider for them.
- Weights download on first use: 4.5 GB for the Q8_0 variant or 2.7 GB for Q4_K_M, chosen from unified memory.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
