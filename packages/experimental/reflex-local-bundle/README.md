---
description: "Add experimental local APUS Reflex decisions beside the Jev bundle."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-reflex-local-bundle

English | [中文](README.zh.md)

## Summary

This optional bundle adds the local decision engine, its authenticated Remote, and its browser card beside an existing Jev composition. It inserts no `jev`, System3, or System3 UI row; the Jev bundle owns `jev`, and the engine fails to load without it. Shipped profiles leave it disabled.

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

Enable this bundle together with the Jev bundle. On a Mac with Apple Silicon running the desktop app, the local engine card offers the recommended model with its download size and lets you pick another model; options that do not fit memory or free space are shown with the reason. A passing, fast self-test sets Jev's default provider to the local engine and shows a banner with Undo. Turning the engine off removes that default, so Jev returns to its built-in provider. When Reflex is turned off in settings, no provider answers, including the local one. Outside the desktop app the card states that local judging needs the desktop app on Apple Silicon.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>


The static `cordis.patch.yml` inserts three rows: `reflex-local`, `api-reflex-local`, and `ui-reflex-local`. The `reflex-local` row stores data under `dshHomePath('reflex-local')`. Its `runnerPath` is `APUS_REFLEX_RUNNER` when the desktop Host exports it, else `dependencies/llama-server/llama-server` under `DSH_DESKTOP_PRIMARY_RUNTIME_SOURCE`, else undefined, in which case the engine reports `runner-missing`. Routing edits only the volatile `jev.defaultProviderId`, so Jev never reloads when the engine is turned on or off; System3 admission reads the local provider's `local` execution domain. `tests/loader-composition.e2e.ts` boots this patch over the headless profile through the Loader, layered over the Jev bundle without duplicate row ids, and also without it to prove the engine row fails. No runtime invariant companion is published because this configuration-only package has no independently mutable runtime state.

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

- Weights download on first use, from 2.7 GB (4B Q4_K_M) to 9.5 GB (9B Q8_0) for recommended options; the experimental 35B-A3B options need 21–37 GB and are never recommended.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
