# APUS Reflex Harness

English | [中文](README.zh.md)

> **瞬策 · Instant action. Deep thinking.** Build a Personal Agent with your models, persistent task history and **Loop Working**.

APUS turns a sequence of model calls into work that can continue around a goal: understand the request, choose an action, execute, inspect the evidence, recover relevant context and continue. You choose the general model for planning and generation; optionally connect your own Reflex/Jev decision service for structured decisions along the way.

Built on DeepSeek Harness, APUS separates model reasoning from execution, permissions and durable Session history. It is a **developer preview**. The [release readiness review](docs/dev-continuum-reflex-integration/release-readiness.md) records what has been tested and what still needs acceptance.

## A Personal Agent for ongoing projects

Consider a personal project: build a small expense tracker. You specify CSV import, local storage and a rule that source files must remain untouched. The agent plans the change, edits code, runs tests and records the results. Later, you add a new requirement: handle refunds without double-counting them.

With the relevant integrations enabled, APUS can retain admitted requirements, retrieve related facts, compare work against the current Goal and use execution evidence when deciding the next step. After a restart, you can reopen the same Session and recover the existing task history. **Goal state restores with the Session; resuming automatic continuation requires an explicit resume.**

This is a scenario illustration, not a claim that every step has passed a single end-to-end product test. The [casebook](docs/dev-continuum-reflex-integration/classic-cases.html) separates reproducible cases from proposed demonstrations.

## Loop Working: a goal, actions and feedback

A long task needs both continuity and control. Loop Working connects them in a repeatable cycle:

1. **Establish the goal.** Keep the objective, current requirements and later corrections attributable to their source.
2. **Choose the next action.** Let the general model plan; use configured Reflex integrations for bounded routing, selection or supervision decisions.
3. **Execute through the Harness.** Run tools, skills and subagents under the configured permissions and cancellation rules.
4. **Inspect the evidence.** Record tool results, decision receipts and adopted interventions rather than treating a model’s completion statement as independent proof.
5. **Recover and continue.** Restore relevant history, reassess progress and continue within the configured execution limits, or pause for the user.

Memory supports this cycle; it does not replace goal management, verification or permission checks. Task success still needs task-specific evidence.

<a id="architecture"></a>

## The models decide; the Harness executes

![APUS product and technical architecture: user entry, Harness execution, optional Reflex decisions, configurable models, Session history and Continuum memory.](docs/dev-continuum-reflex-integration/apus-reflex-loop-working-architecture.svg)

[Architecture overview](docs/dev-continuum-reflex-integration/apus-reflex-loop-working-architecture.html) · [Runtime architecture](docs/architecture.md)

The “large brain” is your configured general model: it reasons, plans, generates content and proposes tool calls. The “small brain” is an optional Reflex/Jev service: it answers structured choice, score or proposition questions within supplied candidates and constraints. The Harness owns execution and records the adopted results; it is not itself a model.

| Layer | What it contributes to ongoing work |
| --- | --- |
| Input facts | Accepted user messages and execution events enter the Session log; durability requires successful persistence and flush. |
| Reflex decisions | Configured integrations select routes or memory candidates, assess progress and propose bounded recovery actions. |
| Harness execution | Tools, skills and subagents perform work with permissions, cancellation and owned process lifecycles. |
| Persistent memory | Continuum restores admitted records from the same Session and rebuilds its retrieval index. |
| Context projection | Relevant excerpts form a bounded model request; System3 context projection protects submitted history prefixes. |
| Outcome feedback | Recorded actions, results and decision receipts inform subsequent work and independent review. |

The decision service is configurable. A replacement must implement the supported Jev/System One protocol; an arbitrary chat-completions endpoint is not automatically a replacement for every Reflex integration. See the [Jev provider guide](packages/experimental/apus-dsh-jev-plugin/README.md).

## Persistent memory, finite context

![Continuum memory flow: admitted Session facts, durable storage, scoped retrieval, optional Reflex selection and bounded model context.](docs/dev-continuum-reflex-integration/apus-continuum-memory-flow.svg)

[Memory flow overview](docs/dev-continuum-reflex-integration/apus-reflex-loop-working-architecture.html#memory) · [Continuum semantics](packages/context/continuum/README.md) · [Optional Jev selector](packages/experimental/continuum-jev/README.md)

**Continuum** separates task history from the limited context of a single inference request. A fact can remain in persisted history even when it is absent from the current prompt. Retrieval and optional Reflex selection bring a bounded working set back into the next request.

- **Keep source references.** Admitted records cite Session events. Corrections create successors, and deactivation stops a record from participating in recall while retaining its history.
- **Control admission and scope.** Admission is explicit by default. An opt-in policy can admit committed human text; scope filtering controls which records a read can use.
- **Restore the same task.** The current lifecycle restores memory from the same Session across turns and process restarts. A new Session does not automatically gain a global personal memory store.
- **Bound each request.** Retrieval limits candidate counts and excerpt bytes. Jev selects among supplied candidates and falls back according to its configured mode and failure policy.

“Infinite context” and “infinite memory” name the product direction: continue useful work beyond one model window by retaining history and recovering relevant context. Storage and context remain finite, lexical retrieval can miss relevant facts, and summaries or excerpts omit information.

“Lossless” needs a precise scope. Accepted text events can remain available in the Session after successful flush; this is not a guarantee of lossless recall or preservation of every uploaded byte. Automatic memory admission extracts text, attachments have separate storage rules, and images may be normalized or resized. A successful in-memory append is not proof that a disk write succeeded.

Summary-tree and zoom helpers are available through explicit APIs; automatic lifecycle retrieval currently uses the record index. Local stable-prefix measurements are not provider cache-hit or billing measurements. System3’s live context integration separately protects frozen/submitted prefixes. See the [architecture follow-ups](docs/dev-continuum-reflex-integration/architecture-followups.md).

## Continuity with control

| Capability | Current behavior and limits |
| --- | --- |
| Goal management | Durable objective and revision state, pause/resume and a cap on continuation rounds. Goal state restores with the Session; automatic continuation requires explicit resume. |
| Supervision | Configured Reflex supervision can assess Goal progress, record an intervention and inspect later feedback; stale decisions are rejected. |
| Recovery | Bounded Codex recovery checks inactivity, pending approval and active side effects before interrupting and reconciling existing work. |
| Completion review | Active mode can reject unsupported completion within its refusal allowance; the deployment example defaults to shadow review. Independent acceptance remains necessary. |
| Execution limits | Goal rounds, decision deadlines, intervention counts and recovery counts bound work. They are not a promise of a universal monetary budget. |
| Permissions and data | Tool permissions, process confinement, System3 route policies and Continuum scopes have separate owners. A model decision does not grant additional authority. |

Choose where generation and decision requests run. System3 data-class settings are not a global network firewall; explicitly enabled memory selection sends its query and candidate excerpts to the configured Jev service. The [public provider guide](docs/dev-continuum-reflex-integration/public-provider-configuration.md) explains configuration, credentials and the default general-model path.

## Use Reflex, or start with a general model

| Configuration | Available behavior |
| --- | --- |
| General model, no Jev | Original DSH generation, tools and Session persistence. The Reflex-only Continuum feature remains inactive. |
| Reflex/Jev configured | Structured decision capabilities can be enabled individually; mounting the provider alone does not activate every integration. |
| Continuum enabled | Requires Reflex plus memory admission/scope settings. The selector’s off/shadow/active modes distinguish baseline selection, recorded advice and validated advice adoption. |
| System3 deployment without data classification | System3 is explicitly disabled, including its local process supervision. Ordinary generation continues using the configured provider. |

This preserves a useful general-model runtime while allowing Reflex to participate at explicit decision points. Configuration and deployment remain part of enabling a capability.

## Evidence, not a release claim

The [shipped-profile memory tests](apps/cli/tests/profiles/headless/tests/continuum-memory.e2e.ts) start source/built profiles in separate processes. They inspect the first process’s persisted fact and source references, then require that fact in the resumed process’s separate model-request log. Disabled/no-Jev and new-Session controls check activation and isolation.

The [public bundle tests](packages/experimental/apus-dsh-jev-plugin/tests/public-bundle.spec.ts) exercise actual Loader configuration and local HTTP dispatch, including anonymous/authenticated providers, invalid configuration and existing profile overrides. [System3 context tests](packages/experimental/system3/tests/reflex-context.spec.ts) cover projection and protected constraints. Recording providers establish integration behavior, not real-model decision or recall quality.

The [acceptance review](docs/feat-reflex-control/apus-reflex-harness-acceptance-review.html) records real-provider examples and their limits. Healthy long tasks, mid-run Goal changes, large-history performance, remote quality/fallback measurements, full regression and signed desktop packaging need their own evidence. A merge is not a release certificate.

## Run from source

Requires Node.js `^22.19 || >=24` and the pnpm version declared by `packageManager`.

<a id="run"></a>

<a id="run-from-source"></a>

```sh
git clone https://github.com/APUS-AI-Lab/APUS-Reflex-Harness.git
cd APUS-Reflex-Harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares repository artifacts; `pnpm dsh web` launches those artifacts without rebuilding. Configure a generation model and credentials in Web settings. For development with rebuilds, use `pnpm run dev:web`.

Optional Reflex, System3 and memory need their corresponding profile configuration. Follow the [public provider guide](docs/dev-continuum-reflex-integration/public-provider-configuration.md), [System3 guide](packages/experimental/system3/README.md) and [Continuum guide](packages/context/continuum/README.md). The launch command above does not activate them all.

### Upstream npm distribution

```sh
npx @deepseek-ai/dsh web
```

This command installs upstream DeepSeek Harness, not APUS or this fork’s Jev additions. Its Web UI defaults to `http://127.0.0.1:3080`; use `--no-open` to suppress opening a local browser. See the [Web UI guide](docs/user/guide/index.md).

## Two independent repositories

[APUS Reflex Harness](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness) owns the runtime and its Web/client components. [APUS Reflex Frontend](https://github.com/APUS-AI-Lab/APUS-Reflex-Frontend) owns the independent desktop assembly and pins a Harness revision. Updating Harness `main` does not update an already packaged desktop runtime; prepare and verify the intended pin.

## Contribute and get support

- Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [development guide](docs/development.md).
- New contributors can use the [architecture task list](docs/dev-continuum-reflex-integration/architecture-followups.md), with focused tasks and acceptance criteria.
- Report bugs through [GitHub Issues](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/issues).
- Read [SAFETY.md](SAFETY.md) before running the project; report vulnerabilities through [SECURITY.md](SECURITY.md), never a public issue.
- Agent contributors should follow [AGENTS.md](AGENTS.md). Public APIs remain pre-stable and may change incompatibly.

## Upstream and license

APUS extends [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), developed by [DeepSeek AI](https://deepseek.com). Its plugin architecture uses [Cordis](https://github.com/cordiverse/cordis), described in [A Programming Paradigm for Spatiotemporal Composability](https://arxiv.org/abs/2608.25512). The [upstream documentation](https://deepseek-harness.github.io/deepseek-harness/) describes the upstream distribution; APUS configuration is documented here.

[MIT](LICENSE). The original DeepSeek copyright and permission notice are retained. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) documents third-party dependencies and licenses. APUS branding does not replace upstream authorship or imply endorsement. See [brand and assembly](docs/feat-apus-brand/branding.md).

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```
