---
description: "Theory, hypotheses, method and measured results for Reflex pre-decisions: a fast decision model that takes predictable work off the main model's serial loop."
---

# Reflex pre-decision: theory and evaluation framework

English | [中文](README.zh.md)

## Summary

An agent answers by alternating model calls and tool calls, so most of its time is a serial chain of round trips. Many of those round trips only gather facts whose need is predictable from the input. Reflex pre-decision lets a small, fast decision model (Jev) choose those facts, and Skills, before the first main-model call, while read-only commands fetch every candidate in parallel. The main model then starts from the facts. This page states the latency model behind the design, the principles it implies, the hypotheses, the benchmark method, the results measured so far, and the next iterations. It is the working frame for a paper; numbers carry their date and benchmark.

## Table of Contents

- [Problem and latency model](#problem-and-latency-model)
- [Design principles](#design-principles)
- [Mechanisms](#mechanisms)
- [Hypotheses](#hypotheses)
- [Method](#method)
- [Results](#results)
- [Threats to validity](#threats-to-validity)
- [Iteration loop](#iteration-loop)
- [Related work](#related-work)
- [Dev Note](#dev-note)

-----

<a id="problem-and-latency-model"></a>
## Problem and latency model

The model below explains where pre-decision saves time and when it cannot. It treats one user input as one task.

**Native agent.** A task of n steps takes T_native = Σᵢ (Lᵢ + Xᵢ), where Lᵢ is the main model's latency for step i and Xᵢ is the latency of the tools it then calls. Each step depends on the previous one, so the sum is the critical path.

**Predictable gathering.** Some steps only gather facts (read a file, list files, search, read a diff) and their arguments follow from the input and the workspace. Let k be the number of such steps and f the share of T_native they take. A step is on the critical path only because the main model must first decide it.

**Pre-decision.** Before step 1, a rule-based generator proposes m read-only candidate facts; all m commands run in parallel, taking max_j x_j, while the decision model answers m yes/no questions in latency d. The step waits d' = max(d, max_j x_j). When the chosen facts cover what the task needs (a hit, probability h), the k gathering steps disappear: T_reflex ≈ d' + T_native − h·k·(L̄ + X̄) + ε, where ε is the extra prompt latency of the injected facts.

**Break-even and bound.** Pre-decision pays off when h·k·(L̄ + X̄) > d' + ε. With L̄ + X̄ ≈ 1.5–3 s and d' ≈ 0.3–0.6 s, it pays off when h·k exceeds roughly 0.2–0.3. As with Amdahl's law, the speedup is at most 1 / (1 − f + d'/T_native); inputs with no predictable gathering (k = 0, such as small talk) can only lose d'.

**Decision latency.** On the deployed gateway, one request takes about r + q·m, with r ≈ 125 ms of network round trip and q ≈ 30 ms per question, and concurrent requests are served in parallel. Splitting m questions into p parallel requests gives d ≈ r + q·m/p, so the decision cost stays flat as the candidate set grows.

-----

<a id="design-principles"></a>
## Design principles

Each principle follows from a term of the model; each one is implemented and testable.

| Principle | Model term it targets | Rule |
| --- | --- | --- |
| P1 Overlap, never chain | d' | Start the decision and every candidate fetch at once, and overlap them with other pre-step work |
| P2 Generate by rules, choose by model | h, m | Deterministic rules propose concrete candidates with arguments; the decision model only answers yes or no per candidate |
| P3 Parallel questions | d | Send questions as parallel requests; never merge decisions into one larger request |
| P4 Additive, not restrictive | failure cost | Injected facts only add context; the main model keeps every tool, so a miss costs at most the native path |
| P5 Off the critical path when nothing changes | d' when k = 0 | A judgement that cannot change the step's messages, such as intent alone, runs in the background |
| P6 Native fallback | failure cost | A switch, a missing or failing decision service, and the deadline all leave the native path unchanged |
| P7 Logged and replayable | trust | Every model-visible fact and every decision is a Session event, so a run can be audited and replayed without the decision model |

-----

<a id="mechanisms"></a>
## Mechanisms

Each mechanism lives in the System3 package or the Jev plugin and is described in its README; this table maps it to the model.

| Mechanism | Removes | Owner |
| --- | --- | --- |
| Prefetch of read-only facts: pending changes, file list, README, manifest, named files, matching lines, all files of a small folder | k gathering steps | [System3 Reflex prefetch](../../packages/experimental/system3/README.md) |
| Skill pre-selection, grouped for large catalogs | one Skill-loading step | [System3 Skill selection](../../packages/experimental/system3/README.md) |
| Parallel question split (`questionsPerRequest`) | part of d | [Jev plugin configuration](../../packages/experimental/apus-dsh-jev-plugin/README.md) |
| Non-blocking intent judgement | d when no Skill applies | [System3 Skill selection](../../packages/experimental/system3/README.md) |
| Reflex switch and configuration-error fallback | failure cost | [Jev plugin configuration](../../packages/experimental/apus-dsh-jev-plugin/README.md) |
| Prefetched files read through the filesystem and recorded as read, and files with the most search words offered whole | the read before each edit | [System3 Reflex prefetch](../../packages/experimental/system3/README.md) |
| Skill choice confirmed by a per-Skill yes, with `whenToUse` | wrong and missed Skills | [System3 Skill selection](../../packages/experimental/system3/README.md) |

-----

<a id="hypotheses"></a>
## Hypotheses

The hypotheses are stated so that a benchmark run can confirm or reject each one.

- **H1** Pre-decision lowers end-to-end time on tasks with predictable gathering (k ≥ 1) without lowering the success rate.
- **H2** The saving grows with k: fact lookup and code location gain most, multi-step edits gain only their first gathering steps.
- **H3** Inputs with k = 0 lose at most d', and lose nothing when no decision blocks the step (P5).
- **H4** Splitting questions into parallel requests lowers d roughly as r + q·m/p.
- **H5** The approach transfers from code repositories to personal folders once candidates do not assume Git and search terms cover the user's language.

-----

<a id="method"></a>
## Method

The benchmarks run the shipped Headless profile on real endpoints; their drivers and overlays live under [`packages/experimental/system3/tests/fixtures`](../../packages/experimental/system3/tests/fixtures).

- **Arms.** Native DSH, and DSH with Reflex pre-decisions (prefetch, Skill selection, one question per Jev request).
- **Models.** Generation by DeepSeek `deepseek-flash`; decisions by the deployed APUS Reflex model `APUS-OpenJev-v1-9B-5949`.
- **Isolation.** Every task runs in a fresh process and Session over a fresh workspace, so each Jev connection starts cold; this overstates d compared with a long-running product.
- **Interleaving.** Arms alternate within each round to spread provider drift over both.
- **Measures.** Wall time from input to final answer, main-model steps, tool calls, success by a deterministic check on the answer or the workspace, decision latency, and the facts and Skills chosen.
- **Suites.** `scenario-bench` covers a 40-file service (facts, code location, staged changes, Skills, edits with tests, Chinese input, small talk) and a personal folder (schedule, expenses, todos, mail, notes, documents, small talk, edits); `prefetch-bench` and `skill-bench` isolate one mechanism each. `skill-eval` measures Skill selection alone on 48 labelled inputs over a 20-Skill catalog, with or without `whenToUse`. The [scenario benchmark procedure](../../packages/experimental/system3/tests/fixtures/scenario-bench/README.md) gives the commands, variables and iteration steps.

-----

<a id="results"></a>
## Results

All runs below are from 2026-10-14, two rounds per arm unless stated otherwise.

| Run | Native → Reflex total | Speedup | Main-model steps | Success |
| --- | --- | --- | --- | --- |
| Oracle bound: exact facts injected, 5-file repo, 6 tasks | 79.4 s → 24.6 s | 3.2× | 44 → 12 | 12/12 → 12/12 |
| Prefetch, 5-file repo, 6 tasks | 70.3 s → 30.8 s | 2.3× | 39 → 12 | 12/12 → 12/12 |
| Scenario suite, 40-file service, 16 tasks | 319.8 s → 224.9 s | 1.42× | 150 → 76 | 32/32 → 32/32 |
| Personal folder, 10 tasks, before non-Git support | 161.6 s → 171.7 s | 0.94× | 67 → 72 | 19/20 → 18/20 |
| Personal folder, 10 tasks, with non-Git support and Chinese search terms | 186.1 s → 179.2 s (median 8.8 s → 4.6 s) | 1.04× | 71 → 29 | 18/20 → 20/20 |
| Scenario suite, 40-file service, 16 tasks, with Chinese search terms and non-blocking intent | 310.5 s → 189.5 s | 1.64× | 139 → 70 | 32/32 → 32/32 |
| Scenario suite, 40-file service, after observed file reads, hit files and Skill confirmation | 365.9 s → 223.7 s (median 10.0 s → 4.1 s) | 1.64× | 144 → 66 | 31/32 → 32/32 |
| Personal folder, 10 tasks, same iteration | 155.6 s → 93.9 s (median 6.9 s → 3.7 s) | 1.66× | 69 → 24 | 19/20 → 20/20 |
| Skill selection, 48 labelled inputs, 20 Skills with `whenToUse` (decision only) | 39/48 → 46/48 correct | — | — | false selections 1/15 → 0/15 |
| Skill selection, same inputs, Skills without `whenToUse` (decision only) | 39/48 → 44/48 correct | — | — | false selections 1/15 → 2/15 |
| Edits with tests, 40-file service, 2026-10-15, 3 rounds, with hit-annotated single files and explicit-request Skill wording | 166.8 s → 83.7 s | 1.99× | 52 → 22 | 6/6 → 6/6 |
| Skill selection, Skills without `whenToUse`, explicit-request wording (decision only) | 44/48 → 43/48 correct | — | — | false selections 2/15 → 1/15 |

Per category on the 40-file service: fact lookup 1.85×, code location 1.66×, Skills 1.49×, edits with tests 1.42×, staged changes 1.30×, Chinese input 1.21×, small talk 0.70×. The decision took a median of about 0.6 s with cold connections; through a warm connection seven questions took about 340 ms as one request and 260 ms as seven parallel requests. After the second iteration, Chinese input rose to 3.51×, fact lookup to 2.51× and code location to 2.11×; in the personal folder todos reached 2.79×, expenses 2.28× and document lookups 1.66×, while one personal edit with a single 60-second main-model step held the folder total at 1.04×.

**Reading.** H1 and H2 hold on the service: steps halved and every task still succeeded, with the largest gains where gathering dominates. H3 failed before P5: small talk waited for the decision. H5 failed before non-Git support: the personal folder offered no candidates, so Reflex only added latency. After the second iteration H5 holds on gathering tasks: the folder needed less than half the steps and every task succeeded; H3 still fails for small talk, because the prefetch decision blocks the step and sometimes chooses a search for a greeting. In the third and fourth iterations, an edit whose target file was prefetched and recorded as read went straight to the edit tool (3 steps instead of about 9, and 2 steps for a todo edit); when the decision chose no prefetch the edit stayed native. Skill selection depends on authored `whenToUse`: the confirmed choice reached 46/48 with it and 44/48 without it, and without it a review or edit input could still receive the commit-message Skill. Small talk and a one-step email draft got slower (0.48–0.60×), because the decision waits and over-selected facts lengthen the prompt. In the fifth iteration the prefetch `yes` threshold (0.5, 0.7, 0.85) left task totals within noise; 0.85 dropped the small-folder read and made a todo edit take 5–7 steps instead of 2–4. The edit gain came from two other changes: the README offered for an edit now names the search words it contains, so Jev offers it, and a Skill without `whenToUse` is asked as an explicit request, which removed the commit-message Skill from the refund edit (0.98× → 1.93× on that task). Jev still scores commit-message 0.99 for "Review my staged change", and two main-model calls stalled for 605 s and 900 s without an error; those runs are excluded from the totals.

-----

<a id="threats-to-validity"></a>
## Threats to validity

These limits apply to every number above.

- The tasks, workspaces and checks were written by the same team that built the mechanism.
- Two rounds per arm leave single-task variance high; category totals are more stable than single tasks.
- One generation model and one decision deployment were measured; a slower main model raises L̄ and should raise the gain.
- Cold connections overstate d for a long-running product.
- No run compared against other agent products; a claim of being faster than them needs the same tasks and model run through them.

-----

<a id="iteration-loop"></a>
## Iteration loop

Each iteration changes one mechanism, reruns the suites that exercise it, and records the result in [Results](#results). The open iterations, in order of expected gain:

1. Remove the decision wait for small talk entirely by starting the main-model request in parallel and restarting it only when facts or a Skill are chosen.
2. Prefetch again after each tool step, so multi-step edits also skip their later gathering steps; observed file reads and hit files already remove the first read.
3. Ask Skill authors for `whenToUse`, and measure whether a short excerpt of the Skill body helps when it is missing.
4. Calibrate the yes threshold per candidate kind on labelled inputs, trading misses against injected noise.
5. Measure against other agent products on the same tasks.

-----

<a id="related-work"></a>
## Related work

- Speculative Actions (Ye et al., ICLR 2026) predicts next actions with a faster model and keeps them when the slower executor agrees; [paper](https://arxiv.org/abs/2510.04371).
- PASTE speculates tool executions from recurring call patterns; [paper](https://arxiv.org/abs/2603.18897).
- RouteLLM and FrugalGPT route queries between models mainly for cost; a router's own latency limits their speed gains.
- Tool search with deferred loading narrows the tools a model sees; it improves selection and tokens rather than the number of serial steps.
- Amdahl's law bounds the speedup by the share of work the optimization removes; here, the share of predictable gathering.

-----

<a id="dev-note"></a>
## Dev Note

Non-authoritative. "Pre-decision" is used here for decisions taken before the main model's first call of an input; Reflex control decisions during execution (supervision, completion review) are outside this frame. The deployed decision model is sensitive to question wording: a reworded Skill question dropped from 47/48 to 43/48 on the same inputs, so wording changes need an evaluation run.
