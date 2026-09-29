# xDAN System3 Harness

English | [中文](README.zh.md)

> **Jev Native + DSH Native.** System3 combines System1 (Jev-like bounded semantic decisions) with System2 (high-performance reasoning and generation), coordinated by DSH’s native state and execution mechanisms. This repository provides typed Jev decisions, replayable receipts, and opt-in entry model routing through the native Web/API controller. Start with the [integration guide](docs/feat-independent-harness/README.md).

## Architecture

The first objective is **Jev-guided intake strategy and dispatch**: after user input, select an allowed processing path and let DSH route it to a suitable model or specialist. The second is **smarter, smoother execution** through evidence, memory, recovery, escalation and goal decisions. Both share native task state, decision records and action ownership; rules handle determined cases and System2 handles open reasoning and generation. Entry routing requires an explicit candidate and privacy configuration; mounting the decision provider alone leaves it disabled.

![Jev Native + DSH Native: priority one is intake strategy and dispatch; priority two is intelligent execution, sharing native decisions and outcome feedback. Chinese architecture diagram.](docs/feat-independent-harness/architecture@2x.png)

[SVG source](docs/feat-independent-harness/architecture.svg) · [Jev Native + DSH Native plan (Chinese)](docs/feat-independent-harness/jev-native-dsh-native-plan.html)

The first implementation handles idle text requests through a Web/API adapter with Fidoo LiteLLM generation routes; specialist handoff, queued inputs and other DSH entry points require their own integration and verification. Memory, routing, long-horizon goals and proactive communication extend the same architecture. Future local 9B/27B Lead Agents remain a deployment option. Pilot is an experimental reference, not a code dependency.

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## Developer preview

DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

### Run the upstream distribution from `npm`

The npm package below is the upstream distribution; it does not install this fork’s Jev additions. Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

<a id="run-from-source"></a>
### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/cryptoSUN2049/xDAN-System3-Harness.git
cd xDAN-System3-Harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

## Community and support

- Submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
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

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
