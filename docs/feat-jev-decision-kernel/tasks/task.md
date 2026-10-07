# feat-jev-decision-kernel — System3 as the agent's steward

English | [中文](task.zh.md)

Approved 2026-10-07: implement all 38 of mu's decision points in seven batches, organized around one task frame shared by every decision. Plan and scenarios: [../steward-plan.html](../steward-plan.html); plain-language comparison: [../mu-product-view.html](../mu-product-view.html); deduplicated top 10: [../top10.html](../top10.html).

## Principles

- One task frame: every decision reads the same goal, verbatim user requirements, and acceptance items instead of guessing them separately.
- Jev judges, actions are direct: Jev answers closed questions; the action that follows is deterministic (switch model, ask for approval, steer, show or hide tools). Text reaching the model or the UI is the user's words or comes from an existing model.
- Visible and reversible: every action shows a one-sentence reason in the dock and can be undone.
- Bad-case regression suite as acceptance: recorded real failures replay before and after each item.
- Evidence before enabling: each decision ships in `shadow`, thresholds come from labelled sets run against the real Jev, and it becomes `active` only after its prd data meets the target. Implemented does not mean enabled; an item without measured benefit stays off with the reason recorded.
- When a target is missed, change the question, not the threshold.
- A failed judgement (timeout, error, privacy denial) always falls back and never blocks the main flow.
- No extra wait: one Jev request per user message (at most 16 questions) carries entry routing, the task frame, clarification, and tool disclosure; other decisions run in parallel with the main model or only after a rule fires. Each item reports its P50 / P95 latency increase.
- Everything that reaches a model is reconstructable from the Session log.
- Every item delivers unit and composition tests (100% coverage of new code), a before/after comparison, and a prd run.
- After the e2e acceptance passes, each item is also checked from the user's side in a real browser on the public prd site: the scenario is typed as a user would, and what the user sees (dock text, approval cards, message placement, latency) is recorded with screenshots.

## Batch 0: foundation

- [x] Decision kernel (`decision-kernel.ts`): questions, thresholds, fallback, off/shadow/active, the `system3/judgement` event; ships with its first consumer in batch 1
- [ ] Bad-case regression suite: replayable sessions for deleting a protected README, `; echo $?` masking a failure, research counted as no progress, a promise left undone, a mid-run correction that waited a whole turn, and an over-long tool list
- [x] Lossless test-log folding (#7): fold byte-identical repeated runs into one line with a back-reference; never call a model; never drop failures or summaries

## Batch 1: task frame, mid-run messages, on-demand tools

- [ ] Task frame (#2) with clarification hints (#1): merged into the entry-routing Jev request; verbatim requirements in the `system3/task-frame` event keyed by the DSH goal id and revision; a task-frame section in the system prompt; visible and deletable in the dock
- [ ] On-demand tools (#5) with Skill disclosure (#4): hide a tool pack only when Jev is confident it is not needed, through `ctx.tools.restrict`; additions only within a task; a request entry restores hidden packs; MCP servers start on demand in a second PR
- [ ] Mid-run message routing (#3): a new admission seam in the session controller before delivery; corrections and additions steer (and reach a running Codex), side questions and new tasks queue; an opt-in "decide automatically" setting; an explicit Cmd/Ctrl-Enter choice always wins; separate PR with the architecture update
- [ ] Exit: labelled sets meet their targets; the merged request does not lower entry-routing accuracy; P95 latency increase under 0.3 s; scenarios 1–5 reproduce on prd

## Batch 2: guards

- [ ] Constraint check (#19), dangerous-command review (#17), semantic approval (#18) in one pre-execute request; delegated-change scope (#35); injection detection in external content (#20)
- [ ] Exit: constraint precision ≥ 0.9; the protected-README case is blocked; injection recall ≥ 0.9

## Batch 3: completion, monitoring, routing

- [ ] Completion review (#28), goal met (#31), promised but stopped (#29), drift review (#26), external event timing (#33), board updates on real progress (#32), mid-run route escalation and delegate role (#34)
- [ ] Exit: the 10-06 false positives and the 10-07 miss do not recur; escalation success rate is recorded; route records are usable for later tuning

## Batch 4: context

- [ ] Semantic tool-output pruning (#6), tombstones for old output (#8), scored compaction (#9), main-model cache warming (#16), diagnostics timing (#25)
- [ ] Exit: enabled only when saved tokens exceed the Jev cost and no required content is dropped

## Batch 5: memory

- [ ] Recall (#10), capture (#11), outcome lessons (#12), worth keeping (#13), merge (#14), applied and retired (#15); storage and privacy design review first

## Batch 6: remaining points

- [ ] File location (#21), Jev judgement tool (#22), review triage (#24), browser step (#23), streaming interruption (#30), checkpoint rewind (#27), Hive notes (#36–#38); each runs in shadow for two weeks and is enabled only with positive benefit

## How each of mu's 38 decision points is handled

The article says 35, the number in mu's older README; the code (`packages/kyrn-judge/manifest.json`) has 38.

| # | mu decision point | Batch | # | mu decision point | Batch |
|---|---|---|---|---|---|
| 1 | `input.preflight` | 1 | 20 | `tool.injection` | 2 |
| 2 | `task.frame` | 1 | 21 | `files.locate` | 6 |
| 3 | `input.interjection` | 1 | 22 | `judge.items` | 6 |
| 4 | `skills.disclosure` | 1 | 23 | `browser.step` | 6 |
| 5 | `capability.disclosure` | 1 | 24 | `review.triage` | 6 |
| 6 | `tool.admission` | 4 | 25 | `diagnostics.delivery` | 4 |
| 7 | `tool.admission.test-log` | 0 | 26 | `turn.drift` | 3 |
| 8 | `context.forget` | 4 | 27 | `turn.rewind` | 6 |
| 9 | `context.compact` | 4 | 28 | `turn.completion` | 3 |
| 10 | `memory.recall` | 5 | 29 | `turn.continue` | 3 |
| 11 | `memory.capture` | 5 | 30 | `output.drift` | 6 |
| 12 | `memory.outcome` | 5 | 31 | `goal.met` | 3 |
| 13 | `memory.worth` | 5 | 32 | `board.read` | 3 |
| 14 | `memory.merge` | 5 | 33 | `notify.routing` | 3 |
| 15 | `memory.applied` | 5 | 34 | `swarm.routing` | 3 |
| 16 | `cache.warming` | 4 | 35 | `swarm.patch` | 2 |
| 17 | `tool.risk` | 2 | 36 | `hive.publish` | 6 |
| 18 | `tool.approval` | 2 | 37 | `hive.deliver` | 6 |
| 19 | `tool.constraint` | 2 | 38 | `hive.relate` | 6 |

## Progress log

| Date | Item | Result |
|---|---|---|
| 2026-10-07 | Reopen a stalled Jev connection | Merged in #23; deployed to prd |
| 2026-10-07 | Steward plan | Reviewed and approved |
| 2026-10-07 | Lossless test-log folding (#7) | #25; prd: a failing unittest run folded 131 lines (5,097 characters), the model diagnosed the shared failure correctly; markers quote the first repeated line after the browser check |
| 2026-10-07 | Task frame (#2) and decision kernel | #26; labelled sets of 91 messages against the deployed Jev, final held-out set: keep precision and recall 1.0, new-task precision 1.0 and recall 2/3; prd browser check: requirement kept in 0.54 s, the model saw the card on the next turn and followed it, a switch to an unrelated request started a new frame. Clarification hints (#1) are not done yet |
