# APUS Reflex Harness

English | [中文](README.zh.md)

> **瞬策 · 瞬时执行，深度思考。** APUS Reflex Harness pursues Model as Harness: coordinated decision and reasoning models manage tools, skills, memory, context, and subagents; the DSH runtime executes actions, enforces permissions, and records facts. Integration and verification limits are documented below.

See the [brand definition and assembly guide](docs/feat-apus-brand/branding.md) for shared assets, compatibility identifiers, and service ownership.

## Architecture

The first objective is **Jev-guided intake strategy and dispatch**: after user input, select an allowed processing path and let DSH route it to a suitable model or specialist. The second is **smarter, smoother execution** through evidence, memory, recovery, escalation and goal decisions. Both share native task state, decision records and action ownership; rules handle determined cases and System2 handles open reasoning and generation. Entry routing requires an explicit candidate and privacy configuration; mounting the decision provider alone leaves it disabled.

![Jev Native + DSH Native: priority one is intake strategy and dispatch; priority two is intelligent execution, sharing native decisions and outcome feedback. Chinese architecture diagram.](docs/feat-independent-harness/architecture@2x.png)

[SVG source](docs/feat-independent-harness/architecture.svg) · [Jev Native + DSH Native plan (Chinese)](docs/feat-independent-harness/jev-native-dsh-native-plan.html)

The implementation handles idle Web/API text requests with Fidoo LiteLLM generation routes, bounded Skill selection before native model steps, and a Conversation view that distinguishes advice, adoption, model response and Skill injection. See the [implementation and acceptance scope](docs/feat-system3-g1/implementation.md), [deployment guide](docs/feat-system3-g1/deployment.md), and [System3 configuration and limits](packages/experimental/system3/README.md). Specialist handoff, queued-entry routing, Jev-driven memory and sustained Goal decisions, and local 9B/27B Lead Agents require further integration and verification. Pilot remains an experimental reference.

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Upstream DeepSeek Harness documentation (not the APUS build guide): [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## Developer preview

DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

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
