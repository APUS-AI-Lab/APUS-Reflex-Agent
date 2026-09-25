---
description: "Deterministic completion supervision, shadow comparison, and usage ledger primitives for System3."
kind: "package-library"
---

# @deepseek-ai/dsh-experimental-system3-supervisor

English | [中文](README.zh.md)

## Summary

This dependency-free library keeps Jev advice subordinate to independent
evidence. `candidate_done` becomes `done` only when the goal revision is current,
all required checks pass, evidence references exist, and budget remains. It also
records model-vs-baseline divergence and distinguishes provider usage from
estimates.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

```ts
import { superviseSystem3Advice } from '@deepseek-ai/dsh-experimental-system3-supervisor'

const result = superviseSystem3Advice({
  currentGoalRevision: 'goal:1',
  advice: { action: 'candidate_done', goalRevision: 'goal:1', evidenceRefs: ['test:1'] },
  requiredChecks: [{ id: 'tests', status: 'pass', evidenceRefs: ['test:1'] }],
  availableEvidenceRefs: ['test:1'], budgetRemaining: 10,
})
```

Treat `result.action` as the only completion decision. Persist
`compareSystem3Advice()` output as shadow evidence, and pass provider-reported
usage to `validateSystem3CostRecord()` with `source: 'provider'`; estimates stay
explicitly marked.

<a id="understand-the-implementation"></a>
## Understand the implementation

The supervisor rejects stale goal revisions and missing evidence before advice
handling. Failed checks produce `retry`; unknown checks produce `escalate`;
unknown advice fails closed. `sumSystem3CostRecords()` is arithmetic only and
does not turn estimates into provider facts.

<a id="model-experience"></a>
## Model Experience

### Completion supervision

#### What the model sees

The package adds no prompt; it converts `candidate_done` plus durable checks into an execution action after the model request has returned.

#### Token effect

None directly. The ledger records actual usage or an explicitly marked estimate so evaluations can compare the added Jev call with its avoided work.

#### KV Cache effect

None directly; the supervisor does not assemble requests, and a caller may keep its fixed prompt prefix when it logs a decision.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The supervisor trusts the independent check provider and evidence inventory;
  it does not run tests, inspect files, or enforce a process sandbox.
- Cost records contain token counts and elapsed time, not provider price tables;
  price-version joins belong to the DSH accounting layer.
- Shadow comparison is an observation seam. It does not train or automatically
  promote a Jev checkpoint.

<a id="dev-note"></a>
### Dev Note

Tests cover accepted completion, failed/unknown checks, stale goals, missing
evidence, shadow divergence, usage summation, and invalid counts. Run
`vitest run packages/experimental/system3-supervisor/tests/supervisor.spec.ts`.
