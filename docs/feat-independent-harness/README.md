---
description: "Run the independent Harness and identify the implemented and planned Jev integrations."
---

# Independent Jev integration

English | [中文](README.zh.md)

## Summary

This project develops Jev as a native decision model inside DeepSeek Harness. Intake strategy and dispatch are the first objective; smarter, smoother execution is the second. Jev evaluates bounded choices, DSH owns admission and execution, and System2 handles open reasoning and generation. The repository is an independent, general-purpose agent runtime. The existing implementation provides explicit typed decisions and replayable shadow receipts; it does not automatically route every request or verify arbitrary task completion.

## Table of Contents

- [Run independently](#run-independently)
- [Mount Jev](#mount-jev)
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

<a id="integration-roadmap"></a>
## Integration roadmap

The [native System3 plan](jev-native-dsh-native-plan.html) defines the next slices. None of the proposed automatic behavior below is claimed as implemented.

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

Focused unit and HTTP integration tests live under `packages/experimental/{agui,apus-dsh-jev-plugin,system3,system3-policy,system3-evidence,system3-supervisor}`. The keyless `system3-shadow` SDK scenario replays durable decision receipts. The [handoff](../../tasks/feat-independent-harness/handoff.md) records commands actually run and their results; source inspection alone does not prove deployment readiness.

<a id="dev-note"></a>
## Dev Note

The independent CI runs keyless Jev/System3/AG-UI tests, host builds, Ruff, and System3/persona SDK replay on GitHub-hosted Ubuntu. Inherited workflows require the repository variable `DSH_UPSTREAM_AUTOMATION=true`; leave it unset until their runner pools, secrets and publishing/deployment targets have been adapted. Skipped upstream jobs are not verification evidence, and this focused workflow is not the full upstream platform matrix.

Earlier `docs/feat-system3-foundation`, `docs/feat-dsh-agui`, and task records retain donor-project history and optional deployment examples. They do not define this project's default deployment. Do not run their SSH credential helpers or App overlays as part of this quick start. The source history and upstream licenses are retained; packages are not renamed or republished in this bootstrap.
