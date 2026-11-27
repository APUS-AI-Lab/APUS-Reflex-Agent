---
description: "Opt-in retry budget for tool calls that declare themselves replayable, plus a durable per-attempt record, for maintainers choosing or debugging the plugin."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-call-retry-policy

## Summary

Use this package to let a tool's own definition declare how many times one call may be attempted, and to record each retried attempt in the session log. A tool that declares no budget is dispatched exactly once, so the shipped composition keeps single-attempt behavior. The budget is opt-in rather than a deployment default because a retry reruns the body, side effects included.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin with no configuration; the `dsh` base bundle already has it:

```yaml
- name: '@deepseek-ai/dsh-tool-call-retry-policy'
```

A tool opts in through its own definition:

```ts
defineTool({
  name: 'read',
  // ...schema and body...
  retry: { maxAttempts: 2, backoffMs: 100 },
})
```

`maxAttempts` counts the original attempt, so `2` means one retry. `backoffMs` is optional and defaults to no delay.

### When to choose it

Choose it for tools that re-observe their inputs on every attempt and have no side effect worth avoiding: reads, lookups, and other queries. Avoid it for tools that mutate state, since a retried attempt repeats the mutation. Removing the plugin leaves every declared budget inert and restores single-attempt dispatch.

<a id="understand-the-implementation"></a>
## Understand the implementation

The plugin registers one `tools/execute` wrapper. It resolves the caller-visible definition, delegates the first attempt, and retries only when:

- the attempt failed,
- the caller has not cancelled, and
- the attempt budget is not spent.

An attempt whose failure carries the registry's cancellation codes (`ABORTED`, `ABORTED_BEFORE_DISPATCH`) is a caller decision and is never retried. Every retried attempt appends a non-surface `tool/retry-started` record to the call's Session immediately before dispatch, so a hard interrupt still leaves the started retries behind. The append is contained: a rejected record warns and never changes the returned result.

<a id="model-experience"></a>
## Model Experience

The plugin never sends anything to the model: the retry budget is not part of the tool schema, and `tool/retry-started` is a durable record the model never sees. A retried call produces one model-visible `tool/result` for the winning attempt; earlier failed attempts are visible only in the trajectory. Prompt content, token count, and KV-cache behavior are unchanged.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Only the `guard/retry-policy` wrapper decides retries. A capability that retries internally (for example an MCP connection supervisor's reconnect loop) keeps its own record and is not reported as `tool/retry-started`.
- The budget cannot be set per deployment; a tool that does not declare one is never retried. Adding a deployment default would need an explicit product decision because it changes side-effect behavior for every tool.
- Nested and PTC sub-dispatches that do not traverse `tools/execute` are outside this wrapper's reach.
