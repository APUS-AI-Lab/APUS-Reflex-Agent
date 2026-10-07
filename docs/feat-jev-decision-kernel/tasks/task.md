# feat-jev-decision-kernel — absorbing mu's reusable capabilities

English | [中文](task.zh.md)

Approved 2026-10-07: the user asked to absorb every capability worth borrowing from mu. Design: [../design.html](../design.html); comparison: [mu-comparison.html](../../system3-delegation-progress/mu-comparison.html).

## Principles

- Evidence before enabling: every new decision ships in `shadow` (record only), thresholds come from labelled sets run against the real Jev, and a decision becomes `active` only after its prd data meets the target.
- When a target is missed, change the question, not the threshold.
- A failed judgement (timeout, error, privacy denial) always falls back and never blocks the main flow.
- Everything that reaches a model is reconstructable from the Session log: judgements go to `system3/judgement`, constraints to `system3/constraint`.
- Existing decisions (entry routing, Skill selection, hand-off pack) keep their event formats until the last migration phase.
- Every item delivers unit and composition tests (100% coverage of new code), a before/after comparison, the full unit suite (only the three known upstream failures allowed), and a prd run.

## Phase 1: foundation and two independent items

- [ ] 1. Decision kernel `decision-kernel.ts`
  - Spec: id, version, mode (off/shadow/active), deadlineMs, questions, decide, fallback
  - Shared thresholds: yes/no thresholds with an unsure band; minimum probability plus an escape choice for choice questions
  - Privacy admission, deadline, and error fallback; the `system3/judgement` event (request, response, outcome, whether applied, duration)
  - Configuration: `decisions.<id>: { mode, thresholds, deadlineMs }`
- [ ] 2. Reopen a stalled Jev connection (mu `judge-fetch`)
  - Rebuild the pool after N consecutive requests without a response, and log it
  - Comparison: on a simulated stalled connection, decisions keep falling back before the change and recover after it
- [ ] 3. Lossless test-log folding (mu `tool.admission.test-log`, rules arm)
  - Fold byte-identical repeated runs into one line with a back-reference; never call a model; never drop failures or summaries
  - Measure the fold rate on real test output and confirm no failure line is lost

## Phase 2: constraints (mu `task.frame` + `tool.constraint`)

- [ ] 4. Constraint recognition: one yes/no question per user message (the hand-off pack's validated wording), written to `system3/constraint`, keeping the latest six; runs in parallel without adding wait
- [ ] 5. Constraint check: in `tools/pre-execute`, check write/edit/delegation and non-read-only bash calls against the constraints; shadow records and shows a dock notice, active returns `ask` (the native approval card quotes the user's words)
- [ ] 6. The hand-off pack reads the constraint list
- [ ] Labelled set: 20 call × constraint samples (including near misses); target precision ≥ 0.9

## Phase 3: supervision review (mu `turn.completion` / `turn.drift`)

- [ ] 7. After a rule fires, ask Jev through the kernel whether the agent is really stuck or missing verification; confirmed findings advise, rejected ones only record, unsure ones advise as the rule does today
- [ ] Labelled set: 20 real traces including the two 10-06 false positives, the 10-07 miss, and genuinely stuck runs

## Phase 4: task frame (complete mu `task.frame`)

- [ ] 8. Maintain goal, verbatim constraints, and acceptance items; classify a new message as a new task, an added constraint, or a correction
- [ ] 9. The missing-verification reminder and the hand-off pack read the acceptance items

## Phase 5: remaining decision points (evaluated one by one, shadow first)

- [ ] 10. Classify mid-run messages (mu `input.interjection`): corrections become steers, additions become follow-ups
- [ ] 11. Injection detection in external content (mu `tool.injection`): judge web_fetch / web_search results segment by segment for instructions aimed at the AI
- [ ] 12. A Jev batch-judgement tool the model can call (mu `judge_items`)
- [ ] 13. Continue when the model promised work but stopped (mu `turn.continue`)
- [ ] 14. Migrate existing decisions to the kernel (entry routing, Skill selection, hand-off pack; needs a persistence-format review)
- [ ] 14a. Strengthen existing items: clarification / plan-first hints (#1), hiding irrelevant Skills (#4), Jev review of dangerous commands (#17), Jev approval mode (#18), delegated-change scope check (#35)

## How each of mu's 38 decision points is handled

The article says 35, the number in mu's older README; the code (`packages/kyrn-judge/manifest.json`) has 38 after `tool.injection`, `turn.continue`, and `judge.items` were added on 2026-10-05. "Exists" means System3 or DSH already has an equivalent or stronger implementation and only the gap is added; items with weak evidence are absorbed too, but ship in shadow and are enabled only after their benefit is measured.

| # | mu decision point | Plan | Phase |
|---|---|---|---|
| 1 | `input.preflight` | Exists (entry routing switches the model); add clarification / plan-first hints | 5 |
| 2 | `task.frame` | Absorb: constraint recognition + task frame | 2, 4 |
| 3 | `input.interjection` | Absorb: classify mid-run messages | 5 |
| 4 | `skills.disclosure` | Exists (Skill selection, opposite direction); add hiding irrelevant Skills | 5 |
| 5 | `capability.disclosure` | Absorb: enable tool packs / MCP on demand | 6 |
| 6 | `tool.admission` | Absorb (shadow): mu's own replay pruned nothing, so net benefit must be shown first | 6 |
| 7 | `tool.admission.test-log` | Absorb: lossless rules-arm folding | 1 |
| 8 | `context.forget` | Absorb (shadow): shrink old tool output to tombstones | 6 |
| 9 | `context.compact` | Absorb (shadow): compaction that drops tool output by score | 6 |
| 10 | `memory.recall` | Absorb: recall lessons | 7 |
| 11 | `memory.capture` | Absorb: record lessons from corrections | 7 |
| 12 | `memory.outcome` | Absorb: record lessons from fail-then-succeed turns | 7 |
| 13 | `memory.worth` | Absorb: decide whether a lesson is worth keeping | 7 |
| 14 | `memory.merge` | Absorb: deduplicate lessons and resolve contradictions | 7 |
| 15 | `memory.applied` | Absorb: track whether lessons are applied and retire unused ones | 7 |
| 16 | `cache.warming` | Exists (Jev connection warming); add main-model cache warming | 6 |
| 17 | `tool.risk` | Exists (permission presets and sandbox); add Jev review of dangerous commands | 5 |
| 18 | `tool.approval` | Absorb: Jev approval mode | 5 |
| 19 | `tool.constraint` | Absorb: check user constraints before changes | 2 |
| 20 | `tool.injection` | Absorb: injection detection in external content | 5 |
| 21 | `files.locate` | Absorb: file-location ranking tool | 6 |
| 22 | `judge.items` | Absorb: batch-judgement tool for the model | 5 |
| 23 | `browser.step` | Absorb (shadow): next browser step | 7 |
| 24 | `review.triage` | Absorb: rank code-review findings | 6 |
| 25 | `diagnostics.delivery` | Absorb: when to deliver post-edit diagnostics | 6 |
| 26 | `turn.drift` | Exists (supervision rules); add Jev review | 3 |
| 27 | `turn.rewind` | Absorb: propose returning to a checkpoint at a dead end (user confirms) | 6 |
| 28 | `turn.completion` | Exists (missing-verification reminder); add Jev review | 3 |
| 29 | `turn.continue` | Absorb: continue when the model promised work but stopped | 5 |
| 30 | `output.drift` | Absorb (shadow): interrupt streaming output that breaks a rule | 7 |
| 31 | `goal.met` | Exists (native goal package); add Jev judgement of goal completion | 6 |
| 32 | `board.read` | Exists (System3 dock, stronger); add "update only on real progress" | 6 |
| 33 | `notify.routing` | Exists (delegation alerts); add delivery timing for external events | 6 |
| 34 | `swarm.routing` | Exists (delegation candidate); add role and strength selection | 7 |
| 35 | `swarm.patch` | Absorb: check whether delegated changes stay in scope | 5 |
| 36 | `hive.publish` | Absorb: share findings between agents | 7 |
| 37 | `hive.deliver` | Absorb: deliver notes between agents | 7 |
| 38 | `hive.relate` | Absorb: corrections and contradictions between agent notes | 7 |

## Phase 6: context and tool layer (all shadow first)

- [ ] 15. Enable tool packs / MCP on demand (#5)
- [ ] 16. Semantic tool-output pruning (#6), tombstones for old output (#8), scored compaction (#9): record judgements only, measure saved tokens and wrongly dropped content, enable only when the net benefit is positive
- [ ] 17. Main-model cache warming (#16), file-location tool (#21), review triage (#24), diagnostics delivery (#25)
- [ ] 18. Checkpoint rewind proposal (#27), goal completion (#31), board updates (#32), external event delivery (#33)

## Phase 7: memory, multiple agents, and the browser (all shadow first, each with its own design review)

- [ ] 19. The six memory items (#10–#15): storage location, privacy, and cross-session boundaries need a design first
- [ ] 20. Agent role and strength (#34), the three Hive items (#36–#38)
- [ ] 21. Next browser step (#23), streaming-output interruption (#30)

## Progress log

| Date | Item | Result |
|---|---|---|
