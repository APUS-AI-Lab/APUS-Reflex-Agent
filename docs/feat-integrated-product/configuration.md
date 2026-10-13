# Configure models and run a first task

English | [中文](configuration.zh.md)

The desktop starts in ordinary model mode. Configure a provider you can access, choose a workspace, and verify one response before running a larger task. You do not need Jev credentials for this mode. Generation models handle conversation, reasoning and tool calls; Reflex/Jev services answer structured decisions. Configure their endpoints, model IDs and credentials separately; a chat-completions endpoint is not a decision service.

## Configure a provider

1. Open **Settings → Models**. Add a listed provider or a custom provider appropriate for your service.
2. Enter an API key if your service requires one, then select a model. A custom provider requires a unique Provider ID, API protocol, Base URL and at least one exact model ID; display name is optional. Start the Provider ID with a lowercase letter and use lowercase letters, digits and dashes. Match the generation service's protocol, such as OpenAI Chat Completions, OpenAI Responses or Anthropic Messages. Use its documented API base address, not a website or Reflex decision endpoint; anonymous services need no invented key.
3. Save, then explicitly select the configured provider and model in a new conversation. Adding a provider does not change the current selection or global default; check the provider and model ID in the picker before sending.

Use credentials from your own provider account. APUS does not supply a model subscription or shared API key. Saving configuration or fetching a model list does not verify inference; the first response below checks actual model access.

The official DeepSeek adapter uses the Messages protocol and defaults to `https://api.deepseek.com/anthropic`. For an OpenAI-compatible service, add a custom provider and select **OpenAI Chat Completions** or **OpenAI Responses**, matching the service, then enter its Base URL and model ID. Changing only the official DeepSeek card’s Base URL does not change its protocol.

Built-in providers return model lists from the installed catalog; this does not validate the current key, remote model availability or generation requests. Even successful remote model discovery for a custom provider still requires a real conversation test.

## Verify a task

Choose a disposable folder as your workspace, then start a new conversation and ask the selected model to reply with a short sentence. Confirm that the response appears without an authentication or connection error. Next, ask it to create a small text file in that folder and inspect the result. Approve tool operations only after reviewing the requested access.

Quit and reopen the application. Confirm the model configuration remains available and the conversation can be opened. Test tasks can incur provider charges. Workspace access and remote model inference are separate: model requests may send task and file content to the configured service.

## Recover from a configuration error

| Symptom | Check |
| --- | --- |
| Authentication failure | Correct provider, active API key, account permissions, and quota |
| Unknown model | Exact model ID and whether your account can use it |
| Connection or timeout failure | Base URL, provider availability, proxy, and network access |
| No model selected | Select the saved provider and model for the conversation |

Keep the original error for diagnosis, but redact keys before sharing it. Credentials use the existing local credentials store under `$DSH_HOME/.credentials.yaml`; keep this directory private and do not commit or attach it to an issue.

## Optional Reflex decision service

Open **Settings → Reflex model configuration** to connect your own Reflex/Jev decision service. Ordinary model tasks do not require this service; generation models remain configured under **Settings → Models**. On first use, the page may report an unconfigured decision service; endpoint and model fields remain editable, and testing the draft does not save it.

| Field | What to enter |
| --- | --- |
| Service endpoint and decision model | The decision service API root or `/v1` base address and actual model ID; do not enter a complete `/v1/systemone` or chat-completions path, credentials, user information, query parameters or fragments |
| Decision protocol | Choose OpenJev or Typesafe to match the service implementation; this differs from the generation API protocol on the Models page |
| Decision effort | OpenJev uses `high` or `low`; Typesafe requests omit this extension |
| Request timeout (ms) | Maximum wait for connection tests and decision requests |
| Credential reference and API key | A dedicated reference such as `REFLEX_API_KEY` and your service key; anonymous services need no key |

For first use, supply the endpoint and model and confirm the protocol; keep the current timeout and applicable effort defaults unless your service requires otherwise. Use the endpoint and protocol confirmed by your service provider.

Leave API key blank to retain the stored key. A new or replacement key requires a new dedicated reference; configured references cannot be overwritten. Deployment environment credentials are read-only. The Host credential service stores keys separately from ordinary settings and source code.

Click **Test connection and real decision**. The test uses the current draft’s selected protocol without saving it; test again after changing fields. OpenJev probes check `/health`, the model list and a fixed decision; Typesafe skips `/health` and checks the model list and fixed decision. The page reports authentication failures, timeouts, missing models or the real decision result separately. “Real decision passed” validates this decision-service test only; it does not verify that routing, supervision, memory or task execution is enabled or accepted.

Review the result, then click **Save**. Saved settings apply to new requests; running requests retain their configuration. If the page reports a failed or partial save, reopen it and check settings and credential status before retrying.

## Check which capabilities are enabled

The Reflex page reports capability status separately for user entry routing, Codex long-running Goal correction, and dynamic context and recoverable memory. Click **Refresh capability status** to read the current runtime status, distinguishing modules not loaded, disabled capabilities, enabled capabilities and execution verification records.

A successful connection or saved endpoint does not automatically enable these capabilities. Advanced routing candidates, data classification and remote authorization require separate profile configuration. Continuum also needs memory admission and scope settings. See the [public provider guide](../dev-continuum-reflex-integration/public-provider-configuration.md), [System3 configuration reference](../../packages/experimental/system3/README.md) and [Continuum guide](../../packages/context/continuum/README.md). These settings can permit task content to reach decision services and generation models; review endpoints and authorization before enabling them.

After enabling a capability, use a small task to inspect its runtime records and actual result. Displayed advice does not establish adoption; an enabled capability does not establish task acceptance. Model-as-a-Harness describes the product direction; individual capabilities depend on configuration and execution evidence.
