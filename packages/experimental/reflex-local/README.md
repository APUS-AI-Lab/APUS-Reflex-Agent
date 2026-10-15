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
| `idleTimeoutMs` | `600000` | Runner idle period before it stops; `0` keeps it running |
| `minPrefillTokensPerSecond` | `150` | Self-test throughput below which the Host is reported slow and never enabled automatically; an Apple M5 with Metal measures about 400 on the 118-token reference prompt, CPU-only inference about 100 |

`snapshot().options` lists six options (4B, 9B, and 35B-A3B, each as Q4_K_M and Q8_0) with exact sizes, their memory tier, and `fits` with the first unmet requirement: `memory`, then free disk space for the bytes still missing plus `diskMarginBytes`. `recommended` is the largest non-experimental option that fits; when free space admits none, it is the smallest non-experimental option that fits memory. 35B-A3B is experimental: it is never recommended until it has been measured on Mac, but it can be prepared when it fits memory. `prepare()` without a variant keeps the current or failed variant, else uses the recommendation; it refuses options above the memory tier.

`prepare()` checks free space, downloads the selected variant into `models/<file>.part`, resumes retained bytes with an HTTP Range request, verifies the pinned size and SHA-256, and renames the file. It then starts the runner and runs the model card's reference decision on the selected model; a correct answer at or above the speed minimum enables local decisions. Each model keeps its own verification fingerprint and self-test result in `state.json`, so switching back to a tested model needs no new test. `pause()` keeps the partial file, `cancel()` deletes it, and `remove()` deletes all weights and disables. `runtime/assets.json` pins each file to a repository revision and the SHA-256 from that revision's `SHA256SUMS`: `apus-ailab/APUS-Reflex-4B-GGUF` at `191bfcb721ec6d44352c622a30d290ae6afbabc8`, `APUS-Reflex-9B-GGUF` at `d3691a7f15fe26ac8d6199505e03a30fdafcc563`, and `APUS-Reflex-35B-A3B-GGUF` at `0103cd6bb0878c4229e5f7ac5f02e20a630d1ffd`.

`enable()` sets the `jev` entry's volatile `defaultProviderId` to `providerId` through the config editor, and `disable()` removes the field, restoring Jev's built-in default; neither reloads Jev. `snapshot().enabled` reports whether the entry's effective default provider is this one, and `snapshot().reflexEnabled` reports the Jev master switch `jev.enabled`, which stops every provider, including this one, when false. The provider declares the `local` execution domain, so System3 admission treats its decisions as local. An automatic enablement after the self-test also records `unacknowledgedAutoEnableAt` in `state.json` so a client can offer undo after a restart; `acknowledge()`, `disable()`, and `remove()` clear it, and a manual `enable()` never sets it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

| Source | Role |
|---|---|
| `src/index.ts` | `ReflexLocal` Service: starts inspection, registers the provider inside a nested `jev` dependency, delegates `ReflexLocalService` |
| `src/engine.ts` | Preparation state machine, `state.json`, self-test, routing edits, runner ownership |
| `src/models.ts` | Pinned catalog, option fitness, and the automatic recommendation |
| `src/download.ts` | Origin probing, resumable download, verification, failure classification, free-space checks |
| `src/runner.ts` | `llama-server` process, readiness, `/completion` client, crash restart, idle stop |
| `src/device.ts` | Platform, memory, and runner gate |
| `src/contract.ts` / `src/provider.ts` | Training-contract prompt rendering and the Jev provider |

Activation reads `state.json`, then inspects weights: a file whose size and modification time match the last hash-verified fingerprint is trusted, any other complete file is hashed again. Tested weights restore `ready`; untested weights report `paused` at full size; a partial file reports `paused` with its bytes. A `preparing` record left by a stopped Host resumes immediately. `prepare()` is refused until inspection finishes.

The Service injects only `subprocess`; the provider registration lives in a nested `jev` dependency, so a Jev reload, such as one caused by a non-volatile Jev setting, re-registers the provider while the engine, runner, and downloads continue.

The runner starts lazily on the first decision or `warm()` with `--host 127.0.0.1 --port 0`, `-np 1`, and `--offline`; a fresh 32-byte key travels in `LLAMA_API_KEY`, which b11118 reads (it ignores `LLAMA_ARG_API_KEY`), so the key never appears in the process list. The port comes from the stderr `listening on` line, then `GET /health` must return 200 and `GET /props` must return 401 without the key and 200 with it; stderr keeps a bounded tail that only Host logs receive. A request that fails below HTTP marks the process for replacement, and the next acquisition restarts it. The self-test runs the reference prompt twice with `cache_prompt: false` on a fresh process and measures the second call, because the first includes one-time GPU setup.

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

Independent of the main generation route. The runner keeps one slot, so questions of one request reuse the shared-state prefix; a different state or an idle stop discards that reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **macOS arm64 only** — the runner ships with the macOS arm64 desktop runtime; other Hosts report `platform`.
- **Self-test throughput is measured on a short prompt** — the reference prompt has about 120 tokens, where fixed overhead dominates; an Apple M5 measures about 400 tokens per second against about 1,000 on long prompts. The default of 150 is calibrated on M5 only.
- **External routing changes are not pushed** — `snapshot()` reads `enabled` and `reflexEnabled` from the `jev` entry on every call, but `follow()` publishes only the engine's own changes; an edit made on the Reflex settings page appears with the next published change or snapshot read.
- **35B-A3B is unmeasured on Mac** — its options stay experimental until a Mac measurement sets a tier and a speed expectation.
- **Contract input gaps** — the training contract rejects empty or whitespace-only state and instructions, but Jev validation requires only non-empty instructions, so such requests are still rendered. Choice keys that look like integers follow JavaScript key order, not insertion order, when letters are assigned.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

`tests/engine.e2e.ts` exercises a real runner when `REFLEX_LOCAL_RUNNER` and `REFLEX_LOCAL_WEIGHTS` are set; unit tests use `tests/fake-llama-server.fixture.mjs`, which reads the same argv and `LLAMA_API_KEY`, prints the same stderr line, and answers `/health`, `/props`, and `/completion` with the same fields.

</details>
