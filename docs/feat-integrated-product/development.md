# Develop APUS from one checkout

English | [中文](development.zh.md)

This guide prepares the desktop host and Harness from the same repository. Use [installation](installation.md) if you only want the application.

## Prerequisites

Install Git, Node.js 24, and pnpm 11.7.0. Node.js includes npm, which the setup command uses for the desktop dependency lock. The first setup needs network access for dependencies and Electron. Native build tools may be needed for your platform; see [Harness development](../development.md).

## Prepare and start

```sh
git clone https://github.com/APUS-AI-Lab/APUS-Reflex-Harness.git
cd APUS-Reflex-Harness
pnpm run setup
pnpm run start:desktop
```

Run these commands from the repository root. Setup installs the root and desktop dependencies, builds the Harness, and prepares the desktop runtime from the same checkout. It does not require a second repository or a manually specified backend directory. Configure your provider in the application as described in [model configuration](configuration.md).

Use `pnpm run dev:desktop` to rebuild and start the desktop host. After changing Harness source, rerun `pnpm run setup` to rebuild and refresh the bundled runtime. Use `pnpm run dev:web` for Web development. Keep the terminal open while a development process runs and stop it before starting another instance with the same profile.

Development and installed desktop builds use separate data directories. Multiple worktrees can still share the development profile: use disposable data when testing migrations, recovery, or plugin changes.

## Code ownership

| Directory | Responsibility |
| --- | --- |
| `frontend/` | Electron windows, native integration, runtime process, and desktop extensions |
| `apps/web/` | Web entry point |
| `packages/` | Harness capabilities, API, and shared UI |
| `deploy/` | Product composition and deployment configuration |
| `scripts/` | Root setup, build, and release orchestration |

The desktop keeps its npm lock while the Harness keeps its pnpm lock. Root commands coordinate them. Do not replace either dependency lock to resolve an installation problem without identifying the cause.

## Verify and troubleshoot

A successful build alone does not demonstrate a usable application. Confirm the UI opens, configure a model, complete a small task in a disposable workspace, then restart and check the saved configuration. Packaging needs the separate [release validation](releases.md).

If setup fails, keep the first failing command and error. Check Node and pnpm versions, network access, and native build prerequisites before rerunning setup. Report redacted failures through [Issues](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/issues). Contributor checks and architecture rules are in [Harness development](../development.md) and [architecture](../architecture.md).
