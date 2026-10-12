---
description: "Generation and optional Reflex provider configuration for System3."
---

# System3 model chain

English | [中文](model-chain.zh.md)

## Current configuration

Use the [public provider configuration](../dev-continuum-reflex-integration/public-provider-configuration.md) for official generation, optional Reflex, user-owned relays, credentials, and Codex delegation. Generation and decision inference use independent providers and explicit data-sharing policies. A generation response alone does not prove that Reflex was invoked.

## Historical source examples

The `system3-fidoo-runpod-*.patch.yml` files preserve early source-checkout examples and legacy provider IDs. They are not public defaults. Their relay requires an explicit `SYSTEM3_GENERATION_BASE_URL`, user-managed credentials, and registered model IDs. The tunnel example assumes a controlled loopback forward; remote forwarding remains network execution even when the client URL is localhost. The same-host override applies only when Jev actually executes on the Harness host. Neither setting confines generation-provider egress.

The historical operator-specific SSH credential launcher is not distributed. Current profile preparation requires no SSH or remote credential scraping; supply your own serving endpoints and credential references.

## Acceptance

The [System3 service](../../packages/experimental/system3/README.md) records typed decisions with the sent request and validated outcome. Verify generation output, an admitted decision receipt, replay, and denied-data behavior separately. Historical connectivity observations are not evidence that a new deployment or decision-quality benchmark has passed. Run the applicable local configuration tests and explicitly configured real-provider tests for each deployment.
