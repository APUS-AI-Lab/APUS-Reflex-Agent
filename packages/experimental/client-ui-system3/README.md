---
description: "Opt-in System3 execution feedback for native Web and Desktop conversations."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-system3

English | [中文](README.zh.md)

## Summary

This optional Client plugin adds a compact native Conversation dock. It displays local submission feedback and persisted System3 advice, Host adoption, actual model responses and Skill injection as separate facts. It also contributes a route line to the native Turn header (`conversation.chat.turnHead`) that names who handles the input, a continued route, or the fallback model, as soon as the entry decision for that Turn is recorded,; the dock keeps the routing mode, delegation stages, and the delegated run's progress, including its starting and result-checking phases. Both Web and Desktop load this plugin through the product profile.

## Table of Contents

- [Configuration](#configuration)
- [Reflex model configuration](#reflex-model-configuration)
- [Behavior](#behavior)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Model Experience](#model-experience)
- [Dev Note](#dev-note)

## Configuration

Load this Host discovery entry alongside System3 and the native Conversation Client plugins. The package has no deployment settings. The product profile owns Jev, generation routes and data permissions. Labels belong to the typed English and Chinese dictionaries.

## Behavior

The product title is APUS Reflex Harness; the `system3` plugin and locale identifiers remain stable.

Earlier Turns keep their own route line from the projection's `history`. While the running Turn has handed its work to a subagent, an entry in the composer's `conversation.input.right` seat names the delegate beside the model selector, which keeps showing the coordinating model. The dock observes native Session and projection subscriptions. Local submission appears before routing completes. Execution state follows the live Session, independently of historical entry advice; detailed decisions remain available after history replay. Ending a turn does not claim artifact verification. Unconfirmed supervision delivery says the acknowledgement is missing and guidance was not resent; it does not claim Reflex made no decision. The fixed-model action calls the native reset API and waits for the persisted mode to change; failed mutations preserve the displayed mode. Addressed subagents cannot mutate root model selection. While a delegated run accepts mid-run input, the dock offers a steer form that sends the person's text through the native `subagents.steerByParent` Remote; a refused send keeps the text and shows a notice, and accepted texts appear under the run once the Host records them.

## Reflex model configuration

This experimental client mounts its own typed Reflex Remote; the shared API Remotes package does not depend on the experimental provider. Disposal withdraws the UI before the Remote.

The shared Web/Electron client registers **Settings → Reflex model configuration** as a dedicated top-level section. It stages the endpoint, model, OpenJev/Typesafe protocol, effort, deadline and credential reference, saves through ConfigForms/Credentials, and tests an unsaved candidate with its selected protocol through the authenticated `reflex` Remote namespace. The protocol persists as `openjev` or `typesafe`; changing it invalidates old probe results. Typesafe neither sends the effort extension nor requires `/health`. Credential literals are never read back or written to browser storage. Deployment-owned environment credentials remain read-only; a separate managed reference can hold a replacement.

Before saving a new API key, the page checks its credential reference. An already configured reference is rejected without changing configuration or credentials; key rotation requires a new dedicated reference.

On first use, endpoint and model fields remain editable while the decision service is unconfigured. A passing draft test does not change saved configuration status; a successful save refreshes it. A failed runtime-status query is reported separately and does not turn a successful save into a save failure.

Connection results and capability states are independent. Changing a draft invalidates its old probe result; an in-flight result for a previous draft is ignored. A failed credential write remains a failed save even when an older key exists. Capability labels report runtime module/activation state and do not infer verification from connectivity.

Goal-relevance supervision has an independent `semanticSupervision.enabled` status. It is enabled only when the supervision module is installed, active, explicitly configured for semantic evidence and admitted by the current workspace-data policy. Fingerprint supervision may remain enabled when this sub-capability is disabled; neither state claims a verified outcome.

If a combined connection/key save cannot confirm the credential write, the page restores its configuration edits only at their acknowledged revision. Conflicting newer edits remain intact and a partial-save notice replaces the generic failure. Drafts remain available; reopening refreshes accepted settings. Configuration and credentials are separate services, so disconnects do not provide cross-service atomicity.

<a id="model-experience"></a>

## Model Experience

None, as this browser plugin adds no model-facing input. It renders Client-safe facts supplied by System3 and invokes the existing Session controller only on a user action.

#### KV Cache effect

No direct effect; native model selection owns any later request change.

## Known Limitations and Deferred Work

- Advice is not execution. A Skill is shown as injected only after the exact instruction message is committed. The dock has no synthetic percentage, timer-driven success, private prompt bodies or provider probabilities. Earlier automatic decisions remain historical when the user fixes a model. Native tools, deliverables, errors, cancellation, goals and expert sessions retain their existing UI owners.

### Dev Note

**Runtime invariant:** No companion is published. The Host projection owns runtime facts; this package owns a disposable Conversation slot registration.
