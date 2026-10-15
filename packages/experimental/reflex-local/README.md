---
description: "Prepare and run APUS Reflex 4B on the Host as a local Jev decision provider."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-reflex-local

English | [中文](README.zh.md)

## Summary

This plugin answers typed Jev decisions with APUS Reflex 4B, 9B, or 35B-A3B GGUF weights served by a bundled `llama-server` on Apple Silicon Macs. It registers the `reflex-local` provider with the [Jev service](../apus-dsh-jev-plugin/README.md) and exposes `ctx.reflexLocal` for device checks, resumable downloads, verification, a self-test, enabling, and removal. Activation downloads nothing unless it resumes a preparation that was running when the Host stopped.

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

Mount the plugin beside a subprocess provider, the config editor, and an enabled `jev` entry, which the Jev bundle inserts; without the editor or that entry, loading fails. `dataRoot` is required and must be absolute; `runnerPath` names the bundled `llama-server`. A Host that is not macOS arm64, has less memory than the smallest tier, or has no executable runner reports `device.supported: false` with `platform`, `memory`, or `runner-missing`; the provider stays registered and every decision fails with `transport`, so callers fall back to their baseline.

| Field | Default | Meaning |
|---|---|---|
| `providerId` | `reflex-local` | Jev registry id of the local provider |
| `dataRoot` | required | Absolute directory for `models/`, partial files, and `state.json` |
| `runnerPath` | absent | Absolute `llama-server` path |
| `minMemoryBytes` | 4B Q4_K_M 8 GiB, 4B Q8_0 16, 9B Q4_K_M 16, 9B Q8_0 24, 35B-A3B Q4_K_M 32, 35B-A3B Q8_0 64 | Total memory each option requires, keyed `<model>-<quant>` |
| `modelOrigins` / `modelOrigin` | Hugging Face and HF-Mirror / absent | Download origins; an explicit `modelOrigin` disables probing and fallback |
| `modelProbeTimeoutMs` | `3000` | HEAD probe deadline used to order origins |
| `downloadStallTimeoutMs` | `60000` | Longest interval without response bytes |
| `diskMarginBytes` | 1 GiB | Free space left after a download |
| `contextTokens` | `9216` | Runner context window |
| `startupTimeoutMs` / `decisionTimeoutMs` | `120000` / `30000` | Runner readiness deadline and per-question deadline |
| `idleReleaseMs` | absent | Idle period after which the runner stops and frees the model's memory; absent keeps it resident while local decisions are enabled |
| `maxConsecutiveRunnerFailures` | `3` | Consecutive runner start or request failures after which local decisions are turned off and the runner reports `failed` |
| `routingPollMs` | `2000` | Interval for reading the `jev` entry, so changes made elsewhere publish and stop the runner |
| `minPrefillTokensPerSecond` | `150` | Self-test throughput below which the Host is reported slow and never enabled automatically; an Apple M5 with Metal measures about 400 on the 118-token reference prompt, CPU-only inference about 100 |

`snapshot().options` lists six options (4B, 9B, and 35B-A3B, each as Q4_K_M and Q8_0) with exact sizes, their memory tier, and `fits` with the first unmet requirement: `memory`, then free disk space for the bytes still missing plus `diskMarginBytes`. `recommended` is the largest non-experimental option that fits; when free space admits none, it is the smallest non-experimental option that fits memory. 35B-A3B is experimental: it is never recommended until it has been measured on Mac, but it can be prepared when it fits memory. `prepare()` without a variant keeps the current or failed variant, else uses the recommendation; it refuses options above the memory tier.

`prepare()` checks free space, downloads the selected variant into `models/<file>.part`, resumes retained bytes with an HTTP Range request, verifies the pinned size and SHA-256, and renames the file. It then starts the runner and runs the model card's reference decision on the selected model; a correct answer at or above the speed minimum enables local decisions. Each model keeps its own verification fingerprint and self-test result in `state.json`, so switching back to a tested model needs no new test. `pause()` keeps the partial file, creating an empty one when no byte has arrived, so the variant stays `paused` and resumable; `cancel()` deletes it, and `remove()` deletes all weights. `runtime/assets.json` pins each file to a repository revision and the SHA-256 from that revision's `SHA256SUMS`: `apus-ailab/APUS-Reflex-4B-GGUF` at `191bfcb721ec6d44352c622a30d290ae6afbabc8`, `APUS-Reflex-9B-GGUF` at `d3691a7f15fe26ac8d6199505e03a30fdafcc563`, and `APUS-Reflex-35B-A3B-GGUF` at `0103cd6bb0878c4229e5f7ac5f02e20a630d1ffd`.

`snapshot().localChosen` records in `state.json` that the user chose this engine as the Reflex connection mode. `chooseLocal()`, `select()`, `prepare()`, and enabling set it, and `chooseLocal()` also removes a `defaultProviderId` that names another provider. It survives `disable()`, deletion, runner failures, the Reflex master switch, and restarts, and clears only when the `jev` entry's `defaultProviderId` names another provider, which a client writes when it saves a non-local mode. Routing that already names this provider at activation sets it. `enable()` starts the active model's runner and then sets the `jev` entry's volatile `defaultProviderId` to `providerId` through the config editor; a runner that cannot start reports `failed`, leaves routing unchanged, and rejects. `disable()` removes the field, restoring Jev's built-in default; neither reloads Jev. `snapshot().enabled` reports whether the entry's effective default provider is this one, and `snapshot().reflexEnabled` reports the Jev master switch `jev.enabled`, which stops every provider, including this one, when false. The provider declares the `local` execution domain, so System3 admission treats its decisions as local. An automatic enablement after the self-test also records `unacknowledgedAutoEnableAt` in `state.json` so a client can offer undo after a restart; `acknowledge()`, `disable()`, and deleting the active model clear it, and a manual `enable()` never sets it.

The model the provider answers with is `snapshot().active`, which preparation never changes until it succeeds. `select(variant)` makes a downloaded model whose file passed, or was measured slow by, its self-test active at once: decisions already accepted finish on the old runner, which then stops, and a runner for the new model starts at once when local decisions are enabled, otherwise on the next decision. Selecting any other model prepares it in the background while the active model keeps answering; a passing, fast self-test runs on a separate process, which then serves as the new runner, and `unacknowledgedSwitch` records `{ from, to, at }` until `acknowledgeSwitch()`; undo selects `from`. A slow result keeps the active model and marks the option's `inventory.selfTest` as `slow`; selecting it again switches. The first passing, fast model also enables local decisions that are off. While one variant is being prepared, selecting another throws `ReflexLifecycleError` with code `preparing-other`. `snapshot().options[].inventory` reports `absent`, `partial` with its bytes, or `downloaded` with the last self-test of that exact file; a full-size file without a matching record, such as after lost state, is `downloaded` without `selfTest`, and selecting it hashes and self-tests it without downloading, and `snapshot().runner` reports `stopped`, `starting`, `running` with the weights size as its approximate resident memory and, with `idleReleaseMs`, the idle release time, or `failed`.

While local decisions and the Reflex master switch are both on, the active model's runner stays resident and holds about its weights file's size in memory: it starts when the Host activates, on `enable()`, after a switch, and when the master switch turns on elsewhere. Loading 4B Q8_0 takes about 0.75 s on an Apple M5 with the file in the page cache; a decision that arrives while the runner loads waits for it, longer for larger models and a cold cache. `disable()` and a Reflex master switch turned off elsewhere stop the runner after the decisions in flight; models stay downloaded. With `idleReleaseMs`, an idle runner also stops, and the next decision restarts it. `deleteModel(variant)` deletes one model; deleting the active model stops its runner and clears `active` and its notices. Deletion never changes routing, so a client keeps showing local mode, and enabled local decisions fail with `transport` until another model becomes active. `remove()` and `deleteModel()` delete every model. After `maxConsecutiveRunnerFailures` start or transport failures in a row, the engine disables local decisions, restoring Jev's built-in default, and reports the runner as `failed` until `enable()` or a new selection.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

| Source | Role |
|---|---|
| `src/index.ts` | `ReflexLocal` Service: starts inspection, registers the provider inside a nested `jev` dependency, delegates `ReflexLocalService` |
| `src/engine.ts` | Preparation state machine, active model and switches, `state.json`, self-test, routing edits, runner ownership and failure count |
| `src/models.ts` | Pinned catalog, option fitness, and the automatic recommendation |
| `src/download.ts` | Origin probing, resumable download, verification, failure classification, free-space checks |
| `src/runner.ts` | `llama-server` process, readiness, `/completion` client, crash restart, idle stop |
| `src/device.ts` | Platform, memory, and runner gate |
| `src/contract.ts` / `src/provider.ts` | Training-contract prompt rendering and the Jev provider |

Activation reads `state.json`, then inspects weights: a file whose size and modification time match the last hash-verified fingerprint is trusted, any other complete file is hashed again. Inspection hashes complete files only until the first one verifies. An active model that is still a verified, tested file restores `ready`; otherwise `active` is cleared. No other file becomes active at launch, so a model deleted while active stays inactive. Without an active model, untested weights report `paused` at full size and a partial file reports `paused` with its bytes. A `preparing` record left by a stopped Host resumes immediately. `select()` and `prepare()` are refused until inspection finishes.

The Service injects only `subprocess`; the provider registration lives in a nested `jev` dependency, so a Jev reload, such as one caused by a non-volatile Jev setting, re-registers the provider while the engine, runner, and downloads continue.

The runner starts on `warm()`, `enable()`, or the first decision, with `--host 127.0.0.1 --port 0`, `-np 1`, and `--offline`; a fresh 32-byte key travels in `LLAMA_API_KEY`, which b11118 reads (it ignores `LLAMA_ARG_API_KEY`), so the key never appears in the process list. The port comes from the stderr `listening on` line, then `GET /health` must return 200 and `GET /props` must return 401 without the key and 200 with it; stderr keeps a bounded tail that only Host logs receive. A request that fails below HTTP marks the process for replacement, and the next acquisition restarts it. The self-test runs the reference prompt twice with `cache_prompt: false` on a fresh process and measures the second call, because the first includes one-time GPU setup.

No runtime invariant companion is published: `dsh-subprocess` owns process observations and the engine has no second projection to reconcile.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Jev decision service](../apus-dsh-jev-plugin/README.md)

-----

<a id="model-experience"></a>
## Model Experience

### Local Jev decision prompt

#### What the model sees

Nothing is added to the main LLM request. For each Jev question with two or more candidates, the local Reflex model receives one chat-wrapped training-contract prompt: the shared state, a JSON task with the primitive, instructions, and lettered candidate descriptions, and `Answer:`. Only the first generated position is read.

#### Token effect

The main LLM token budget is unchanged. Each question costs one local completion of one output token; Jev usage reports summed prompt tokens, cached prompt tokens, and the number of completions.

#### KV Cache effect

Independent of the main generation route. The runner keeps one slot, so questions of one request reuse the shared-state prefix; a different state or a runner stop discards that reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **macOS arm64 only** — the runner ships with the macOS arm64 desktop runtime; other Hosts report `platform`.
- **Self-test throughput is measured on a short prompt** — the reference prompt has about 120 tokens, where fixed overhead dominates; an Apple M5 measures about 400 tokens per second against about 1,000 on long prompts. The default of 150 is calibrated on M5 only.
- **External routing changes are polled** — `snapshot()` reads `enabled` and `reflexEnabled` on every call, but `follow()` and the runner stop see changes made on the Reflex settings page only at the next `routingPollMs` tick.
- **Model loading delays decisions after launch and switches** — at Host launch and after `select()` switches models, Jev already routes to this provider while the runner loads, so decisions in that window wait for the load; only `enable()` loads before routing.
- **A background switch briefly runs two processes** — the candidate model is tested in its own process while the active model keeps serving, so memory peaks at both weights files until the switch completes.
- **35B-A3B is unmeasured on Mac** — its options stay experimental until a Mac measurement sets a tier and a speed expectation.
- **Contract input gaps** — the training contract rejects empty or whitespace-only state and instructions, but Jev validation requires only non-empty instructions, so such requests are still rendered. Choice keys that look like integers follow JavaScript key order, not insertion order, when letters are assigned.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

`tests/engine.e2e.ts` exercises a real runner when `REFLEX_LOCAL_RUNNER` and `REFLEX_LOCAL_WEIGHTS` are set, and a real 4B→9B switch when `REFLEX_LOCAL_SWITCH_WEIGHTS` is also set; unit tests use `tests/fake-llama-server.fixture.mjs`, which reads the same argv and `LLAMA_API_KEY`, prints the same stderr line, and answers `/health`, `/props`, and `/completion` with the same fields.

</details>
