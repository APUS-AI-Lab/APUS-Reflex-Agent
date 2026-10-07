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
- [Behavior](#behavior)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Model Experience](#model-experience)
- [Dev Note](#dev-note)

## Configuration

Load this Host discovery entry alongside System3 and the native Conversation Client plugins. The package has no deployment settings. The product profile owns Jev, generation routes and data permissions. Labels belong to the typed English and Chinese dictionaries.

## Behavior

Earlier Turns keep their own route line from the projection's `history`. While the running Turn has handed its work to a subagent, an entry in the composer's `conversation.input.right` seat names the delegate beside the model selector, which keeps showing the coordinating model. The dock observes native Session and projection subscriptions. Local submission appears before routing completes. Execution state follows the live Session, independently of historical entry advice; detailed decisions remain available after history replay. Ending a turn does not claim artifact verification. The fixed-model action calls the native reset API and waits for the persisted mode to change; failed mutations preserve the displayed mode. Addressed subagents cannot mutate root model selection. While a delegated run accepts mid-run input, the dock offers a steer form that sends the person's text through the native `subagents.steerByParent` Remote; a refused send keeps the text and shows a notice, and accepted texts appear under the run once the Host records them.

## Model Experience

None, as this browser plugin adds no model-facing input. It renders Client-safe facts supplied by System3 and invokes the existing Session controller only on a user action.

#### KV Cache effect

No direct effect; native model selection owns any later request change.

## Known Limitations and Deferred Work

- Advice is not execution. A Skill is shown as injected only after the exact instruction message is committed. The dock has no synthetic percentage, timer-driven success, private prompt bodies or provider probabilities. Earlier automatic decisions remain historical when the user fixes a model. Native tools, deliverables, errors, cancellation, goals and expert sessions retain their existing UI owners.

### Dev Note

**Runtime invariant:** No companion is published. The Host projection owns runtime facts; this package owns a disposable Conversation slot registration.
