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

Open **Settings → Reflex configuration**. Choose **APUS Reflex limited-time free endpoint** for the preset service, or **Custom parameters** for your own service. Both use the Reflex protocol. The preset hides the endpoint, model and key fields; it requires deployment-provided credentials, and installers do not contain a shared API key. If the preset is unavailable, use a custom service. Generation models remain configured under **Settings → Models**.

| Custom field | What to enter |
| --- | --- |
| Service endpoint and decision model | The decision API root or `/v1` base address and actual model ID; omit the complete `/v1/systemone` path, credentials, query parameters and fragments |
| Decision effort | `high` or `low` |
| Request timeout (ms) | Maximum wait for service requests and connection tests; input preparation also has a separate total budget |
| Credential reference and API key | A dedicated reference such as `REFLEX_CUSTOM_API_KEY` and your service key; anonymous services need no key |

Leave API key blank to retain the stored key. A replacement key requires a new dedicated reference; deployment credentials are read-only. Keys remain in the Host credential store, separate from ordinary settings and source code. Switching to custom parameters does not copy preset credentials.

Click **Test connection and real decision**, then **Save**. Testing checks health, model availability and a fixed decision using the current draft; it does not save settings. Test again after editing. Saved settings apply to new requests; running requests retain their configuration. A successful probe does not establish task completion or recall quality.

## Check which capabilities are enabled

The product profile loads input judgment and Skill selection. With a configured service, Reflex records its actual decision before the main model continues; missing configuration or failed preparation leaves ordinary model execution available. Advanced entry routing, Goal correction and Session context recovery require their own configuration. **Refresh capability status** reads module and configuration status; conversation records show what actually ran.

The **Continuum memory** switch is also on the Reflex page and is off by default. It controls Continuum independently of System3 Session context recovery. Enabling either feature is not evidence of complete recall or task acceptance. See the [public provider guide](../dev-continuum-reflex-integration/public-provider-configuration.md), [System3 reference](../../packages/experimental/system3/README.md) and [Continuum guide](../../packages/context/continuum/README.md) for scope and remote-data settings.
