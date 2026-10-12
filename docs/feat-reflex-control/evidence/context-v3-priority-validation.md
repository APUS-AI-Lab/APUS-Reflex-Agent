# Context review v3 priority validation

English | [中文](context-v3-priority-validation.zh.md)

The browser v2 request combined a finance task frame saying travel was irrelevant with a later request for the archived hotel, breakfast and meeting details. The old travel exclusion had no explicit temporal role. v3 records an ordered `currentUserRequests` array, an `activeGoal` only while its phase is active, and `priorTaskFrameConstraints` separately. Its instructions distinguish task relevance from lasting safety, permission, precision and original-file constraints. No threshold or cache protection changed.

The fixed five-request comparison used the existing synthetic browser evidence, model APUS-OpenJev-v1-9B-5949, high effort and unchanged 0.9/0.1 thresholds, with no retries. All requests and responses, including the v2 failure, are retained in [the comparison record](context-v3-priority-comparison.json).

| Probe | Observation |
| --- | --- |
| Original restore v2 | Required travel fragment f1 scored 0.033086: not restored. |
| Same fragments with v3 task roles | Required travel fragment f1 scored 0.998499: selected for restoration. |
| Finance removal v2 | Necessary monetary fragments were retained. |
| Finance removal v3 | Necessary monetary fragments were retained; only the old travel text was selected. |
| Ordered constraint then start request, v3 | Necessary monetary fragments were retained; the prior constraint remained available. |

The keyless regressions cover ordered same-batch requirements, topic fallback, active versus paused Goal state, inherited original-file/Decimal constraints, request budgets and recovery after rebuilding a fresh Host context from durable events. The existing cache-prefix tests remain unchanged. The focused context implementation coverage passes all four metrics at 100%.

These are limited semantic probes and deterministic Host regressions. The subsequent [Host16 browser acceptance](browser-context-v3.json) passed finance with exactly six reads, then automatic recovery before the first primary-model request after a complete Host restart, without tool calls or changes to the old persisted prefix. Context v3 TypeScript refresh/replay and Python record/replay also passed on Host16; [the consolidated report](context-semantic-validation.md) records their scope and retained failures. The path-only archive fragment was also selected for restoration in v3; selection is bounded recovery, not a claim that every returned fragment is necessary.
