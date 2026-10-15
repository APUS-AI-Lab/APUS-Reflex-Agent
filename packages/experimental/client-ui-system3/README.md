---
description: "Opt-in System3 execution feedback for native Web and Desktop conversations."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-system3

English | [中文](README.zh.md)

## Summary

This optional Client plugin shows what System3 did with each input. A compact Conversation dock lists submission feedback, System3 advice, the adopted and actually responding models, Skill injection, the routing mode, delegation stages, and a delegated run's progress as separate facts. Each Turn header names who handles that Turn's input and whether the decision ran on this device or in the cloud. Web and Desktop load the plugin through the product profile.

## Table of Contents

- [Configuration](#configuration)
- [Reflex configuration](#reflex-configuration)
- [Behavior](#behavior)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Model Experience](#model-experience)
- [Dev Note](#dev-note)

## Configuration

Load this Host discovery entry alongside System3 and the native Conversation Client plugins. The package has no deployment settings. The product profile owns Jev, generation routes and data permissions. Labels belong to the typed English and Chinese dictionaries.

## Behavior

The product title is APUS Reflex Harness; the `system3` plugin and locale identifiers remain stable.

The route line in the native Turn header (`conversation.chat.turnHead`) also names where the recorded entry decision ran: This device, whose tooltip states that the decision content was not sent to a decision service, or Cloud; the execution details repeat it as Decided on. A Turn header that shows a Reflex judgment shows that judgment instead of the route line.

Earlier Turns keep their own route line from the projection's `history`. While the running Turn has handed its work to a subagent, an entry in the composer's `conversation.input.right` seat names the delegate beside the model selector, which keeps showing the coordinating model. The dock observes native Session and projection subscriptions. Local submission appears before routing completes. Execution state follows the live Session, independently of historical entry advice; detailed decisions remain available after history replay. Ending a turn does not claim artifact verification. Unconfirmed supervision delivery says the acknowledgement is missing and guidance was not resent; it does not claim Reflex made no decision. The fixed-model action calls the native reset API and waits for the persisted mode to change; failed mutations preserve the displayed mode. Addressed subagents cannot mutate root model selection. While a delegated run accepts mid-run input, the dock offers a steer form that sends the person's text through the native `subagents.steerByParent` Remote; a refused send keeps the text and shows a notice, and accepted texts appear under the run once the Host records them.

The current Turn header and the visible dock status show the recorded Reflex input category or selected Skill and preparation duration before the main answer. Judgment, Skill loading and task completion remain distinct; timeouts and unavailable decisions show a fallback instead of a fabricated result. A new local submission hides the previous judgment; Turn headers only display a judgment for their own Turn.

## Reflex configuration

This experimental client mounts its own typed Reflex Remote; the shared API Remotes package does not depend on the experimental provider. Disposal withdraws the UI before the Remote.

The page opens with an **Enable Reflex decisions** switch that writes the `jev` entry's `enabled` field at once, independently of the staged connection form; while it is off every request runs the native path without contacting the decision service, and a refused write is reported on the page. The shared Web/Electron client registers **Settings → Reflex configuration** and hosts the root-scoped `settings.reflex.item` list for independently mounted controls, including the Continuum memory switch when its companion and Host namespace are available. Its connection selector offers **APUS Reflex limited-time free endpoint**, **Custom parameters**, and **This Mac**; the first two are presented as Reflex. This Mac renders the root-scoped `settings.reflex.local` seat, filled by the local decision engine plugin, or a pointer to Plugins when nothing is registered; that plugin's own action sets `jev.defaultProviderId`, and leaving the mode stages that field cleared for the page's ordinary save. The preset stages its public endpoint and model with the dedicated `APUS_REFLEX_TRIAL_API_KEY` reference; it hides connection and credential fields. The Host must provision that credential separately; the client contains no shared key and does not enforce trial expiry or quotas. Custom mode exposes the endpoint, model, effort, deadline and credential reference. Settings save through ConfigForms/Credentials and unsaved tests use the authenticated `reflex` Remote namespace. Credential literals are never read back or written to browser storage; deployment-owned environment credentials remain read-only.

Mode changes invalidate pending probes and clear unsaved key text. The page retains the custom connection draft while its controller remains loaded, excludes the trial credential reference from custom settings and never clears the trial credential. Saving persists only the active connection; reopening infers local mode from a saved `defaultProviderId`, otherwise preset mode from its endpoint, model and credential reference. Discard restores the saved connection. Existing custom connections remain selected on opening; unconfigured connections start with a preset draft that requires saving.

Before saving a new API key, the page checks its credential reference. An already configured reference is rejected without changing configuration or credentials; key rotation requires a new dedicated reference.

A passing draft test does not change saved configuration status; a successful save refreshes it. A failed runtime-status query is reported separately and does not turn a successful save into a save failure.

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
