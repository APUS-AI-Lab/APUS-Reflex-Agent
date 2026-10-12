# Configure models and run a first task

English | [中文](configuration.zh.md)

The desktop starts in ordinary model mode. Configure a provider you can access, choose a workspace, and verify one response before running a larger task. You do not need Jev credentials for this mode.

## Configure a provider

1. Open **Settings → Models**. Add a listed provider or a custom provider appropriate for your service.
2. Enter the provider's API key and select a model. A custom provider also needs a Provider ID, display name, API protocol, Base URL, and exact model ID. Use the service's API address, not its website URL.
3. Save the configuration. Select the configured model when starting a conversation.

Use credentials from your own provider account. APUS does not supply a model subscription or shared API key. A saved configuration does not prove the credentials work; the first response below checks actual model access.

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

Open **Settings → Reflex model configuration** to connect your own Reflex/Jev decision service. Ordinary model tasks do not require this service; generation models remain configured under **Settings → Models**.

| Field | What to enter |
| --- | --- |
| Service endpoint and decision model | A direct API address and the actual decision model ID; do not include credentials, user information, query parameters or fragments in the address |
| Decision effort | `high` or `low`, as supported by your service |
| Request timeout (ms) | Maximum wait for connection tests and decision requests |
| Credential reference and API key | A dedicated reference such as `REFLEX_API_KEY` and your service key; anonymous services need no key |

Leave API key blank to retain the stored key. A new or replacement key requires a new dedicated reference; configured references cannot be overwritten. Deployment environment credentials are read-only. The Host credential service stores keys separately from ordinary settings and source code.

Click **Test connection and real decision**. The test uses the current draft without saving it; test again after changing fields. The page reports authentication failures, timeouts, missing models or the real decision result separately. “Real decision passed” validates this decision-service test only; it does not verify that routing, supervision, memory or task execution is enabled or accepted.

Review the result, then click **Save**. Saved settings apply to new requests; running requests retain their configuration. If the page reports a failed or partial save, reopen it and check settings and credential status before retrying.

## Check which capabilities are enabled

The Reflex page reports capability status separately for user entry routing, Codex long-running Goal correction, and dynamic context and recoverable memory. Click **Refresh capability status** to read the current runtime status, distinguishing modules not loaded, disabled capabilities, enabled capabilities and execution verification records.

A successful connection or saved endpoint does not automatically enable these capabilities. Advanced routing candidates, data classification and remote authorization require separate profile configuration. Continuum also needs memory admission and scope settings. See the [public provider guide](../dev-continuum-reflex-integration/public-provider-configuration.md), [System3 configuration reference](../../packages/experimental/system3/README.md) and [Continuum guide](../../packages/context/continuum/README.md). These settings can permit task content to reach decision services and generation models; review endpoints and authorization before enabling them.

After enabling a capability, use a small task to inspect its runtime records and actual result. Displayed advice does not establish adoption; an enabled capability does not establish task acceptance. Model-as-a-Harness describes the product direction; individual capabilities depend on configuration and execution evidence.
