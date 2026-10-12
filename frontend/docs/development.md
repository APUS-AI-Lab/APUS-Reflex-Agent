# APUS Reflex Harness development guide

This guide covers local development, validation, patch maintenance, and target-native packaging. For the runtime design, see [Architecture](architecture.md). The integrated [release guide](../../docs/feat-integrated-product/releases.md) owns product publication and acceptance. The inherited [release runbook](release-runbook.md) remains an upstream reference, not the APUS publication procedure.

## Setup from the integrated repository

Use the [root development guide](../../docs/feat-integrated-product/development.md) for prerequisites, the single-checkout setup command, and desktop/Web startup. Run product preparation from the repository root; no second frontend checkout or manual `--source` directory is required.

The default desktop profile uses ordinary model mode. Configure the provider in the UI following the [configuration guide](../../docs/feat-integrated-product/configuration.md). Jev/System3 is opt-in; developer-specific service endpoints and credentials are not a new user's defaults.

Development builds keep their own user-data directory, but multiple development worktrees may share it. Avoid concurrent tests that change the same profile, plugins, or recovery state.

## Validation

Run the core checks before submitting a change:

```bash
npm test
npm run typecheck
npm run build
```

Static checks are not a substitute for runtime verification. Changes that affect startup, profiles, plugins, native dialogs, updates, mobile access, or packaging should also be exercised through the corresponding real application flow.

To exercise the Cloudflare-to-Pinggy fallback without disrupting the machine's network, start the development app with Cloudflare failure simulation enabled:

```bash
DSH_TUNNEL_FORCE_PINGGY=1 npm run dev
```

Then enable the temporary public tunnel from the phone connection screen. The tunnel status should report `pinggy`, and the generated URL should use a Pinggy hostname. This variable affects only the process started from that command; omit it on the next launch to restore the normal Cloudflare-first behavior.

Automatic fallback still happens only when Cloudflare fails to start. If a Cloudflare pairing link is already showing but the phone cannot open it, use **扫码打不开？换一条线路** / **Can't open? Try another link** on the pairing page to switch to Pinggy.

## Project map

```text
src/main/                 Electron main process and application orchestration
src/main/runtime/         Harness process lifecycle and diagnostics
src/main/state/           Profile consistency, repair, recovery, and Safe Mode
src/main/mobile/          Paired phone bridge and optional Cloudflare tunnel
src/main/update/          Installed-build update state and lifecycle
src/preload/              Narrow renderer-to-main IPC and desktop UI seams
src/shared/               Shared contracts and desktop menu definitions
packages/                 Bundled desktop support packages
patches/                  Reproducible patches for the pinned Harness packages
build/                    Packaged HTML, icons, loaders, and Harness entry files
scripts/                  Build, signing, metadata, and target verification tools
test/                     Unit and source-contract regression coverage
.github/workflows/        Native CI, signing, release, and publication workflows
```

## Maintaining upstream patches

The desktop product intentionally reuses the upstream Harness UI. Desktop-specific provider onboarding, preset transfer, model selection, workspace, branding, and layout changes are captured under `patches/` rather than stored as untracked edits in `node_modules`.

When upgrading Harness:

1. Install the intended upstream version.
2. Verify the current Settings, Credentials, Provider Directory, workspace, and preset contracts.
3. Reapply or rewrite each desktop customization.
4. Regenerate the relevant `patch-package` patches.
5. Run the full automated suite.
6. Start the real app and exercise every affected user flow.

## Packaging

Harness includes architecture-specific native dependencies. Build each installer on the operating system and architecture where it will run.

```bash
# macOS Apple Silicon, on an Apple Silicon Mac or runner
npm run package:mac:arm64

# macOS Intel, on an Intel Mac or runner
npm run package:mac:x64

# Windows x64 NSIS installer, on a Windows x64 machine or runner
npm run package:win
```

Do not invoke `electron-builder --win` from macOS or Linux for a distributable Windows package. The target verification scripts intentionally reject host/target mismatches.

For local unsigned development packages, use the corresponding `package:dev:*` command. Windows packages run Harness and package commands through the packaged Electron executable in Node mode; the standalone `resources/app.asar.unpacked/node_modules/node/bin/node.exe` must be absent. Verify the packaged native-module, pnpm and Harness smokes, then the final signed installer's separate installed-app smoke before handoff. The locked Electron 43.0.0 must remain compatible with the native loader: `scripts/verify-target.mjs` fails packaging when Electron in Node mode cannot load it, and changing Electron still requires a new Windows package qualification. Before packaging, `node scripts/probe-electron-node-runtime.mjs` boots Harness from the repository through Electron Node mode with a disposable `DSH_HOME` and checks an authenticated HTTP response; the Windows CI job runs it on every build.

The integrated product release uses the root workflow and same-checkout runtime. Follow the root release guide before invoking lower-level packaging commands. A local build or pull-request check does not establish an installed or signed release.

## Contribution hygiene

- Never include real API keys in issues, logs, screenshots, fixtures, or test data.
- Preserve unrelated worktree changes.
- Keep temporary research, local reports, and internal working documents under the ignored `doc/` directory.
- Update all localized README files when changing user-visible facts.
