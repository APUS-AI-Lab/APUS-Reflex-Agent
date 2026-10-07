# system3-delegation-progress handoff

## TL;DR

- Worktree `.claude/worktrees/system3-delegation-progress`, branch `worktree-system3-delegation-progress`, based on branch `feat-system3-g1`. Nothing is pushed.
- Done: architecture page reordered; slice 0 (entry evaluation, real Jev); slice 1a (live subagent step activity for Codex and Claude Code, AG-UI forwarding).
- Next: slice 1b (parent-session milestones, progress card, Jev delegation suggestion), then slice 2 (delegation supervision).

## Delivered this round

| Path | Content |
| --- | --- |
| `docs/feat-system3-g1/architecture.html` | v1.1: sections 02, 05, 07, 08, 10, 11 updated; delegation progress contract; new slice order |
| `docs/feat-system3-g1/process-recovery-plan.html` | Marked as re-scoped into slice 2 |
| `packages/experimental/system3/tests/entry-routing-eval.e2e.ts` and `tests/fixtures/entry-routing-eval.tasks.json` | 50 labelled inputs, real-Jev evaluation, self-skips without `JEV_API_KEY` |
| `docs/system3-delegation-progress/entry-eval.md` (+ `.zh.md`, report JSON) | Evaluation result and limits |
| `packages/subagent/subagent/src/{types,lifecycle,index}.ts` | `reportActivity` on the provider request; scoped live event `subagent/activity` |
| `packages/subagent/subagent-codex/src/{wire,run}.ts` | Item categories from `item/started` and `item/completed` |
| `packages/subagent/subagent-claude-code/src/run.ts` | Assistant block and tool-call categories |
| `packages/experimental/agui/src/{run,agui}.ts` | `CUSTOM dsh.subagent.activity`; out-of-process runs followed by delegating parent |

## Design constraints

- Activity payloads carry a category and phase only. No child text, commands, paths, tool input, or results cross the provider.
- Activity is live and not written to any Session. It never enters a parent model request.
- The seam publishes activity only between a run's `subagent/start` and `subagent/end`.
- A malformed `item/started` is skipped; it must never fail a run.
- New persistent events in slice 1b need the persistence-type acknowledgement, both SDK expected outputs, and a keyless snapshot.

## Observed behavior

- Entry routing: 48 of 50 decisions match labels; p50 467 ms, p95 1211 ms; follow-ups abstain by design, so a follow-up to a hard task stays on Flash.
- The Web and Desktop session stream carries persistent Session events and assistant stream only; a live event cannot reach those clients. AG-UI can forward live events.
- Out-of-process runs have no Session, so `subagentCatalog` views do not list them.
- Real Codex run: first step about 22 s after start. The bundled Codex CLI rejects the local default model for ChatGPT accounts; set the provider `model`.
- A fresh worktree needs `pnpm install` and `pnpm run build:native-system` before the subagent suites pass.
- `test:snapshot`: `browser-use-stagehand-native` fails here with a Node loader-hook error in its fixture; not compared against the base branch.

## Next milestone checklist

- [ ] Persistent parent-session milestones for external runs (start, end, throttled phase changes) with projection.
- [ ] System3Dock progress card in `client-ui-system3`; started state visible before the first step.
- [ ] Jev delegation suggestion at pre-step with its decision record; candidates limited to registered providers.
- [ ] Real Claude Code run observed end to end.
- [ ] Medium-difficulty inputs and an answer-quality comparison (Flash versus Pro) in the entry evaluation.
- [ ] Enable `subagent_codex` in the System3 deployment profile with an explicit model.

## Branch and deployment state

Local commits only on `worktree-system3-delegation-progress`. Harness PR #13 and Frontend PR #1 are unchanged. No server or Desktop deployment was touched. The Jev endpoint was called read-only by the evaluation.

## Cold-start checklist

1. Read this file, then `tasks/system3-delegation-progress/todo.md`, then [architecture section 11](../../docs/feat-system3-g1/architecture.html#next).
2. `pnpm install`, `pnpm run build:native-system`.
3. Entry evaluation: source `~/.config/xdan-system3/runtime.env`, then run the command in `docs/system3-delegation-progress/entry-eval.md`.
4. Before pushing: `pnpm run typecheck`, `pnpm run doc-sync`, the affected package tests, `test:snapshot`.
