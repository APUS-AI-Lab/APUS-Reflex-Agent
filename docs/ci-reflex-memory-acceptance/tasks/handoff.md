# ci-reflex-memory-acceptance handoff

English | [中文](handoff.zh.md)

## TL;DR

This worktree makes main's Independent harness workflow run the Continuum memory unit tests and recorded sessions, and adds an opt-in live Jev memory acceptance job. The live script now checks ranking, admission of facts versus chatter, and threshold recall against a real Jev gateway. Keyless checks pass locally and in pull request CI; the live script passed four consecutive runs against `APUS-OpenJev-v1-9B-5949`.

## Deliverables

- `.github/workflows/independent-harness.yml`: the `Jev and System3` job adds `packages/context/continuum/tests`, `packages/experimental/continuum-jev/tests`, `packages/session-query/tool-history-recall/tests`, and the five `continuum-*` recorded sessions; the new `jev-live` job runs when the `CONTINUUM_JEV_ENDPOINT` repository variable is set and fails when the model variable or key secret is missing.
- `scripts/continuum-live-e2e.ts`: adds two admission batches (two facts, two chatter messages) and one threshold recall to the existing ranking check.
- `packages/experimental/continuum-jev/README.md`, `README.zh.md`, `README.i18n.yaml`: the live acceptance scope.

## Constraints

- The live job never runs for forked or Dependabot pull requests, which never receive secrets.
- The endpoint and model come from repository variables, not the workflow file, so a Pod move changes no code.

## Observed behavior

- Workspace packages export `lib/`, so `tsx scripts/continuum-live-e2e.ts` needs `build:native-system` and `build:lib:host` first.
- Before this change, main's CI ran no Continuum test on push; only pull requests ran the full `ci.yml` suite.

## Local evidence

- `vitest run` over the ten directories of the CI step: 110 files, 1930 tests passed.
- `test:snapshot` with the CI filter: 15 passed, including five Continuum sessions.
- `tsc -b tsconfig.host.json`, `actionlint`, and `doc-sync` (42 gates) passed.
- Live script, four runs: every run admitted `dentist` (`health`, `plans`, `dates`) and `budget` (`money`, `preferences`), indexed no chatter, and recalled only `dentist`; ranking took 1.8–3.3 s, each admission batch 0.9–1.6 s, and recall 0.46–1.2 s.

## Next tasks

- [x] Run the live script against `APUS-OpenJev-v1-9B-5949`.
- [ ] Set the `CONTINUUM_JEV_ENDPOINT` and `CONTINUUM_JEV_MODEL` variables and the `CONTINUUM_JEV_API_KEY` secret in the repository.
- [x] Merge after the pull request checks and the live run pass.
- [ ] Rebuild the leaderboard runtime from the merged main and rerun its preflight.

## Branch status

Branch `worktree-ci-reflex-memory-acceptance` starts at `origin/main` after pull request #28.

## Cold start

1. Read this handoff.
2. Run `git fetch origin` and compare `origin/main` with the branch base.
3. Run the live script with the three `CONTINUUM_JEV_*` variables set.
