# System3 architecture integration sources

English | [中文](architecture-sources.zh.md)

This inventory defines the scope, sources, and treatment of earlier designs in the [unified architecture HTML](architecture.html). The review date is 2026-10-01. Released implementation and frozen acceptance evidence define current facts; earlier designs remain historical references. This document does not introduce APIs or deployment acceptance.

## Scope and counts

The integration covers 12 existing directly relevant HTML documents. Logical documents are counted once, excluding other worktree copies, translations, and PNG exports: seven architecture or comprehensive plans, two experience demonstrations, two entry implementation or acceptance documents, and one frontend selection document.

| HTML source | Integrated subject | Update rule |
| --- | --- | --- |
| [Independent project design](../feat-independent-harness/design.html) | Decision and native execution ownership | Current scope follows the final implementation |
| [Jev Native + DSH Native](../feat-independent-harness/jev-native-dsh-native-plan.html) | Entry first, process second, complete objectives | Objectives do not imply every node is connected |
| [Entry implementation](../feat-independent-harness/entry-routing-implementation.html) | Native router and event association | Current definitions own the actual interfaces |
| [Historical entry acceptance](../feat-independent-harness/entry-routing-verification.html) | Initial execution path and limits | Final evidence defines the current release |
| [Web UI selection](../feat-independent-harness/web-ui-selection.html) | One Conversation and workbench | Retain selection rationale without replacing the stack |
| [Four-track foundation](../feat-system3-foundation/index.html) | Product, engineering, evaluation, and training roles | This architecture does not claim training or measured gains are complete |
| [Local model plan](../feat-system3-foundation/system3-special-plan.html) | Local Lead, local materials, and expert handoff | Separate general 9B/27B Lead from current remote Jev |
| [Native architecture](../feat-system3-desktop/system3-native-v1.html) | Architecture, calls, and complete objectives | Supersede outdated rc.2, SDK, and Skill status |
| [Experience v2](../feat-system3-desktop/system3-experience-v2.html) | Single-node feedback and detail expansion | Retain its offline design identity |
| [Experience v3](../feat-system3-desktop/system3-experience-v3.html) | Continuous tasks, materials, deliverables, and experts | Demonstration data is not release evidence |
| [Three-part integration design](../feat-system3-desktop/system3-intelligence-design.html) | UI, Host, models, tools, controls, and acceptance | Separate draft fields from public APIs |
| [Objectives and UX audit](../feat-system3-desktop/delivery-objectives-and-ux-audit.html) | Completion criteria and perceived speed | Supersede statements that frontend integration is absent |

Nine directly relevant Markdown document families also contribute: [native architecture](../architecture.md), [independent integration](../feat-independent-harness/README.md), Foundation's [design](../feat-system3-foundation/design.md), [9B integration](../feat-system3-foundation/jev-9b-integration-design.md), [model chain](../feat-system3-foundation/model-chain.md), and [special plan](../feat-system3-foundation/system3-special-plan.md), the [experience review](../feat-system3-desktop/system3-experience-review.md), and current [implementation](implementation.md) and [deployment](deployment.md). Translations count as the same document.

The three earlier SVGs are the [initial architecture](../feat-independent-harness/architecture.svg), [flow](../feat-system3-desktop/diagram/jev-harness-flow.svg), and [calls](../feat-system3-desktop/diagram/jev-harness-invocation.svg). The new page starts with [AgentLoop × N integration](diagram/system3-fusion.svg), followed by [current architecture](diagram/system3-current.svg), [target architecture](diagram/system3-target.svg), and [two-instance deployment](diagram/system3-deployment.svg). It embeds all figures for offline reading.

## Current factual baseline

The runtime implementation is `system3-g1-reviewed-rc2`; frozen acceptance is `system3-g1-acceptance-rc2`. [Desktop acceptance](desktop-acceptance.json) and [server acceptance](deployment-final.json) record exact source, frontend pin, tasks, injection IDs, artifacts, and recovery. This work reads source and existing evidence without calling real models or redeploying.

Frontend launches its own Electron shell and Harness, preferring loopback port 43129 and choosing an ephemeral port if occupied. The server is a separate Harness accessed through an SSH tunnel to loopback port 18731. Each owns its Session, workspace, credentials, and execution state; automatic synchronization has not been accepted. See the private Frontend [runtime](https://github.com/cryptoSUN2049/xDAN-System3-Frontend/blob/feat-system3-integration/src/main/runtime/harness-runtime.ts) and [packaging guide](https://github.com/cryptoSUN2049/xDAN-System3-Frontend/blob/feat-system3-integration/docs/feat-system3-integration/desktop-packaging.md).

## Superseded status and retained objectives

- rc.2, TypeSafe SDK 0.6.0, reset-to-auto, Client-safe projections, and actual Skill injection are released; earlier pending status is not the current conclusion.
- Current interfaces are SessionController and `system3Runtime`. TaskView, source exclusion, complete budgets, and composite stopping remain designs, not released APIs.
- Fixed models skip only entry Jev; automatic Skill can decide independently. Native adopted may be a legal baseline. The server's low-confidence fallback is not a successful Jev route-selection example.
- Current Jev 9B runs on the A100 network service using `/v1/systemone`. Local 9B/27B Lead is a future general generation and orchestration role; ordinary vLLM generation does not replace the decision protocol.
- Native Schedule persists tasks and restores cold Sessions for delivery. Host must be running, delivery targets the original Session, exactly-once is not guaranteed, and external notifications are not connected. Schedule storage-domain tables and Session logs own different data.
- `subagent/start/end` are live Cordis events, not same-named durable Session events. Expert runtimes own internal tools; the parent Harness owns handoff and control.
- Current evidence/supervisor helpers are not production process consumers. Automatic completion first requires fixing empty checks and missing evidence references, then connecting every completion path to the single Goal owner.
- Successful safe startup does not prove complete System3 task recovery. Same-source release rollback does not prove old-source downgrade compatibility. Single latency observations are not SLAs, p50/p95, or overall gains.
- The G1 release slice differs from the original G1–G6 milestones. Current functions cover the foundation, bounded entry, and first process node; comparative evaluation, memory, experts, Goal, and complete product acceptance remain unfinished.

## Page organization and validation scope

The page follows the user-specified Duse architecture structure: twelve sections covering product conclusions, system diagrams, scenarios, interfaces, data, models, security, deployment, progress, next steps, and sources. Duse belongs to another project; its App BFF, mail, calendar, and business database do not move into System3. Earlier prose remains historical. At the user's additional request, Native v1 and Jev Native + DSH Native have their first diagrams replaced in this worktree with the same AgentLoop × N illustration and links to current unified material. The main checkout and other worktrees remain unchanged.

Theme, architecture selection, six scenarios, anchors, and printing are offline page interactions without model, tool, or business requests. See [architecture-verification.json](architecture-verification.json) for browser and documentation validation. Page design validation does not extend product acceptance.

## Latest design focus

The core is Jev immediate decision and reasoning models cooperating inside one Harness: decisions change the next method, reasoning and tool results return to subsequent context and decisions, and native services own adoption and execution. AgentLoop × N expresses the same execution unit for single and multiple agents. N=10 illustrates one primary and nine child instances, each with its own Session; it is not a current concurrency result.

MAAH is a proposed research direction without claims of terminology priority or established novelty. It distinguishes design-time optimization, runtime candidate control, and post-execution trajectory learning. This page integrates roles and evaluation principles from the independent operations analysis without copying its external narrative or treating research precedents as product gains.
