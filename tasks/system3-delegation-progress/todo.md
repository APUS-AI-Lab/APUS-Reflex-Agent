# system3-delegation-progress todo

Base: branch `feat-system3-g1`. Order follows [architecture section 11](../../docs/feat-system3-g1/architecture.html#next).

## Slice 0 · entry evaluation

- [x] Update the unified architecture page (sections 02, 05, 07, 08, 10, 11) and re-scope the recovery plan.
- [x] Labelled task set: `packages/experimental/system3/tests/fixtures/entry-routing-eval.tasks.json`.
- [x] Real-Jev evaluation: `packages/experimental/system3/tests/entry-routing-eval.e2e.ts`, self-skipping without `JEV_API_KEY`.
- [x] Run it and record the report under `docs/system3-delegation-progress/`.

## Slice 1a · provider activity (live)

- [x] `reportActivity` on the provider start request; the seam publishes `subagent/activity` only between a run's start and end.
- [x] Codex provider reports item categories from `item/started` and `item/completed`; Claude Code provider reports assistant blocks and tool calls.
- [x] Redacted summaries only (category and phase); a malformed `item/started` is skipped and never fails the run.
- [x] AG-UI forwards `CUSTOM dsh.subagent.activity` and now follows out-of-process runs by their delegating parent.
- [x] Unit tests, README updates in both languages, regenerated catalogs, `doc-sync` 42 / 42, `typecheck`.
- [ ] Real Codex and Claude Code runs observed end to end (needs the provider patches enabled in a profile).

## Slice 1b · parent-session milestones and progress card

- [ ] Persistent start / end / throttled milestone events, persistence-type acknowledgement, both SDK expected outputs, keyless snapshot.
- [ ] Projection and System3Dock progress card.
- [ ] Delegation suggestion injected at pre-step, with its persistent decision record.

## Slice 2 · delegation supervision

- [ ] Design only after slice 0 and 1 results.

## Review · 2026-10-02

- Slice 0: 50-input evaluation run twice against the deployed Jev with identical decisions; results in `docs/system3-delegation-progress/entry-eval.md`.
- Slice 1a: touched files in the three subagent packages stay at 100% coverage; 990 tests across subagent, AG-UI, scope and System3 pass.
- `test:snapshot`: 177 pass; `browser-use-stagehand-native` fails in this worktree with a Node loader-hook error inside its fixture, in code this branch does not touch. Not yet compared against the base branch.
- `packages/experimental/agui/src` is below the per-file coverage threshold before and after this change.
