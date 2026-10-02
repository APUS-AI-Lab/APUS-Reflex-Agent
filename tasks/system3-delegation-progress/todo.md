# system3-delegation-progress todo

Base: branch `feat-system3-g1`. Order follows [architecture section 11](../../docs/feat-system3-g1/architecture.html#next).

## Slice 0 · entry evaluation

- [x] Update the unified architecture page (sections 02, 05, 07, 08, 10, 11) and re-scope the recovery plan.
- [x] Labelled task set: `packages/experimental/system3/tests/fixtures/entry-routing-eval.tasks.json`.
- [x] Real-Jev evaluation: `packages/experimental/system3/tests/entry-routing-eval.e2e.ts`, self-skipping without `JEV_API_KEY`.
- [x] Run it and record the report under `docs/system3-delegation-progress/`.

## Slice 1a · provider activity (live)

- [ ] `onActivity` in the Codex and Claude Code providers at the points that discard notifications.
- [ ] Live event `subagent/activity` with redacted summaries; parse failures never fail the run.
- [ ] AG-UI forwarding filtered by parent session.
- [ ] Unit tests at 100% per-file coverage for touched files; README updates.

## Slice 1b · parent-session milestones and progress card

- [ ] Persistent start / end / throttled milestone events, persistence-type acknowledgement, both SDK expected outputs, keyless snapshot.
- [ ] Projection and System3Dock progress card.
- [ ] Delegation suggestion injected at pre-step, with its persistent decision record.

## Slice 2 · delegation supervision

- [ ] Design only after slice 0 and 1 results.
