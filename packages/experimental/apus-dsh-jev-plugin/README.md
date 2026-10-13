---
description: "Profile bundle adding the configurable Reflex decision service and typed System One provider."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-apus-dsh-jev-plugin

English | [中文](README.zh.md)

## Summary

This opt-in profile bundle adds the Reflex decision service. Its `jev` row supplies deployment defaults below user profile patches, so saved model settings apply to new requests. The System3 deployment prepares this bundle in its web profile; standard profiles do not include it. Consumers submit typed questions and retain authority over data sharing and action selection.

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

### Add the profile layer

The shipped System3 service runs [prepare-profile.mjs](../../../deploy/system3/prepare-profile.mjs) before launching its web profile. Preparation adds this bundle once and preserves existing user patches. [cordis.patch.yml](cordis.patch.yml) supplies the `jev` row; profile edits override these defaults without changing the bundle. Keep the key in the Harness credential store or the launch environment referenced by `apiKeyEnv`.

### Configure the gateway

Set `JEV_ENDPOINT` and `JEV_MODEL` to your serving endpoint and model. Values are trimmed; when both effective profile fields are absent or blank, the service remains available for settings and explicit connection probes without a configured provider or automatic network requests. A partial configuration or invalid endpoint fails startup. The bundle uses `high` effort and a 15-second timeout. Existing config-only profile overrides remain enabled without environment variables; an explicit `disabled: true` takes precedence. A profile patch can explicitly enable the row and override these values as below.

`JEV_API_KEY_ENV` explicitly names a credential reference; otherwise a nonempty `JEV_API_KEY` binds that reference. With neither, the endpoint is anonymous. A declared but missing credential fails the decision before HTTP dispatch; do not supply a fake key. Environment expressions are evaluated at startup.

```yaml
- id: jev
  disabled: false
  config:
    endpoint: http://127.0.0.1:30135
    model: APUS-OpenJev-v1-9B-5949
    effort: low
    timeoutMs: 30000
    apiKeyEnv: APUS_JEV_API_KEY
```

| Field | Default | Meaning |
|---|---|---|
| `endpoint` | empty | HTTP gateway root or `/v1` URL; required with `model` before decisions |
| `model` | empty | Model id sent to the gateway; required with `endpoint` before decisions |
| `protocol` | `openjev` | Decision protocol: OpenJev (`openjev`) or Typesafe (`typesafe`) |
| `effort` | `low` | OpenJev inference effort: `low` or `high`; Typesafe omits this extension |
| `timeoutMs` | `30000` | Request deadline in milliseconds |
| `apiKeyEnv` | absent | Credential reference resolved for each request |
| `keepAliveMs` | absent | Idle time a dedicated direct connection stays open for reuse; omission uses the process-wide transport. Requests routed through a configured HTTP proxy always use the proxy's transport |
| `http2` | `false` | Negotiate HTTP/2 on the dedicated connection; requires `keepAliveMs` |
| `resetAfterFailures` | absent | Consecutive requests without a response after which the dedicated pool is destroyed and the next request opens a fresh connection; on HTTP/2 every request shares one connection, so a stalled one otherwise fails every later decision. Requires `keepAliveMs`; omission never reopens the pool |
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

Resolving or executing a request with an unconfigured default provider throws a configuration error before credential resolution or HTTP; an explicit request model does not bypass this requirement. `warm` returns false in this state. `kind: 'unknown'` is fail-open for transport, timeout, HTTP, credential, and response validation failures. The caller keeps deterministic System3 policy as the authority and may record the returned failure without exposing request or response text.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`ctx.jev` is the service definition and registry. `SystemOneProvider` is the first provider implementation and validates the complete response against the exact request question set, including candidate keys, probability totals, confidence, score expectations, and usage counters. A provider is resolved before network I/O and its effective model is pinned in the returned `JevSpec`. Missing deployment configuration or an unregistered provider raises `JevConfigurationError`; callers must not treat that configuration failure as model uncertainty.

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
- [Provider profile](../../../docs/feat-system3-foundation/model-chain.md) — explicit source-checkout overlays and credential references.

-----

## Reflex model configuration

The package also supplies a standard profile bundle with editable Reflex defaults. APUS deployment prepares that bundle below the user profile; command-line overlays must not repeat the `jev` row, because such overrides intentionally prevent persisted edits.

The form schema contains only serializable data. The service validates endpoints on initial load and in its own `internal/config` update hook; invalid endpoints are rejected before the profile is written.

The `jev` Loader entry exposes its endpoint, model, effort, deadline, protocol and credential reference as volatile settings. The dedicated **Reflex model configuration** page offers an OpenJev/Typesafe selector and edits this entry through ConfigForms and writes API keys through Credentials; new requests read the committed values while requests already in flight retain their resolved provider. Pool parameters remain deployment-owned.

The `reflex` Remote namespace exposes `readStatus` and `testConnection`. An OpenJev connection test checks `/health`, authenticates `/v1/models`, confirms the selected model, and submits a fixed non-user yes/no proposition to `/v1/systemone`. Typesafe skips `/health` and checks the model list before submitting the same decision without the effort extension. The test uses the draft’s selected protocol, accepts unsaved values and an optional transient key without storing them, returns only sanitized failure classes and elapsed time, and never marks task capabilities verified. Runtime owners register capability readers through `registerCapability` and own their disposers.

`ReflexCapabilityId` names the three capability owners; `ReflexCapabilityState` carries installation, enablement, observed outcomes and read-only deployment limits. `ReflexStatus` combines those states with the configured provider; its `provider` is `null` before configuration and after both fields are cleared. `ReflexConnectionInput` describes the unsaved candidate and optional transient key; `ReflexConnectionResult` reports the tested stage, sanitized status and duration.

Goal-relevance supervision has an independent `semanticSupervision.enabled` status. It is enabled only when the supervision module is installed, active, explicitly configured for semantic evidence and admitted by the current workspace-data policy. Fingerprint supervision may remain enabled when this sub-capability is disabled; neither state claims a verified outcome.

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
