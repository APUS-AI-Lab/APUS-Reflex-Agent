---
description: "Run the explicit System3 source-checkout profile with Fidoo generation and a controlled RunPod Jev gateway."
---

# System3 model chain

English | [中文](model-chain.zh.md)

## Summary

The source-checkout overlays configure the main generation route as `fidoo/deepseek-v4-flash` through `https://proxy.fidoo.ai/v1`, and mount the independent Jev decision gateway. The Fidoo server already owns a `system3-dsh` virtual key. The profile reads credential references rather than secret values. Jev remains an explicit System3 shadow decision; mounting the profile does not automatically call Jev on every AgentLoop step.

## Table of Contents

- [Prepare credentials and connectivity](#prepare-credentials-and-connectivity)
- [Create and inspect the profile](#create-and-inspect-the-profile)
- [Run the profile](#run-the-profile)
- [Verify the decision path](#verify-the-decision-path)
- [Limitations](#limitations)
- [Dev Note](#dev-note)

-----

<a id="prepare-credentials-and-connectivity"></a>
## Prepare credentials and connectivity

Run commands from the repository worktree. The [launcher](run-system3.py) requires existing SSH access to Fidoo and RunPod. It captures the Fidoo `system3-dsh` key and RunPod gateway key through SSH, then supplies `SYSTEM3_LITELLM_API_KEY` and `APUS_JEV_API_KEY` only in the dsh child environment. The RunPod key stays at `/root/.config/openjev/gateway.key`; the launcher creates no credential file and never prints a key.

The [tunnel overlay](system3-fidoo-runpod-tunnel.patch.yml) addresses `http://127.0.0.1:30135`; on a developer machine this address must reach the RunPod host through an SSH tunnel. It uses `jevExecutionDomain: network`, `privacyMode: controlled`, and approves only route `jev` with `public` data. A loopback URL does not make execution local when SSH forwards it to another host.

The [same-host override](system3-fidoo-runpod-local.patch.yml) applies only when the harness process runs on the RunPod host containing the Jev gateway. Apply it after the tunnel overlay; it replaces the complete System3 config with `local-only` admission and `jevExecutionDomain: local`. These System3 settings govern Jev admission. The main LLM still sends its generation requests to Fidoo in either deployment.

<a id="create-and-inspect-the-profile"></a>
## Create and inspect the profile

Create a separate `system3` profile from the shipped `headless` template and inspect the effective tree before launching a task:

```sh
pnpm dsh --profile system3 --from-default-profile headless --patch docs/feat-system3-foundation/system3-fidoo-runpod-tunnel.patch.yml --dump-config
```

Use `--from-default-profile` only when the profile does not exist. It fails if `system3` already has a profile manifest. Later inspection omits that flag:

```sh
pnpm dsh --profile system3 --patch docs/feat-system3-foundation/system3-fidoo-runpod-tunnel.patch.yml --dump-config-schema
```

The overlays use relative TypeScript plugin paths, resolved beside their YAML file, so they target this source checkout. A packaged deployment must install the experimental packages in its profile and replace those two source paths with their package names. The overlays disable the direct DeepSeek adapter and replace the main LLM route and fresh-agent default; they do not modify shipped bundles.

<a id="run-the-profile"></a>
## Run the profile

The launcher creates or reuses an isolated `system3-live` profile under the ignored `.cache/system3-live` home. It starts one foreground SSH tunnel on a random loopback port, rewrites only the temporary Jev endpoint and source plugin paths, runs dsh, and joins both owned processes on exit. The temporary overlay contains no keys and is removed after the task. It does not install a daemon or change the remote services.

Inspect the launch plan without SSH, credential reads, or filesystem writes:

```sh
python3 docs/feat-system3-foundation/run-system3.py --dry-run -- --json "Reply with exactly the word READY."
```

Run one task using the existing gateway keys:

```sh
python3 docs/feat-system3-foundation/run-system3.py -- "Reply with exactly the word READY."
```

`--repo-root`, `--dsh-home`, and `--profile` change the local launch location. Repeat `--patch <file>` before `--` to add a consumer or verification overlay after the model-chain overlay. Arguments after `--` belong to the headless app.

For manual launch, supply both credential references through the environment or harness credential store and keep a controlled tunnel listening at port `30135`; then launch the existing inspected profile:

```sh
pnpm dsh --profile system3 --patch docs/feat-system3-foundation/system3-fidoo-runpod-tunnel.patch.yml "Reply with exactly the word READY."
```

For a harness running on the Jev RunPod host, append the same-host override before the task positional argument:

```sh
pnpm dsh --profile system3 --patch docs/feat-system3-foundation/system3-fidoo-runpod-tunnel.patch.yml --patch docs/feat-system3-foundation/system3-fidoo-runpod-local.patch.yml "Reply with exactly the word READY."
```

The preferred user identifier `deepseek-v4.1-flash` is absent from the verified Fidoo registry. The overlay selects its actual registered identifier, `deepseek-v4-flash`; an alias must not imply an unverified model version. Model capacity and reasoning settings in the overlay are deployment configuration and can be adjusted without changing plugin source.

<a id="verify-the-decision-path"></a>
## Verify the decision path

The [System3 service](../../packages/experimental/system3/README.md) exposes `shadowDecision(session, request, signal)` and `lastDecision(session)` for explicit consumers. A consumer supplies structured supervisor checks, data classes, and optional turn/step metadata. System3 builds the fixed Choice candidates and Jev state from these facts, then records the complete sent request and validated result in the decision receipt. This first integration covers explicit shadow supervision; automatic routing and evidence selection are separate consumers. Jev failure returns an unavailable result; deterministic admission remains authoritative. The generation response alone does not prove that Jev was invoked.

Profile composition and schema validation can run without credentials. Live verification needs both routes: Fidoo Chat Completions must return an assistant response through `fidoo/deepseek-v4-flash`, and a System3 shadow decision must return the configured Jev model with a replayable receipt. The integration design in `jev-9b-integration-design.md` records the decision protocol and privacy obligations.

Add the [explicit probe](system3-live-probe.patch.yml) to exercise generation and one System3 shadow decision in the same dsh launch:

```sh
python3 docs/feat-system3-foundation/run-system3.py --patch docs/feat-system3-foundation/system3-live-probe.patch.yml -- "Reply with exactly the word READY."
```

The verified source launch returned `READY` from the main LLM and a Jev receipt with `outcome: ok`, model `APUS-OpenJev-v1-9B-5949`, advice `continue`, deterministic baseline `continue`, and `replayable: true`; it exited 0 and cleaned up the SSH tunnel. Separate same-host gateway probes returned HTTP 200 for Choice, Score, and Noul with model and usage fields. These observations establish connectivity and receipt reconstruction; they do not measure Jev decision quality.

<a id="limitations"></a>
## Limitations

- The example is a source-checkout overlay; it is not an installed plugin bundle or a default profile.
- The profile mounts the Jev capability and System3 consumer API, but it adds no automatic decision timing to the AgentLoop.
- A remote tunnel requires controlled admission even when its client endpoint is loopback.
- A `local-only` Jev policy does not enforce process egress or make Fidoo generation local.

<a id="dev-note"></a>
### Dev Note

The current checkout passed `--dump-config` and `--dump-config-schema` through the source `dsh` launcher in an isolated temporary home. The composed 96-row tunnel profile validated against the dumped JSON Schema with Ajv. Reusing `--from-default-profile` failed as documented. Live task verification is recorded in the worktree handoff rather than inferred from configuration inspection.
