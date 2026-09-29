---
description: "Run the independent Harness and identify the implemented and planned Jev integrations."
---

# Independent Jev integration

English | [中文](README.zh.md)

## Summary

This project develops Jev as a native decision model inside DeepSeek Harness. Intake strategy and dispatch are the first objective; smarter, smoother execution is the second. Jev evaluates bounded choices, DSH owns admission and execution, and System2 handles open reasoning and generation. The repository is an independent, general-purpose agent runtime. The implementation provides explicit typed decisions, replayable receipts, and opt-in model routing for idle Web/API text prompts. It does not route every DSH entry point or verify arbitrary task completion.

## Table of Contents

- [Run independently](#run-independently)
- [Mount Jev](#mount-jev)
- [Fidoo and entry routing](#fidoo-entry)
- [Integration roadmap](#integration-roadmap)
- [Verify independence](#verify-independence)
- [Dev Note](#dev-note)

<a id="run-independently"></a>
## Run independently

Use the source build described in the [root README](../../README.md#run-from-source). The standard Web, headless, and SDK profiles retain their own model configuration. The optional AG-UI bridge accepts compatible clients and client-supplied personas; its default identity and capability descriptions are product-neutral.

<a id="mount-jev"></a>
## Mount Jev

The [Jev overlay](system3-jev.patch.yml) mounts the existing decision provider and System3 service without replacing the generation model. `JEV_ENDPOINT` and `JEV_MODEL` are required; decisions from this overlay also require the `JEV_API_KEY` credential reference. A missing credential returns an unavailable decision rather than sending an anonymous request. The overlay defaults to local-only admission and a network execution domain, so a host must explicitly declare `JEV_EXECUTION_DOMAIN=local` only when inference really runs on that host. A tunnel to a remote GPU is still network execution and requires a separately reviewed controlled privacy policy.

```sh
pnpm dsh --patch docs/feat-independent-harness/system3-jev.patch.yml --profile headless --dump-config
```

This command inspects composition; it does not make a Jev decision. A consumer calls `ctx.system3.shadowDecision` with classified facts and independent checks, then reads `lastDecision` from the live or restored Session. See the [System3 package](../../packages/experimental/system3/README.md) and [Jev provider](../../packages/experimental/apus-dsh-jev-plugin/README.md). The current receipt preserves the input, model answer, deterministic baseline, usage when reported, and privacy refusal or provider failure. Mounting the service alone does not install automatic supervision.

<a id="fidoo-entry"></a>
## Fidoo and entry routing

The [Fidoo overlay](system3-fidoo.patch.yml) uses the existing `llm-pi-ai` adapter and OpenAI-compatible `https://proxy.fidoo.ai/v1` endpoint. It reads `SYSTEM3_LITELLM_API_KEY` from the environment and declares `deepseek-v4-flash` and `deepseek-v4-pro`. Both use a conservative 131,072-token context setting and an 8,192-token output limit; these are deployment settings, not claims about the gateway's maximum capacity. This generation overlay also works without Jev.

```sh
pnpm dsh --patch docs/feat-independent-harness/system3-fidoo.patch.yml --profile headless "Reply with exactly READY. Do not use tools."
```

To enable entry decisions, configure `JEV_ENDPOINT`, `JEV_MODEL`, `JEV_API_KEY`, and `SYSTEM3_LITELLM_API_KEY`, then explicitly classify all session data in `SYSTEM3_SESSION_DATA_CLASSES` as a JSON array. Use `["public"]` only for a public-data session. The classification includes history that the selected generation model may receive; it is a deployment declaration, not an automatic sensitivity detector. The [entry overlay](system3-entry.patch.yml) admits both Jev and the named generation candidates for those declared classes. A remote GPU reached through a loopback tunnel remains network execution.

```sh
pnpm dsh --patch docs/feat-independent-harness/system3-jev.patch.yml --patch docs/feat-independent-harness/system3-fidoo.patch.yml --patch docs/feat-independent-harness/system3-entry.patch.yml --profile web --no-open
```

On a new session, an idle text prompt with no pending inbox and no recorded manual model selection enters Jev's bounded choice. The selected model applies to that prompt's turn, including tool continuations. Provider failure, oversized input, abstention, or insufficient confidence retains the baseline. Invalid candidate configuration rejects admission. Cancellation prevents late admission. An explicit model selection disables automatic entry selection for that session; create a new session to resume automatic selection in this first slice.

`system3/entry-decision` records the exact decision request and advice; `model/automatic-selection` records accepted turn selection, and `request/header` identifies the model actually called. This receipt contains user input, so it follows the session log's storage and access policy. Automatic choices do not overwrite the user's saved model preference. Attachments, busy inputs, headless, SDK, ACP, and the optional AG-UI bridge retain their existing admission paths.

The deployed `APUS-OpenJev-v1-9B-5949` is a Jev-like model using the native decision protocol. Its scores are not calibrated success probabilities. The sample threshold of 0.8 and 16 KiB decision-input cap are configurable starting values. Only the current input and allowed candidates reach the entry decision; history-dependent references should cause abstention. See the [implementation scope](entry-routing-implementation.html) and [verification report](entry-routing-verification.html).

<a id="integration-roadmap"></a>
## Integration roadmap

The [native System3 plan](jev-native-dsh-native-plan.html) defines the architecture. M1a supplies the first entry model-selection slice; the broader scheduling and execution stages remain planned.

| Stage | Deliverable | Acceptance evidence |
|---|---|---|
| Independent foundation | Product-neutral Harness, typed Jev provider, shadow receipt and replay | Keyless HTTP integration, session replay, independent runtime composition |
| M1a: intake model dispatch | Shared decision service and a Web/API adapter for idle text requests using compatible model candidates | Input-bound route adoption, explicit user selection, cancellation, expiry and actual task outcomes |
| M1b: intake strategy and entry coverage | Specialist handoff, planning/clarification paths, queued inputs and additional DSH entry adapters | Ownership, result return, modality/capacity checks and per-entry replay |
| M2: intelligent execution | Memory, capabilities, recovery, escalation, goals and communication using the same decision mechanism | Less rework, repeated handoff and route oscillation without quality regression |
| M3: local models and sustained work | Evaluate local 9B/27B Lead Agents; add durable task recovery and separately authorized notifications | Measured capabilities, resources, recovery, cancellation and delivery |

Choice probabilities are not calibrated success rates. A model's `candidate_done` is not proof that the task is complete. Empty required checks and missing evidence for passing checks must be addressed before promoting the current supervisor to automatic completion authority. The current shadow input contains structured check facts, not a semantic projection of the user's task. Decision quality and cost savings remain unproven.

<a id="verify-independence"></a>
## Verify independence

Focused unit and HTTP integration tests live under `packages/experimental/{agui,apus-dsh-jev-plugin,system3,system3-policy,system3-evidence,system3-supervisor}`. The keyless `system3-shadow` and `system3-entry-route` SDK scenarios replay durable decisions; SDK event replay does not mean SDK prompts use the Web/API router. The [handoff](../../tasks/feat-independent-harness/handoff.md) records commands actually run and their results; source inspection alone does not prove deployment readiness.

<a id="dev-note"></a>
## Dev Note

The independent CI runs keyless Jev/System3/AG-UI tests, host builds, Ruff, and System3/persona SDK replay on GitHub-hosted Ubuntu. Inherited workflows require the repository variable `DSH_UPSTREAM_AUTOMATION=true`; leave it unset until their runner pools, secrets and publishing/deployment targets have been adapted. Skipped upstream jobs are not verification evidence, and this focused workflow is not the full upstream platform matrix.

Earlier `docs/feat-system3-foundation`, `docs/feat-dsh-agui`, and task records retain donor-project history and optional deployment examples. They do not define this project's default deployment. Do not run their SSH credential helpers or App overlays as part of this quick start. The source history and upstream licenses are retained; packages are not renamed or republished in this bootstrap.
