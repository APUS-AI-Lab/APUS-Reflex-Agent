# System3 decision method: entry decisions, process control, and evaluation

English | [中文](decision-method.zh.md)

## Summary

System3 rests on two capabilities: entry decisions answer "who should handle this", and process control answers "how does the work stay on track once handed off". Both share one foundation: every decision and outcome becomes a Session fact that feeds the evaluation set. This page records the method's rules, the measured data, and what remains unproven. Implementation status follows the [unified architecture](../feat-system3-g1/architecture.html).

## Contents

- [Shared principles](#shared-principles)
- [Entry decisions](#entry-decisions)
- [Process control](#process-control)
- [Evaluation and calibration](#evaluation-and-calibration)
- [Fact foundation](#fact-foundation)
- [Measured data](#measured-data)
- [Not yet proven](#not-yet-proven)

<a id="shared-principles"></a>
## Shared principles

- Rules first: whatever a deterministic rule can decide, a rule decides; Jev chooses or abstains only among the legal candidates the rules leave, and cannot override a hard condition.
- Failure returns to the baseline: when Jev times out, is unavailable, abstains, or answers below the confidence threshold, the baseline applies and a late result has no effect.
- Suggestion, adoption, actual execution, and result verification are four different facts, recorded separately and never substituted for each other.
- Speed is part of the experience: the person should see an explanation the moment the decision completes, and any wait needs a reason.
- Benefit requires a controlled comparison: no Jev benefit is claimed before three-arm comparison data exists.

<a id="entry-decisions"></a>
## Entry decisions

The entry decides who receives the input before any model starts. Routes fall into three kinds: model tiers, local models, and delegation to specialist agents. Each tier holds one model, and tiers differ clearly in capability and cost; otherwise even an accurate decision cannot pay for its own latency.

| Layer | What it does | Owner |
|---|---|---|
| ① Hard rules | No routing while a model is fixed by hand; candidates must accept every input modality present in the Session (image input only once an image appears); context capacity and reasoning effort checks; delegation candidates offered only while the provider is registered and the tool is visible to the current Agent | Session Controller and System3 admission |
| ② Privacy | Decide whether the input may leave the machine; if not, keep only local candidates and do not call a network Jev | Local rules or a local model (not implemented) |
| ③ Choose the route | Jev chooses one remaining candidate or abstains | Jev 9B |
| ④ Follow-ups | When Jev abstains or answers below the threshold, continue the previous model route; provider failures still return to the baseline; delegation is never continued | System3 entry routing |
| ⑤ Adoption and explanation | A model route switches this input's model; a delegation route keeps the model and injects one instruction, leaving the tool call to the model; the pre-written route label appears as soon as the decision is recorded | Harness and Client |

**Speed rules:**

- Jev decides in about 0.45 s on a warm connection and about 1.5 s more on a cold one. Use a long-lived connection (HTTP/2, long keep-alive) and send light warm-up requests for a window after each turn ends.
- Show the label the moment the decision completes, such as "Routed: complex specialist task · GPT-5.6 Sol"; while a new submission waits for its decision, do not show the previous input's route.
- Consider starting Flash in parallel with Jev, or changing Jev's network path, only if the server's measured p95 still visibly slows simple questions.

**Delegation rules:**

- Delegation is one kind of entry candidate, not a separate decision procedure.
- A candidate's description states the task size it covers; small single-file changes should not be delegated (see [Not yet proven](#not-yet-proven)).
- When an external agent is unavailable, the entry decision falls back to owned models.

<a id="process-control"></a>
## Process control

After hand-off, process control keeps progress visible, intervenes when work stalls, and verifies results before delivery.

**Visible progress:**

- A subagent reports each step as a category and phase (command, file change, tool, message, reasoning), never with content, paths, tool input, or credentials.
- Live events serve directly connected clients such as AG-UI; throttled persistent progress snapshots in the parent Session drive the Web and Desktop progress card and survive a refresh.
- A subagent may take more than 20 s to report its first step, so the interface shows "started" before then.

**Stall rules (deterministic hard rules, from the agent-jev-pilot validation work):**

| Condition | Action |
|---|---|
| The same error appears 2 or more times, or 3 or more attempts in total | Request input from the person |
| No new evidence was produced | Change strategy or executor |
| Steps or time exceed the budget without progress | Choose among continue, request input, and change executor |
| Acceptance facts are missing | Do not judge the task complete |

Jev advises only on top of these rules; the rule outcome takes precedence. A real test once saw the model search blindly for a file for 6 min 11 s before asking the person, which is the case these rules cover.

**Hand-off:** when the executor changes, hand over a recoverable context packet that separates excerpts kept verbatim from excerpts kept only as an index, with hashes of the originals so they can be read back.

**Verification before delivery:** the main model or an independent check re-verifies delegated results (for example by rerunning tests) before replying; without verification evidence the interface does not show "done".

<a id="evaluation-and-calibration"></a>
## Evaluation and calibration

The evaluation method comes from the agent-jev-pilot calibration process and prevents "it runs, but its value is unproven".

- Three frozen arms: a fixed baseline (for example always Pro, or never delegate), a deterministic rule, and Jev, with identical candidates, materials, permissions, and budgets.
- Independent acceptance: a check unrelated to the system under test judges the result; a correct decision log never stands in for task completion.
- Complete pairs only: when one arm fails or lacks data for a task, that task does not enter the benefit comparison.
- Insufficient evidence is not a pass; unknown usage is not recorded as 0.
- Metrics: decision agreement with labels, answering-model agreement, abstention rate, follow-up misrouting rate, latency p50/p95, task pass rate, and total time and cost per successful task.
- Abstentions, timeouts, wrong completions, and missing key evidence are reported separately.
- State when people assigned the labels, report adversarial inputs separately, and mark a rule arm written against the test set as an optimistic bound.

<a id="fact-foundation"></a>
## Fact foundation

Every decision is a Session event; the interface and the evaluation derive from these facts:

| Fact | Record |
|---|---|
| Suggestion | `system3/entry-decision`: the complete Jev request and response, outcome, chosen or retained candidate and label, delegation target, elapsed time |
| Adoption | `model/automatic-selection`; for delegation, the instruction message attributed to `system3-delegation` |
| Actual execution | The answering model; the delegation tool call |
| Progress | Delegation progress snapshots in the parent Session |
| Result | Artifacts and independent check results |

<a id="measured-data"></a>
## Measured data

All measured on 2026-10-02 on a development Mac against the real Jev and the Fidoo proxy; the server has not been measured.

| Item | Result |
|---|---|
| Two-tier entry evaluation (50 inputs) | 48/50 decisions match labels; 11 of 12 follow-ups abstain |
| Four-tier entry evaluation (30 inputs) | 29/30 match; the only miss is a strict proof answered at confidence 0.79, below the threshold |
| Jev latency on a warm connection | 0.44–0.50 s; low and high effort differ little |
| In-product entry decisions | About 2 s before warm-up; 0.49 / 0.86 / 1.22 / 1.25 s after |
| Delegation end to end | A coding task routed to Codex in 0.69 s; instruction injected, tool called, fix and tests added, 5/5 tests pass, 108 s total |
| Real user flow | Simple question 4.3 s; a hard design question answered by GPT-5.6 Sol in 21 s; "continue" kept the previous model |

<a id="not-yet-proven"></a>
## Not yet proven

- Whether higher tiers answer their tasks better, and cost per successful task: the evaluation scores only the routing decision.
- The delegation threshold: in the real test the main model itself noted the task was a one-line fix; Flash alone would likely take about 20 s, while delegation took 108 s. A three-arm comparison (Flash alone / always delegate / Jev) must set the threshold.
- The entry latency distribution on the server.
- Local models and per-input privacy decisions: not implemented.
- Automatic Skill selection in a real user environment: the user-level directory holds 115 Skills, above the limit of 32, so automatic selection does not run; a shortlist step must come before Jev's final choice.
- The agent-jev-pilot data shows no net benefit from Jev choosing context excerpts, so context selection is not a System3 Jev decision point.
