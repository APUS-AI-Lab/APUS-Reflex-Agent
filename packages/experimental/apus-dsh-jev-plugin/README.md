---
description: "Experimental provider-neutral Jev decision service with a typed System One HTTP provider."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-apus-dsh-jev-plugin

English | [中文](README.zh.md)

## Summary

Ask a Jev model to choose from supplied candidates, score ordered criteria, or estimate a proposition's probability. An explicit profile can send these typed questions to a System One HTTP gateway and receive validated answers or an unavailable result. The caller decides which data leaves the host and which result affects its policy. `apus` is a name; the questions do not require a particular deployment or model vendor.

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

Mount this plugin when a host needs typed Jev decisions; it is absent from default profiles. Keep the Jev key in the harness credential plane or launch environment referenced by `apiKeyEnv`.

### Configure the gateway

```yaml
- id: jev
  name: '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
  config:
    endpoint: http://127.0.0.1:30135
    model: APUS-OpenJev-v1-9B-5949
    effort: low
    timeoutMs: 30000
    apiKeyEnv: APUS_JEV_API_KEY
```

| Field | Default | Meaning |
|---|---|---|
| `endpoint` | required | HTTP gateway root or `/v1` URL |
| `model` | required | Model id sent to the gateway |
| `effort` | `low` | System One inference effort: `low` or `high` |
| `timeoutMs` | `30000` | Request deadline in milliseconds |
| `apiKeyEnv` | absent | Credential reference resolved for each request |
| `keepAliveMs` | absent | Idle time a dedicated direct connection stays open for reuse; omission uses the process-wide transport. Requests routed through a configured HTTP proxy always use the proxy's transport |
| `http2` | `false` | Negotiate HTTP/2 on the dedicated connection; requires `keepAliveMs` |
| `providerId` | `system-one` | Built-in provider registry id |

The endpoint may be a local SSH tunnel or a controlled service URL. The provider appends `/v1/systemone` when the configured URL does not already end in `/v1`; it sends a Bearer credential only when `apiKeyEnv` resolves to a value.

### Ask a typed question

The consumer supplies the state and complete candidate set. This example assumes a mounted Jev service.

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'

declare const ctx: Context

const outcome = await ctx.jev.decide({
  state: { scene: 'route-admission', fact: 'local-first' },
  questions: {
    route: {
      type: 'choice',
      instructions: 'Choose one supplied candidate.',
      criteria: { keep_local: 'Keep local execution', escalate: 'Escalate to remote' },
    },
  },
})
```

`kind: 'unknown'` is fail-open for transport, timeout, HTTP, credential, and response validation failures. The caller keeps deterministic System3 policy as the authority and may record the returned failure without exposing request or response text.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`ctx.jev` is the service definition and registry. `SystemOneProvider` is the first provider implementation and validates the complete response against the exact request question set, including candidate keys, probability totals, confidence, score expectations, and usage counters. A provider is resolved before network I/O and its effective model is pinned in the returned `JevSpec`.

The package does not own an AgentLoop, select an LLM generation route, edit prompts, authorize tools, or persist Session receipts. A System3 consumer must decide when to call Jev, apply privacy policy, and persist a replayable receipt. This keeps the Jev request visible and makes the provider replaceable.

The transport uses `@typesafe-ai/sdk` 0.6.0 with automatic retries and SDK logging disabled. `protocol: openjev` sends the configured effort; `protocol: typesafe` omits that extension. Endpoints may name the API root or its `/v1` prefix. The timeout includes credential resolution and response delivery; cancellation prevents late network dispatch. State accepts text, objects, arrays and null.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Provider registry and fail-open decision service |
| [`src/client.ts`](src/client.ts) | Credential resolution and System One HTTP transport |
| [`src/protocol.ts`](src/protocol.ts) | Wire request and response validation |
| — | No runtime invariant companion is published: the registry is the only provider observation, and each HTTP operation owns its response validation. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the consumer and deployment responsibilities.

- [System3](../system3/README.md) — deterministic policy and Session decision receipts.
- [LLM adapter](../../llm/llm-pi-ai/README.md) — generation requests through OpenAI-compatible gateways.
- [Fidoo and RunPod profile](../../../docs/feat-system3-foundation/model-chain.md) — explicit source-checkout overlays and credential references.

-----

<a id="model-experience"></a>
## Model Experience

### Typed decision sidecar

#### What the model sees

Nothing is added to the main LLM prompt automatically. Jev receives only the JSON `state` and questions supplied by the consumer.

#### Token effect

Jev uses its own provider request and does not change the main LLM request token budget. Consumers should send bounded state or evidence references instead of raw sensitive text.

#### KV Cache effect

None in the main generation route. The Jev gateway may have its own cache behavior.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the package's current scope.

- The package has no automatic AgentLoop hook or Session event; its consumer owns invocation timing, privacy admission, and durable receipts.
- The built-in provider currently targets `/v1/systemone`; it is not an OpenAI-compatible `llm-pi-ai` route.
- RunPod gateway port `30135` is intended for a same-host process or controlled tunnel. Do not publish it directly.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
