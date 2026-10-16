# feat-local-jev-mlx implementation plan

English | [中文](todo.zh.md)

2026-10-14 user instruction: "fully connect the supporting UI/UX, services, and packaging for this local inference". The 6 product confirmation items follow the design document's defaults: mac-arm64 only; no mandatory key when the user is logged in and has a usable generation route; weights come from Hugging Face + hf-mirror; local failures never fall back to the network automatically; a passing self-test enables automatically and can be undone; this repository pins and maintains the runner version.

## Design deviations found during implementation

- The desktop currently **does not load System3 or Jev** (only the Web deployment through `deploy/system3/runtime.patch.yml` loads them). So "local decisions" have no consumer on the desktop, and the design's two prompt moments "unstable cloud / privacy block → switch to local" do not exist on the desktop.
- The delivery form therefore changes to an **optional bundle** "local decision engine" (same path as `voice-input-bundle`, added to `OPTIONAL_BUNDLES`): turning it on loads Jev (default provider is local) + the local engine + System3 (`privacyMode: local-only`, `jevExecutionDomain: local`, enabling only decision points that do not depend on cloud routes) + dock.
- Guidance narrows to: plugin page toggle → activation notice → single-primary-button card (download and enable → progress/pause → self-test → enabled + undo) → dock "local" marker.

## Packages and changes

- [x] `apus-dsh-jev-plugin`: `endpoint`/`model` may be omitted; when omitted, the built-in System One is not registered and `providerId` only selects the default (docs + tests)
- [x] `reflex-local` (Host): configuration, `runtime/assets.json` (pinned revision + sha256), Range-resume download, llama-server process (`--port 0` + random key + `/health`), contract rendering (Python `json.dumps` equivalent + golden samples), Jev provider (questions serialized, score→choice, noul, >16 rejected, missing candidate reports invalid-response), preparation state machine (check/download/pause/verify/self-test/enable/disable/delete), `ctx.reflexLocal` service
- [x] `api-reflex-local`: Typert Remote `reflexLocal/*` (follow/prepare/pause/cancel/enable/disable/remove)
- [x] `client-ui-reflex-local`: `plugins.bundle.config` single-primary-button card + `plugins.bundle.activation` activation notice + locales
- [x] `reflex-local-bundle`: `cordis.patch.yml` + icon + locale; add to `OPTIONAL_BUNDLES` and cli/desktop dependencies
- [x] runner platform package `llama-server-darwin-arm64`: build-time download of b11118 + sha256 check + soname materialization; desktop packaging signs it
- [x] `client-ui-system3`: dock decision row "local" marker
- [x] Readiness dialog: `ui-settings-models/src/client/index.ts:81`, `onboarding-state.ts:228`, `welcome-api.ts:53-66`
- [ ] Documentation: each package README (Chinese and English + i18n.yaml), `packages/README.md`, user guide

## Verification

- [x] Focused tests per package + `test:coverage` (100% per file)
- [x] `typecheck` / `lint` / `duplication` / `hygiene` / `doc-sync`
- [x] Local e2e: real llama-server + 4B Q8_0 running the three primitives; golden samples byte for byte
- [ ] Desktop packaging smoke test: llama-server starts from the signed runtime directory

## Review

- Done: every package and change above, with these adjustments: the runner ships in the desktop primary runtime instead of an npm platform package; Jev gained `defaultProviderId`; the readiness fix landed in `AccountOnboarding.tsx` (not `onboarding-state.ts`) and `welcome-api.ts` keeps its logic by design; the dock shows "This device / Cloud" for entry decisions only.
- Verification: `typecheck`, `lint`, `hygiene`, `doc-sync`, `constraints` pass; 81 spec files / 1,183 tests across the changed packages pass; the repository-wide coverage gate reports no per-file threshold errors; real e2e (contract + provider, engine, Loader composition) pass. `duplication` reports only a clone inside `system3/src/index.ts` that already exists on the base.
- Remaining full-suite failures are in areas this branch does not touch (brand icon and sidebar artwork tests, macOS signature environment, Windows path resolution, an existing session fixture, browser and timing-sensitive tests).
- Not done: the user guide page; a full desktop packaging smoke (only the runner staging step ran on this Mac); Developer ID signing and notarization (P4).
