# Deployment configuration publication review

English | [中文](deployment-publication-review.zh.md)

## Review scope

This review identified deployment dependencies beyond documentation. The current changes remove maintainer defaults from the Jev bundle and System3 routing; Frontend must pin the resulting Harness commit to package them. No raw model credential was identified in the reviewed tracked configuration; environment variable names are not credentials. Actual destination addresses, data policy and provider coupling still need review before organization transfer or public release.

## Remediation record

| Location | Finding before remediation | Resulting configuration or remaining acceptance |
| --- | --- | --- |
| [Jev bundle](../../packages/experimental/apus-dsh-jev-plugin/cordis.patch.yml) | Endpoint and deployment model are literals. The provider reads these config fields, so exporting similarly named environment variables does not replace them. | Explicit endpoint/model configuration; no settings disables Jev, partial settings fails startup. |
| [System3 deployment](../../deploy/system3/runtime.patch.yml) | Expert/frontier routes use a specific gateway and model aliases. Provider base URLs are literal values. | The default has official fast/reasoning routes and configured Codex; user profiles can add their own remote providers. |
| [Codex deployment](../../deploy/system3/codex/config.toml) | A provider URL is packaged as a literal. | A public OpenAI Responses example is installed only for a new Codex home; existing user configuration is preserved. |
| Frontend runtime preparation | The pinned Harness bundle is copied into the package; clearing a README or screenshot does not change it. | Upgrade the pin only after the replacement Harness configuration is accepted, then inspect the packaged configuration. |
| Frontend patch generator | Replaces session-data-class expressions with `workspace` and requires a named gateway credential reference. | The generator preserves privacy expressions and no longer requires a private gateway credential reference. |
| Jev credential reference | A declared but unset/empty `apiKeyEnv` causes a missing-credential error. | An explicitly named credential remains required; omitting the reference supports anonymous serving. |

Normal source `dsh web/headless` does not automatically mount the Jev bundle. The System3 service and normal desktop assembly do mount it, so these paths need separate acceptance. Public provider URLs, loopback examples and support for standard proxy environment variables are not private credentials and should not be deleted indiscriminately.

## Implementation and API scope

The changes adjust deployment composition and frontend preparation, preserving the generation/runtime APIs and Session formats. A public default must start without maintainer infrastructure. Users explicitly configure a generation provider and optional Reflex provider; private deployments supply their own profile or supported environment overrides. The user approved this implementation scope: remove deployment-specific defaults, retain explicit provider and privacy configuration, update both main branches and transfer the independent repositories.

## Acceptance plan

- Prepare a clean general-model profile without Jev/gateway credentials and verify startup, settings and a configured generation request.
- Configure a test Reflex endpoint and model, with authenticated and explicitly anonymous variants; capture the actual destination and request fields.
- Check absent, empty and malformed configuration; reject an enabled but unusable route without silently choosing another external destination.
- Verify disabled Reflex and unconfigured expert/frontier candidates, plus preserved user profiles and Safe Mode.
- Exercise privacy data classes and approved routes; demonstrate that a blocked workspace payload is not sent to the recording endpoint.
- Build the pinned Frontend runtime, inspect the packaged profile and rerun its normal/recovery entry points. Keep signing/notarization and real-provider quality as separate evidence.
