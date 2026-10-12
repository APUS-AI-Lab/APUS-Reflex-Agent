---
description: "Current Jev provider, explicit System3 shadow supervision, durable receipts, and the verified Fidoo/RunPod chain."
---

# Jev integration and model chain

English | [中文](jev-9b-integration-design.zh.md)

## Summary

System3 executes explicit Jev shadow supervision and persists its complete structured input, validated answer, and deterministic baseline in the owning Session. The main LLM generates through Fidoo; Jev uses the independent System One gateway on RunPod. `apus` is a name, and compatible providers can replace the built-in provider. This integration changes no automatic AgentLoop routing, evidence selection, permissions, or completion authority.

## Table of Contents

- [Architecture](#architecture)
- [Requests and receipts](#requests-and-receipts)
- [Deployment](#deployment)
- [Verification and limits](#verification-and-limits)
- [Dev Note](#dev-note)

-----

<a id="architecture"></a>
## Architecture

The [Jev plugin](../../packages/experimental/apus-dsh-jev-plugin/README.md) defines `ctx.jev` and typed Choice, Score, and Noul questions. Its System One provider validates requests and responses, resolves a credential reference, and calls `/v1/systemone`. The [System3 consumer](../../packages/experimental/system3/README.md) constructs fixed supervision candidates, admits the declared route, and appends a Session receipt. The main generation adapter uses `llm-pi-ai` with OpenAI Chat Completions; the decision gateway is a separate protocol.

```mermaid
flowchart LR
  A[Explicit System3 consumer] --> B[Deterministic baseline and privacy admission]
  B --> C[Structured facts and fixed Choice]
  C --> D[ctx.jev / System One provider]
  D --> E[Controlled SSH tunnel]
  E --> F[RunPod gateway :30135]
  F --> G[high32 vLLM :30132]
  F --> H[low16 vLLM :30134]
  D --> I[Session system3/decision receipt]
  B --> I
  J[DSH main LLM] --> K[Fidoo deepseek-v4-flash]
```

<a id="requests-and-receipts"></a>
## Requests and receipts

Generic `ctx.jev` accepts host-supplied state and typed questions; its caller owns privacy admission and logging. System3 accepts only `supervisor`, `dataClasses`, and optional `turn`/`step`. It builds state from goal revisions, evidence references, check results, and remaining budget. Its fixed Choice candidates are `continue`, `retry`, `escalate`, `candidate_done`, and `unknown`. Hosts must supply opaque identifiers and structured facts rather than business text or credentials.

`shadowDecision(session, request, signal)` preserves the deterministic supervisor result. A `system3/decision` receipt retains the complete structured Jev request, digest, evidence references, route/execution domain, selected provider/model, effort, answer or safe failure code, elapsed time, baseline, and comparison. `lastDecision(session)` reads the latest receipt through a replayable projection. The full model input is recorded; a digest does not replace it.

Privacy denial and provider unavailability record an unknown outcome without sending a request. Transport, timeout, credential, HTTP, and response-validation failures preserve deterministic authority. Caller cancellation records a cancelled receipt before rejecting. Jev advice cannot authorize tools, increase budgets, or declare completion.

<a id="deployment"></a>
## Deployment

The [profile guide](model-chain.md) and tracked overlays own executable configuration. The Jev plugin uses `endpoint`, `model`, `effort`, `timeoutMs`, and `apiKeyEnv`. System3 uses `privacyMode`, `approvedRemoteIds`, `approvedRemoteDataClasses`, `observeAgentLoop`, `jevRouteId`, `jevExecutionDomain`, and `jevEffort`.

The public deployment uses user-configured generation and optional Jev providers. Set each endpoint, model and credential reference explicitly in the [deployment configuration](../dev-continuum-reflex-integration/public-provider-configuration.md); internal service addresses and credential-file locations are not distributed.

The former maintainer-only SSH launcher is privately archived. Supply credentials through the process environment or a user-owned profile; do not copy a maintainer’s credential-file layout. A remote Jev service reached through a loopback tunnel still requires network data approval. The [same-host override](system3-fidoo-runpod-local.patch.yml) is appropriate only for a genuinely local execution domain.

<a id="verification-and-limits"></a>
## Verification and limits

The source dsh profile passed composition and schema validation. A live source launch returned main-model text `READY` plus a successful Jev receipt: model `APUS-OpenJev-v1-9B-5949`, advice `continue`, baseline `continue`, and replayable input. It exited 0 and cleaned up its SSH tunnel. Separate same-Pod API probes returned HTTP 200 with model and usage fields for Choice, Score, and Noul.

The current Pod has no Node runtime, so no built dsh application smoke ran there. Same-Pod Python API probes and local source dsh smoke establish different facts. The first consumer covers explicit shadow supervision; automatic routing, evidence selection, expert delegation, and training require separate consumers and verification. The host declares data classes and execution location; these checks do not enforce OS isolation or process egress. Connectivity and receipt reconstruction do not establish decision quality, probability calibration, or cost savings.

<a id="dev-note"></a>
### Dev Note

Use the tracked explicit probe overlay to reproduce the source chain. The worktree handoff owns command results and branch state; package READMEs own service behavior.
