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

## System3 collaboration

Open **Settings → System3** to configure optional Jev routing. It is off by default; ordinary model tasks do not require it. First configure each reasoning provider and model in **Models**, then complete these fields:

| Field | What to enter |
| --- | --- |
| Jev endpoint, protocol, model ID | Your decision service address, its `openjev` or `typesafe` protocol, and the decision model ID |
| Credential reference and API Key | A dedicated reference such as `APUS_JEV_API_KEY` and your service key; leave the reference empty only for a service without authentication |
| Routing candidates | Add a candidate and fill Candidate ID, Provider ID, Model ID, and when to choose it; use providers and models already configured in Models |
| Data classes and remote approval | Explicitly select permitted `public`, `workspace`, `sensitive`, or `secret` input classes and approve remote transmission |
| Timeout, minimum confidence, input limit | Bounds for decision requests; adjust only for your service requirements |

Use a direct API endpoint without user information, query parameters, or fragments. Add 1–254 candidates with unique lowercase IDs; `baseline`, `jev`, `abstain`, and `unknown` are reserved. Every route is treated as a network route, even if the address uses loopback, so select data permissions deliberately. Approval covers Jev, candidate model providers, and the conversation's current model provider.

Select **Enable collaboration** and **Save configuration**. The settings form validates required fields and credential availability before enabling. It stores the key through the existing credential service, separately from ordinary settings. A new or replacement key requires a new dedicated credential reference: this page refuses to overwrite an already configured reference. Leave the key field empty to retain its current value. A successful key save followed by a failed settings save leaves the new key in the credential store and retains the settings draft for correction. If another client changed the settings, explicitly discard the draft and reload the saved configuration before retrying.

Changes apply without restarting Electron. The page reports whether local collaboration services are off, starting, ready, or failed; use **Refresh status** to check again. “Ready” means the local plugins have mounted, not that a remote model has responded. If activation fails, correct the configuration or disable collaboration and save.

Saving does not contact Jev or the reasoning model and does not prove connectivity. Start a new conversation, send a small task, and inspect the System3 routing record and actual model response. A displayed recommendation does not by itself prove that it was adopted. For deployment details and capability limits, see the [System3 configuration reference](../../packages/experimental/system3/README.md).

To return to ordinary mode, clear **Enable collaboration** and save. Do not treat Model-as-a-Harness branding as evidence that every collaboration capability is active.
