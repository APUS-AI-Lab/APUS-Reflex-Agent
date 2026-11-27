---
description: "Task-container process handles for session-scoped command consumers and their maintainers."
kind: "package-reference"
---

# @deepseek-ai/dsh-subprocess-remote

## Summary

`dsh-subprocess-remote` provides live `ctx.subprocess` handles for commands executed by a Benchmark task process worker. It sends one spawn request with a stable call id, reads bounded output windows by absolute byte offset, and addresses termination and stdin updates to that same id. Lost acknowledgements never cause another spawn.

## Table of Contents

- [Use this package](#use-this-package)
- [Process and output lifecycle](#process-and-output-lifecycle)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use this package

Mount this provider in the task Agent's isolated subprocess context. Keep Harness-owned services on their original local provider. A command requires `spec.agentId`; when a SessionStore is present, its native parent-session chain selects the root task route without changing the source identity.

```yaml
- id: task-processes
  name: '@deepseek-ai/dsh-subprocess-remote'
  config:
    endpoint: http://terminalbench-pipeline:8080
    token: !!js 'process.env.PIPELINE_API_TOKEN?.trim()'
    pollIntervalMs: 250
    requestTimeoutMs: 5000
    maxRecoveryMs: 60000
    maxReadBytes: 65536
    pipeBufferBytes: 1048576
```

| Field | Purpose |
|---|---|
| `endpoint` | Benchmark service hosting `/jobs/by-session/<root-session>/process`. |
| `token` | Optional Bearer credential; never forwarded to a redirected target. |
| `pollIntervalMs` | Delay between idle status/output reads. |
| `requestTimeoutMs` | Budget for one transport request, not command execution. |
| `maxRecoveryMs` | Bound for recovering a temporarily unavailable process record. |
| `maxReadBytes` | Output window per stream; the protocol permits at most 1 MiB. |
| `pipeBufferBytes` | Stream backpressure threshold and remote retention budget for pipe consumers. |

## Process and output lifecycle

`done` settles after the worker reports the child's exit and its output has been drained. `waitForExit` separately requires `range_empty`: a child's exit does not establish that descendants are gone. `terminate`, caller cancellation and provider disposal all address the existing process; disposal awaits termination confirmation and releases owned streams.

`stdin: { data }` supplies batch input, while `stdin: 'pipe'` returns a writable stream with monotonically numbered, retry-safe input messages. Output pipes carry raw bytes. Collection reuses the native bounded OutputCollector; its readers retain byte offsets, truncation information and the worker's real task-container spill path. A host-side cache path is never advertised as a task file. An unknown worker state or a gap in a piped byte stream is a provider failure, not command success.

Explicit environment entries travel to the worker; `undefined` is encoded as `null` to remove an ambient entry. The worker owns parent-environment credential scrubbing. Caller-owned signals and the Bash consumer own command deadlines.

## Model Experience

### Task-environment process results

#### What the model sees

Native `Bash` and spawn-backed search consumers keep their result types while commands execute in the selected task environment. Bounded output retains the worker's recovery file when available rather than replacing the full output with an unexplained count.

#### Token effect

No model call or context is added; the native consumers keep their existing input and result budgets.

#### KV Cache effect

No direct invalidation; the native consumers own any request-prefix changes.

## Known Limitations and Deferred Work

- The process protocol exposes stdin, stdout and stderr, but no PTY or separate control descriptor. These requests fail before a command starts rather than receiving an unusable handle.
- Transport recovery is bounded. When the worker remains unknown, process outcome and cleanup remain unconfirmed; the provider reports that failure instead of restarting the command.
- Watching processes that escape the worker-owned process range requires the execution service to provide stronger containment; the client cannot infer host-level quiescence from child exit.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The worker owns process groups, byte offsets and output spill files inside the task container; the provider must never respawn a call id whose outcome it could not confirm.

</details>
