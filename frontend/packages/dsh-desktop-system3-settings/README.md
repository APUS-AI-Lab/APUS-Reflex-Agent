# Desktop System3 settings

English | [中文](README.zh.md)

This desktop plugin adds **Settings → System3**. It starts disabled, stores non-secret configuration through the Harness settings service, and writes API keys through the existing credentials service. Configure generation providers in **Settings → Models** first, then reference their Provider ID and Model ID in routing candidates.

Enabling requires an HTTP(S) Jev endpoint, a decision model, at least one uniquely named candidate, selected data classes and explicit approval to send that data to Jev, candidate providers and the conversation’s current model provider. Candidate IDs cannot use the reserved `baseline` route name. A blank credential reference supports an unauthenticated service. Endpoints with user information, query parameters or fragments are rejected. No production endpoint or shared credential is supplied.

Configuration is persisted in the profile overlay as one `settings` object; `volatile` marks live updates without restarting the settings owner. Live updates serialize child-service replacement; disabling or unloading disposes the Jev and System3 fibers. The page uses the native configuration revision to reject stale writes. A replacement key requires a new dedicated credential reference; the page never overwrites an already configured reference used by a running service. Credential writes precede configuration writes; a later configuration conflict may leave the key saved, which the page reports. A failed save retains the draft; the reload action explicitly discards it and loads the latest saved configuration. The page reports disabled, starting, ready or failed local service activation and provides a status refresh action. Ready does not verify network connectivity: start a new conversation and verify the recorded System3 routing result with a small task.

The parent runtime must provide `@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin` and `@deepseek-ai/dsh-experimental-system3`. These peers are optional only for installation from the public npm registry; enabling requires both. The shipped desktop patch also loads the existing System3 event cards.
