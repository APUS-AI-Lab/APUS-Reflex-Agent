# APUS Reflex desktop packaging

The package identity is `xdan-system3-frontend`; its product version is declared in [package.json](../../package.json). The display name is `APUS Reflex Harness` and the compatible app ID is `ai.xdan.system3`. Development uses `ai.xdan.system3.dev`. State defaults to `xdan-system3` or `xdan-system3-dev` under the OS application-data directory; `SYSTEM3_DESKTOP_USER_DATA_DIR` accepts only an absolute path. Upstream Desktop state is not migrated implicitly. This fork has no signed update feed; its update manager refuses upstream Desktop archives. Upstream diagnostic submission is disabled for this product; native Harness logs remain local.

## Prepare and package

Build the own Harness first, including the Reflex Client UI package. Run `node scripts/prepare-system3-runtime.mjs --deploy --source <Harness-worktree>`. Production preparation requires committed source. Local acceptance can add `--allow-dirty`; the manifest records this and packaging then requires explicit `SYSTEM3_ALLOW_DIRTY_PACKAGE=1`.

Preparation copies source and built artifacts into an isolated temporary directory, excluding every node_modules and checkout metadata directory. Legacy pnpm deploy mutates its source installation metadata, so it must never run against the active development tree. The isolated tree includes Desktop file dependencies as workspace packages and resolves their production dependencies. PPT assets are generated first; the generated preview manifest and templates enter the closure. The CLI artifact declares the six experimental packages as resolver dependencies; the source CLI manifest stays unchanged. It preserves the upstream Node-carrier strategy: hoisted dependencies, restoration of legacy hoists, and physical materialization of package links. Dependency lifecycle scripts remain enabled for native binaries; only development Git-hook installation is removed from the temporary root manifest.

The closed tree includes the supported dsh launcher, the experimental System3, Jev, Continuum, and local Reflex packages, Desktop plugins, and their dependencies. All 27 maintained compatibility patches are applied to runtime JavaScript with zero fuzzy matching; TypeScript declarations remain from the own build. Source and adapted-patch hashes and resulting artifact hashes are saved in `desktop-patch-receipt.json`. The manifest fixes the source commit, platform, architecture, package identities, and dirty status. No source-checkout manifest is accepted by an installed application.

On macOS arm64, preparation also stages the llama.cpp runner that the Harness pins in `scripts/primary-runtime/lock.json`. [`scripts/reflex-runner.mjs`](../../scripts/reflex-runner.mjs) loads the Harness primary-runtime builder through the checkout's tsx. That builder verifies the archive hash and copies `llama-server`, only the libraries it loads, and the llama.cpp license into `system3-runtime/dependencies/llama-server/` as regular files. The manifest records the release as `llamaServer`. The electron-builder gate requires this runner exactly on macOS arm64; afterPack, afterSign, and installed qualification each run `llama-server --version`. The Desktop exports the runner path to the Harness as `APUS_REFLEX_RUNNER` only when the file exists. Ad-hoc signatures carry no Team ID, so the hardened runner loads its sibling libraries only through electron-builder's default `disable-library-validation` entitlement; Developer ID signing and notarization are not yet validated.

`npm run build:dir` builds the directory application. The electron-builder gate rejects missing packages, a non-deployed manifest, a wrong architecture/platform, an unpinned source commit, or absent patch receipts. The afterPack hook explicitly copies the closed runtime outside the app archive because electron-builder otherwise filters node_modules from extraResources. It then verifies every package identity in the manifest, every patched artifact hash, absence of symlinks, and the actual packaged Node/dsh version before retaining the existing PPT verifier. The application still launches only through dsh profiles.

## Compatibility decisions

| Patch package | Runtime decision |
| --- | --- |
| dsh | Retain CLI failure propagation; dependencies belong to the generated closure manifest |
| dsh-api-session-controller | Retain Desktop APIs; preserve Reflex routing/reset; adapt only the reviewed import and RPC source-location contexts |
| dsh-app-boot | Retain installation-owned safe-mode resolution and compatibility reporting |
| cordis-plugin-loader | Retain profile/plugin loading behavior |
| dsh-plugin-manager | Retain recovery/removal behavior |
| dsh-session-persistence, dsh-session-persistence-jsonl, dsh-workspace | Retain Desktop persistence, recovery and workspace operations |
| dsh-api-remotes | Retain Desktop remote client changes |
| dsh-client-modules, dsh-client-file-upload, dsh-client-shortcuts | Retain client loading, upload and keyboard behavior |
| dsh-client-ui-agent-preset, attachment, chat, conversation, deliverables, model-selection, primitives, settings-general, settings-models, sidebar, trajectory, workspace | Retain Desktop UI extension points; map generated CSS identifiers by the same module name and exported key |
| dsh-llm-deepseek, dsh-llm-pi-ai | Retain provider error/compatibility behavior |
| undici | Retain the maintained dispatcher compatibility fix |

The patch adapter fails if business-code context no longer matches. It never copies stock DSH packages over the own runtime. Every changed JavaScript file is syntax checked before publication of the staged directory. Preparation and afterPack also perform real imports of the PPT preview/host/composer modules and all six experimental host entries.

## Acceptance and provider configuration

Launch the packaged executable with `SYSTEM3_DESKTOP_USER_DATA_DIR` set to a new absolute directory. Keep existing user Profiles untouched and choose a blank Profile when the import prompt appears. Verify normal startup, saved settings after restart, and `--safe-mode` against the same packaged runtime. Safe Mode retains its recovery patch; the normal product overlay is generated separately as `desktop.patch.yml`.

Check that `runtime-manifest.json` records the intended source revision and `sourceDirty: false`, and verify the package identities and patch receipts. Build and assemble from the same clean checkout; a manifest alone does not establish that copied build artifacts match its revision. Acceptance records for older packages do not qualify the current package.

Configure providers through the [integrated model configuration guide](../../../docs/feat-integrated-product/configuration.md). Credentials belong in private user settings or the deployment environment. Reflex/Jev and memory selection are optional; connecting a decision service does not automatically enable routing, supervision or Continuum. No maintainer-specific gateway is required.

Model-enabled acceptance must separately verify actual routing, Skill injection, native tool execution, persisted results and independent artifact checks through the packaged UI. Keep real model requests distinct from keyless startup tests. Do not publish credentials, private deployment addresses, user Session identifiers or unredacted profile data with the report.

## Platform validation

The integrated product workflow prepares the applications from a clean checkout, checks release versions, runs desktop tests and probes the runtime launcher. These checks do not certify a signed installer. Windows installation and upgrade require Windows evidence; macOS signing and notarization require their own validation. Use the [integrated release procedure](../../../docs/feat-integrated-product/releases.md) for packaging and publication.

Preparation launches the packaged pnpm CLI through Node and requires GNU patch via `SYSTEM3_PATCH_COMMAND` or PATH. Patch inputs retain LF line endings. Runtime preparation does not require model credentials.

Generated CSS source regions are matched by their exact package-relative stylesheet path across POSIX and Windows separators. The target region text is retained; ambiguous origins are rejected. Executable patch context and CSS declarations are not normalized, and application still uses zero fuzzy matching.

Runtime patch tests use `SYSTEM3_PATCH_COMMAND` when set, otherwise `patch` on PATH. Windows CI selects Git for Windows patch.exe by absolute path without adding its Unix utilities to PATH; macOS can exercise the same implementation using Homebrew `gpatch` and its `libexec/gnubin` directory. Patch hunks preserve balanced leading and trailing context so GNU does not impose an unintended file-end constraint. The dispatcher patch regression reverses and reapplies the locked npm input and rejects changed executable context.
