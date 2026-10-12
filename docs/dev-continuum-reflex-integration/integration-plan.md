# Continuum × Reflex integration acceptance

English | [中文](integration-plan.zh.md)

## Integration status

The memory and control source branches are both included in `main`. The isolated integration worktree owns subsequent acceptance fixes; their publication status and executed evidence are maintained in [release readiness](release-readiness.md). Source inclusion does not establish functional acceptance.

## Shared implementation responsibilities

- `deploy/system3/runtime.patch.yml` composes the control plugins, Continuum and its optional Jev selector. Memory stays default-off; absent Session classification disables System3 while general-model execution remains available.
- Session event declarations and persistence preserve every model-visible input and its source references. Published historical format generations remain immutable.
- Dependency metadata, generated catalogs and replay expectations describe the combined implementation.
- Repairs belong in the owning package; shared configuration and both SDK projections require their own validation.

## Acceptance matrix

| Scenario | Required evidence |
| --- | --- |
| Original profile | General-model execution works without Continuum or a configured Jev service. |
| Switch lifecycle | Configuration changes, off/shadow/active modes and reload preserve the documented projection behavior. |
| Process restart | Persisted Session facts, record IDs and source references survive real process replacement. |
| Correction and conflict | Superseded facts stop acting as current records; rejected revisions do not partially commit. |
| Permission and scope | Unauthorized scopes and records do not enter recall or model requests. |
| Budget and long history | Configured excerpt limits hold, request overhead is accounted for separately, and long histories rebuild. |
| Disable and unload races | In-flight reads and late Jev answers cannot inject after disable, disposal or unmount. |
| Jev failure | Timeout, cancellation, abstention and documented fallback behavior remain observable and recoverable. |
| Derived index | Indexed and direct retrieval preserve matching semantics; durable Session records remain authoritative. |
| Concurrent persistence | Repeated flush does not duplicate records; failed writes do not silently lose accepted data. |
| Control integration | Goal, context, supervision and runtime configuration do not overwrite each other's state. |
| SDK replay | TypeScript and Python retain their model-visible projections; memory has a recorded Session oracle. |
| Live product path | Declared Jev and generation providers execute real requests; browser state and disk evidence agree. |

## Release condition

Publication requires explanations and tests for resolved conflicts, evidence for the applicable scenarios, and the final repository checks on fixed sources and built artifacts. Any failure, skip or unexecuted platform remains explicit in the readiness report. Passing this matrix does not promise unlimited storage, cross-Session recall or universal task quality.
