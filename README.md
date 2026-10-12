# APUS Reflex Harness

English | [中文](README.zh.md)

> **瞬策 · 瞬时执行，深度思考。** APUS Reflex Harness pursues Model as Harness: coordinated decision and reasoning models manage tools, skills, memory, context, and subagents; the DSH runtime executes actions, enforces permissions, and records facts. Integration and verification limits are documented below.

See the [brand definition and assembly guide](docs/feat-apus-brand/branding.md) for shared assets, compatibility identifiers, and service ownership.

## Architecture

The architecture combines a fast decision brain with a durable execution harness. **Reflex/Jev is the small brain:** it makes bounded, low-latency choices about intake, routing, memory admission, recovery and supervision. **DSH is the large brain's working harness:** it performs open-ended reasoning and generation through models, then owns tools, skills, subagents, permissions, lifecycle and facts. Both share native task state, decision records and action ownership. Entry routing requires an explicit candidate and privacy configuration; mounting the decision provider alone leaves it disabled.

![Jev Native + DSH Native: priority one is intake strategy and dispatch; priority two is intelligent execution, sharing native decisions and outcome feedback. Chinese architecture diagram.](docs/feat-independent-harness/architecture@2x.png)

[Loop Working architecture (small brain + Harness + infinite memory)](docs/dev-continuum-reflex-integration/apus-reflex-loop-working-architecture.html) · [SVG source](docs/feat-independent-harness/architecture.svg) · [Jev Native + DSH Native plan (Chinese)](docs/feat-independent-harness/jev-native-dsh-native-plan.html)

The implementation handles idle Web/API text requests with Fidoo LiteLLM generation routes, bounded Skill selection before native model steps, and a Conversation view that distinguishes advice, adoption, model response and Skill injection. The APUS Reflex layer adds the dedicated Reflex model settings page, reversible context projection and recovery, cache/session-prefix protection, and bounded Codex Goal supervision. See the [implementation and acceptance scope](docs/feat-system3-g1/implementation.md), [deployment guide](docs/feat-system3-g1/deployment.md), [System3 configuration and limits](packages/experimental/system3/README.md), and the [expert acceptance report](docs/feat-reflex-control/apus-reflex-harness-acceptance-review.html). The strict controlled supervision path and representative context recovery are verified; healthy long-task controls, mid-run Goal changes, remote first-byte/fallback, and signed release packaging remain pending. Pilot remains an experimental reference.

## From Personal Agent to Loop Working

Most agents answer one request and lose the working state that made the answer useful. APUS Reflex Harness is designed for a **Personal Agent** that can keep a job moving: understand an intention, choose a route, act through tools and skills, record what happened, recover the relevant state, and continue from the next unfinished step. We call this cycle **Loop Working**.

Loop Working is possible because the system separates durable memory from the model's bounded request window:

- **Infinite memory:** durable Session records, indexed references, summaries and retrieval policies keep working facts available across turns, processes and restarts.
- **Lossless input:** the original user message and admission facts remain recorded before projection, routing or summarization changes what a model sees.
- **Lossless memory:** the original Session and cache-safe committed prefix remain intact; a later context projection can add a recoverable reference without rewriting history.

“Infinite context” therefore means an effectively unbounded, recoverable work history with bounded model projections. It does not mean that any model receives unlimited tokens in one request. The harness selects the relevant evidence for each step while keeping the source facts available for later recovery and audit.

## Two decision-model paths

The same Personal Agent works with two deployment choices:

1. **Reflex path:** when a Jev/Reflex provider is mounted and explicitly enabled, a dedicated low-latency decision model handles bounded choices such as intake routing, memory admission, context recovery and supervision. Shadow decisions can be recorded before active adoption, and the selected decision remains attributable in the Session.
2. **General-model path:** when Jev is absent or the Reflex switch is disabled, the original DSH behavior remains available. General models, explicit rules and configured routes can still execute the task; the runtime does not require a Reflex endpoint to start working.

This separation keeps decision latency and generation quality independent. Reflex decides within a narrow, auditable contract; the general model performs open-ended reasoning and generation; DSH owns tools, permissions, subprocesses, skills, subagents and durable execution.

## How the architecture sustains a work loop

1. **Input and admission** preserve the user's request as a Session fact and decide whether a message may become durable memory.
2. **Reflex or configured routing** selects an allowed model, Codex path or recovery action. The decision is recorded with its scope and source.
3. **Harness execution** runs tools, skills and subagents under DSH permissions. It owns lifecycle, cancellation and action results instead of asking a model to simulate them.
4. **Continuum memory** writes durable records, maintains indexed summaries and retrieves relevant references. The source Session stays authoritative.
5. **Context projection** builds a bounded request from those references. It edits only an unsubmitted, unfrozen tail and preserves committed prefixes that may be reused by a provider cache.
6. **Outcome feedback** records model-visible inputs, actions and results so the next loop can resume, verify an improvement, or safely ask for a new instruction.

The result is a Personal Agent that can work over time without pretending that memory, model context, or a single decision is permanent. The [Continuum memory E2E](apps/cli/tests/profiles/headless/tests/continuum-memory.e2e.ts), [System3 Reflex context tests](packages/experimental/system3/tests/reflex-context.spec.ts), and [acceptance casebook](docs/dev-continuum-reflex-integration/classic-cases.html) show the current evidence and known limits.

## APUS Reflex capability guide

- **Intake routing:** Reflex can select an allowed model or Codex route after admission; local admission/status and route-decision measurements are recorded in the [acceptance checklist](docs/feat-reflex-control/acceptance-checklist.md).
- **Reflex model configuration:** Web and Electron share the dedicated **Reflex 模型配置** page. Provider, model and effort settings persist and are consumed by real requests; see the [System3 API/configuration reference](packages/experimental/system3/README.md).
- **Context and cache safety:** line/segment projection edits only unsubmitted, unfrozen request tails, appends recoverable references, and preserves the original Session log and cache prefixes. The [cache benchmark design](docs/feat-reflex-control/cache-benchmark-design.md) describes the boundary.
- **Codex supervision:** bounded evidence, one attributed adjustment and post-adjustment verification keep the monitor lightweight. The [strict v6 evidence](docs/feat-reflex-control/evidence/semantic-codex-strict-final-v6.md) is the reference user-flow demo; it does not imply every healthy long task is automatically corrected.
- **Release status:** current changes and known limits are in the [release notes](docs/feat-reflex-control/release-notes.md). Do not treat this developer preview as a security boundary.

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Upstream DeepSeek Harness documentation (not the APUS build guide): [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## Developer preview

DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project. Report vulnerabilities through the [security policy](SECURITY.md), never in a public issue.

## Run

### Run the upstream distribution from `npm`

The npm package below is the upstream distribution; it does not install APUS Reflex Harness or this fork’s Jev additions. Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

<a id="run-from-source"></a>
### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/cryptoSUN2049/APUS-Reflex-Harness.git
cd APUS-Reflex-Harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

## Community and support

- Submit feedback or bug reports through [GitHub Issues](https://github.com/cryptoSUN2049/APUS-Reflex-Harness/issues).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

`pnpm run dev:web` builds, serves, and rebuilds client bundles on source edits in one terminal, and `make help` lists the matching Make targets for Web and Desktop; the guide's application commands section owns the full table.

For agents, follow [AGENTS.md](AGENTS.md).

## Citation

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## License

[MIT](LICENSE). The original DeepSeek copyright and permission notice are retained in full.

We thank DeepSeek and the DeepSeek Harness contributors for the upstream agent runtime, Shigma and the Cordis contributors for the plugin framework, and all third-party maintainers whose work supports APUS Reflex Harness. APUS branding does not replace their authorship or imply their endorsement.

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
