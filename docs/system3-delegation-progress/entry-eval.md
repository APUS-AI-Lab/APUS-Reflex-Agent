# System3 entry-routing evaluation · 2026-10-02

English | [中文](entry-eval.zh.md)

Source: `packages/experimental/system3/tests/entry-routing-eval.e2e.ts` over `tests/fixtures/entry-routing-eval.tasks.json`. Raw output: [entry-eval-report.json](entry-eval-report.json).

Run: `set -a; source ~/.config/xdan-system3/runtime.env; set +a; SYSTEM3_ENTRY_EVAL_REPORT=<path> pnpm exec vitest run --config vitest.e2e.config.ts packages/experimental/system3/tests/entry-routing-eval.e2e.ts`

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

## What this does and does not show

- Jev separates simple from hard inputs on this set and abstains on context-dependent follow-ups, at about half a second per decision.
- The rule was written with the first 40 inputs and the adversarial inputs were chosen to defeat it. Its 0 / 10 is by construction; the comparison shows that length and keywords are not enough, not how a tuned rule would do.
- Labels were assigned by the set's author. There are no medium-difficulty inputs.
- The evaluation scores the routing decision. It does not measure whether Pro answers the hard inputs better than Flash, nor cost per successful task.
- Every follow-up stays on Flash, including ones that continue a hard task. Routing with session history is not implemented.
