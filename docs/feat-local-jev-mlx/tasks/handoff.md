# feat-local-jev-mlx handoff

English | [中文](handoff.zh.md)

## TL;DR

The local decision engine (APUS Reflex 4B making Jev decisions on the user's Mac) and the post-login guidance when no usable answer model exists are **fully implemented**; every change is in this worktree and not yet committed.

Standard DSH ships it as the new optional bundle "Local decision engine": switch it on in the plugin page → one click downloads and enables (resume, sha256, self-test, automatic enable with undo) → a dock preparation chip and a "This device" decision label. The runner (llama.cpp `llama-server` b11118) ships in the desktop primary runtime.

Real acceptance (M5 24 GB, 4B Q8_0): self-test about 410 tok/s with a reference decision of about 300 ms; a three-question request takes about 1.0 s cold and 0.2–0.4 s warm; a Jev reload does not restart the runner.

Next: the user reviews and decides whether to commit and open a PR; after that, on-device acceptance of a Developer ID signed and notarized build, M1/M2 speed calibration, System3 desktop wiring, and the invitation card.

## Deliverables of this round

| Path | Description |
| --- | --- |
| `packages/experimental/reflex-local/` (src about 1,700 lines, tests about 2,060 lines) | Host engine: configuration, device admission, Range-resumable download, llama-server process, contract rendering (golden cases byte-identical to the Python contract), Jev provider, preparation state machine, `ctx.reflexLocal` |
| `packages/experimental/api-reflex-local/` | Typert Remote `reflexLocal/*` (follow/snapshot/prepare/pause/cancel/enable/disable/remove/acknowledge) |
| `packages/experimental/client-ui-reflex-local/` (src about 780 lines) | Single-primary-button card on the plugin page, activation prompt, undo Toast after automatic enable (acknowledged on close), dock preparation chip (with "Not now" for slow Macs) |
| `packages/experimental/reflex-local-bundle/` | Optional bundle: Jev (`defaultProviderId: reflex-local`, no cloud endpoint) + engine + Remote + UI + System3 (`local-only`, `jevExecutionDomain: local`, only taskFrame / completionReview (shadow) / skillSelection (≤16)) + dock; includes a real Loader composition test |
| `packages/experimental/apus-dsh-jev-plugin/` | `endpoint`/`model` may be omitted; new `defaultProviderId` (separate from the built-in System One `providerId`) |
| `packages/experimental/system3/` + `client-ui-system3/` | The runtime projection carries the entry decision's `executionDomain` (stateVersion 14); the dock shows "This device / Cloud" |
| `packages/client/ui-settings-models/` + `ui-settings-account/` + `apps/desktop/src/welcome-api.ts` | Readiness popup: shown only when no usable answer route exists; a signed-in account with a usable route is not asked for a key; "Configure later" stops prompting for the page load and leaves a notice above the composer |
| `scripts/primary-runtime/*` + `packages/skill/tool-workspace-dependencies/` + `apps/desktop-host/src/primary-runtime-source.ts` | Build-time runner download, sha256 check, soname materialization, smoke; the Host exports `DSH_DESKTOP_PRIMARY_RUNTIME_SOURCE` before the profile loads |
| `packages/boot/app-boot/src/profile.ts`, `apps/cli/package.json` | The bundle is in `OPTIONAL_BUNDLES` and the CLI dependencies |
| `docs/feat-local-jev-mlx/` | Design, experience draft, prototype, implementation spec (impl-spec), notes, lessons, todo; all bilingual pairs |

## Design constraints (must not be violated)

1. A decision model is not a chat model; the feature name is "Local decision engine".
2. Local failures never fall back to sending data out: failures map to the existing `transport` / `timeout` / `invalid-response`, and System3 falls back to its baseline.
3. No new `JevErrorCode` and no new Session events.
4. Noul always renders as the contract's canonical yes/no candidates (rendering it as a two-way choice reversed decisions in measurement); prompts must be byte-identical to the Python contract (golden cases).
5. The runner is pinned to b11118; the key goes through the `LLAMA_API_KEY` environment variable, and startup verifies `/props` returns 401 without it; it binds only to 127.0.0.1 with `--port 0`.
6. Jev `providerId` is the built-in System One registry id; switching the default provider changes only `defaultProviderId`.
7. The engine service depends only on `subprocess`; the provider registers inside a nested `inject(['jev'])`, so a Jev reload only repeats the registration.
8. The card always has exactly one primary button; slow Macs (below `minPrefillTokensPerSecond`, default 150) are never enabled automatically.

## Verified real behavior

- Standard DSH does not load System3/Jev; System3 desktop is a separate frontend repository that loads `deploy/system3/runtime.patch.yml`.
- The `$DSH_HOME` copy of the primary runtime is installed lazily (only on the first `load_workspace_dependencies` call), so the runner path points at the bundled resource directory.
- Under ad-hoc signing llama-server is rejected because its dylibs have no Team ID; with one (simulated) Team ID, Metal works without JIT. Real Developer ID signing and notarization are not yet verified.
- b11118 honors `LLAMA_API_KEY`, not `LLAMA_ARG_API_KEY`.
- Real System3 requests locally: 0.3–0.6 s per question; task.frame with 6 questions 1.6 s; entry 0.56 s (cloud p50 about 0.47 s). See [notes.md](notes.md).
- `isJsonValue` rejects `-0`; choice keys that look like integers map to letters in JS numeric key order.
- `docs/**` in this repository must be bilingual pairs; every handoff edit updates both languages and runs `verify-translation-pairing --write`.

## Verification record (this round)

- `pnpm run typecheck`, `lint`, `hygiene`, `doc-sync`, `constraints` pass.
- Changed packages and previously failing specs: 81 test files, 1,183 tests pass; the repository-wide `test:coverage` gate reports no per-file threshold errors.
- `pnpm run duplication` reports only the clone inside `system3/src/index.ts`, which exists on the base; this branch does not change that file.
- Real e2e: contract + provider (2), engine end to end (1), and bundle composition through the real Loader (1) pass; `optional-bundles.spec.ts` 10/10.
- Remaining full-suite failures are outside this branch's files: brand icon and sidebar artwork tests, macOS signature environment, Windows path resolution, an existing session fixture, and browser or timing-sensitive tests.

## Next milestone checklist

- [ ] User review → commit (Conventional Commits) and PR; flag the UI needing design review (readiness notice, engine card, dock chip, "This device" label)
- [ ] P4: on-device acceptance of a Developer ID signed and notarized build (first download, resume, offline start, delete and reinstall, upgrade)
- [ ] Calibrate `minPrefillTokensPerSecond` on M1/M2 × 8/16 GB; evaluate 9B
- [ ] System3 desktop wiring: insert `reflex-local` (`cloudProviderId: system-one`, `runnerPath` supplied by the frontend) + `api-reflex-local` + `ui-reflex-local` into its profile, and give the card a host location outside the bundle plugin page (the card currently mounts on the bundle page)
- [ ] Invitation card (after 20 decisions, 14-day "Later") needs a Host-side decision count
- [ ] Add `executionDomain` to skill / taskFrame / completionReview receipts so the dock label covers every decision
- [ ] Toasts keep timing while the window is hidden: the shared Toast component needs visibility-aware timing
- [ ] Merge the dock preparation chip into the System3 decision row: System3's row must expose a slot for other plugins
- [ ] User guide page for the local decision engine and its privacy scope (`docs/user/guide`)

## Branch and state

- Worktree `.Codex/worktrees/feat-local-jev-mlx`, branch `worktree-feat-local-jev-mlx`, based on `main` at the time of branching; all changes are uncommitted.
- The main checkout has the user's own uncommitted changes (`tasks/lessons.md`, `tasks/todo.md`, `docs/main/`, `tasks/main/`); do not touch them.
- Test weights and the runner live in the session scratch directory, not in the repository.

## Cold-start checklist

1. Read [impl-spec.md](impl-spec.md) (package split, interfaces, measured decisions).
2. Read [../local-jev-mlx-design.md](../local-jev-mlx-design.md) and the experience draft `local-inference-experience.html`.
3. Read "Verified real behavior" above and [lessons.md](lessons.md).
4. `pnpm install`; run `pnpm vitest run packages/experimental/reflex-local packages/experimental/client-ui-reflex-local`.
5. Real e2e: set `REFLEX_LOCAL_RUNNER`, `REFLEX_LOCAL_WEIGHTS` (and `REFLEX_LOCAL_URL`/`REFLEX_LOCAL_KEY`), then run `pnpm vitest run --config vitest.e2e.config.ts packages/experimental/reflex-local packages/experimental/reflex-local-bundle`.
