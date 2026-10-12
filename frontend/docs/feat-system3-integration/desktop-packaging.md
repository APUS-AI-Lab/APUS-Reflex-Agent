# System3 Desktop packaging

The application identity is `xdan-system3-frontend` version `0.1.7-rc.2`, product `APUS Reflex Harness`, app ID `ai.xdan.system3`. Development uses `ai.xdan.system3.dev`. State defaults to `xdan-system3` or `xdan-system3-dev` under the OS application-data directory; `SYSTEM3_DESKTOP_USER_DATA_DIR` accepts only an absolute path. Upstream Desktop state is not migrated implicitly. This fork has no signed update feed; its update manager refuses upstream Desktop archives. Upstream diagnostic submission is disabled for this product; native Harness logs remain local.

## Prepare and package

Build the own Harness first, including the seventh System3 Client UI package. Run `node scripts/prepare-system3-runtime.mjs --deploy --source <Harness-worktree>`. Production preparation requires committed source. Local acceptance can add `--allow-dirty`; the manifest records this and packaging then requires explicit `SYSTEM3_ALLOW_DIRTY_PACKAGE=1`.

Preparation copies source and built artifacts into an isolated temporary directory, excluding every node_modules and checkout metadata directory. Legacy pnpm deploy mutates its source installation metadata, so it must never run against the active development tree. The isolated tree includes Desktop file dependencies as workspace packages and resolves their production dependencies. PPT assets are generated first; the generated preview manifest and templates enter the closure. The CLI artifact declares the six experimental packages as resolver dependencies; the source CLI manifest stays unchanged. It preserves the upstream Node-carrier strategy: hoisted dependencies, restoration of legacy hoists, and physical materialization of package links. Dependency lifecycle scripts remain enabled for native binaries; only development Git-hook installation is removed from the temporary root manifest.

The closed tree includes the supported dsh launcher, six experimental packages, Desktop plugins, and their dependencies. All 27 maintained compatibility patches are applied to runtime JavaScript with zero fuzzy matching; TypeScript declarations remain from the own build. Source and adapted-patch hashes and resulting artifact hashes are saved in `desktop-patch-receipt.json`. The manifest fixes the source commit, platform, architecture, package identities, and dirty status. No source-checkout manifest is accepted by an installed application.

`npm run build:dir` builds the directory application. The electron-builder gate rejects missing packages, a non-deployed manifest, a wrong architecture/platform, an unpinned source commit, or absent patch receipts. The afterPack hook explicitly copies the closed runtime outside the app archive because electron-builder otherwise filters node_modules from extraResources. It then verifies the final seven package identities, every patched artifact hash, absence of symlinks, and the actual packaged Node/dsh version before retaining the existing PPT verifier. The application still launches only through dsh profiles.

## Compatibility decisions

| Patch package | Runtime decision |
| --- | --- |
| dsh | Retain CLI failure propagation; dependencies belong to the generated closure manifest |
| dsh-api-session-controller | Retain Desktop APIs; preserve System3 routing/reset; adapt only the reviewed import and RPC source-location contexts |
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

## Acceptance

Launch the built executable directly with `SYSTEM3_DESKTOP_USER_DATA_DIR=/private/tmp/xdan-system3-acceptance` and `--remote-debugging-port=19223`. Repeat with `--safe-mode` to exercise recovery against the same own runtime. Safe mode retains its native recovery patch; the normal product patch is generated separately as `desktop.patch.yml`. Inspect real process command lines and the runtime manifest, then verify Jev/Fidoo selection, Skill injection, native tools and artifacts through the UI. Unit tests of the stock dependencies do not replace this installed-runtime acceptance.

Verified so far: identity/runtime/safe-mode focused tests (32), update tests (19), Frontend typecheck, isolated closed-runtime generation with all seven own packages and Desktop plugins, all 27 runtime patch applications, syntax checks of all patched files, zero remaining symlinks, and a passing package gate. The source node_modules installation metadata hash stayed unchanged during isolated deployment. The directory package booted in normal mode on macOS arm64 with Harness ready after 1961 ms. Native CDP confirmed the System3 readiness, automatic routing and evidence controls; this smoke made no model calls. The four full-suite failures were obsolete fork branding/packaging expectations; the corrected two files pass all 29 focused tests. The final clean closure pins the reviewed Harness tag `system3-g1-reviewed-rc2` and the Frontend product commit recorded in packaging-preflight.json; packaging passed without a dirty-source exception. Its normal window restored the public CSV result, stopped turn and automatic routing mode from the earlier live task. Its native safe profile started the same own CLI and reached readiness after 1234 ms. The full Frontend suite passed 1554 tests across 173 files. The reviewed build includes the request-failure attribution and historical UI-state fixes; normal boot reached readiness after 1435 ms. The reviewed package also passed a real public CSV task: Jev high entry decision 1403 ms, Skill selection 311 ms, native injection message correlation, actual Fidoo flash response and two independent artifact-oracle checks. The UI showed request acknowledgement at 5 ms and deciding at 15 ms in this single observation; these are not latency-distribution claims. Evidence lives in Harness `docs/feat-system3-g1/desktop-acceptance.json`. The Harness sidebar still displays the upstream logo.

The application is installed at `~/Applications/xDAN System3.app`. Use `~/.local/bin/xdan-system3` or `~/Applications/启动 xDAN System3.command`; the private launcher reads the protected runtime environment without storing credentials in the application. Installed startup reached readiness after 1951 ms and restored the same task. The matching Linux release also passed real task, restart and compatible rollback replay acceptance.

## Windows PR validation

The private Frontend PR workflow builds the reviewed Harness revision on its Windows runner before preparing the deployed closure. `SYSTEM3_HARNESS_READ_KEY` is a read-only Harness deploy key used only during checkout; checkout removes its authentication configuration before build steps. Missing cross-repository access fails packaging explicitly. Model credentials are unnecessary for the keyless startup checks.

Preparation launches the packaged pnpm CLI through Node, including its source-owned package-manager version selection, and requires GNU patch via `SYSTEM3_PATCH_COMMAND` or PATH. Patch inputs retain LF line endings. The System3 Electron Node probe validates the deployed manifest and starts its own entry through the Desktop wrapper. The packaged application smoke runs outside the checkout and retains separate shell koffi/pnpm checks. CI uploads unsigned System3 development artifacts; a successful PR run does not establish signed release or macOS packaging support.

Generated CSS source regions are matched by their exact package-relative stylesheet path across POSIX and Windows separators. The target region text is retained; ambiguous origins are rejected. Executable patch context and CSS declarations are not normalized, and application still uses zero fuzzy matching.

Runtime patch tests use `SYSTEM3_PATCH_COMMAND` when set, otherwise `patch` on PATH. Windows CI selects Git for Windows patch.exe by absolute path without adding its Unix utilities to PATH; macOS can exercise the same implementation using Homebrew `gpatch` and its `libexec/gnubin` directory. Patch hunks preserve balanced leading and trailing context so GNU does not impose an unintended file-end constraint. The dispatcher patch regression reverses and reapplies the locked npm input and rejects changed executable context.
