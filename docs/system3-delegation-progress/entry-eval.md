# System3 entry-routing evaluation · 2026-10-02

English | [中文](entry-eval.zh.md)

Source: `packages/experimental/system3/tests/entry-routing-eval.e2e.ts` over two task sets: `tests/fixtures/entry-routing-eval.tasks.json` (two tiers) and `tests/fixtures/entry-routing-eval.tiers.json` (the four deployed tiers). Raw output: [entry-eval-report.json](entry-eval-report.json).

Run: `SYSTEM3_ENTRY_EVAL_REPORT=<path> pnpm exec vitest run --config vitest.e2e.config.ts packages/experimental/system3/tests/entry-routing-eval.e2e.ts`

## Setup

- Router: the shipped `createSystem3EntryRouter`, unchanged; Jev `APUS-OpenJev-v1-9B-5949`, effort high, `minConfidence` 0.8 and candidate descriptions as in `deploy/system3/runtime.patch.yml`.
- 50 public inputs: 14 simple, 14 hard, 12 follow-ups that refer to history the router does not receive, 10 adversarial (5 short hard questions, 5 long simple requests).
- Baseline is Flash, so only a `reasoning` decision changes the answering model.

## Result

| Measure | Jev | Always baseline | Keyword / length rule |
| --- | --- | --- | --- |
| Decision matches label | 48 / 50 | 12 / 50 | 40 / 50 |
| Answering model matches label | 49 / 50 | 31 / 50 | 40 / 50 |
| Adversarial subset, answering model | 9 / 10 | 5 / 10 | 0 / 10 |
| Follow-ups routed instead of abstaining | 1 / 12 | 0 / 12 | 0 / 12 |

Outcomes: 38 selected, 10 abstain, 2 low-confidence, 0 transport failures. Latency from this Mac to the Runpod endpoint: p50 467 ms, p95 1211 ms, max 1932 ms. A second run produced the same 50 decisions.

The two misses: `follow-07` ("换成英文") selected Flash, which is also the baseline; `short-hard-03` fell below 0.8 confidence and kept Flash.

## Four tiers

The deployed profile routes among four tiers through the same proxy: `fast` (deepseek-v4-flash, the baseline), `reasoning` (deepseek-v4-pro), `expert` (gpt-5.6-sol-relay), and `frontier` (gpt-6-sol-relay). The set has 6 inputs per tier and 6 follow-ups.

| Measure | Jev | Always baseline |
| --- | --- | --- |
| Decision matches label | 29 / 30 | 6 / 30 |
| Answering model matches label | 29 / 30 | 12 / 30 |
| Follow-ups routed instead of abstaining | 0 / 6 | 0 / 6 |

Outcomes: 23 selected, 5 abstain, 2 low-confidence. Latency p50 482 ms, p95 1323 ms. The miss is `frontier-03`, a strict inequality proof answered `frontier` at confidence 0.79, below the 0.8 threshold, so it kept Flash. 17 of 30 inputs leave the baseline.

The evaluation routes with `retainOnAbstain` off to score Jev's own decisions. The deployed profile turns it on, so a follow-up continues the previous route.

## What this does and does not show

- Jev separates simple from hard inputs on this set and abstains on context-dependent follow-ups, at about half a second per decision.
- The rule was written with the first 40 inputs and the adversarial inputs were chosen to defeat it. Its 0 / 10 is by construction; the comparison shows that length and keywords are not enough, not how a tuned rule would do.
- Labels were assigned by the set's author. There are no medium-difficulty inputs.
- The evaluation scores the routing decision. It does not measure whether Pro answers the hard inputs better than Flash, nor cost per successful task.
- Tier labels are the set author's judgement, and the boundary between `expert` and `frontier` is the least certain.
- With `retainOnAbstain` a follow-up continues the previous route; routing that reads session history is not implemented.
