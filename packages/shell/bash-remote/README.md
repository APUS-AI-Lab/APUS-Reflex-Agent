---
description: "Native Bash execution over a task-scoped remote subprocess provider."
kind: "package-reference"
---

# @deepseek-ai/dsh-bash-remote

## Summary

`dsh-bash-remote` inherits the native LocalBashExecutor and requires the owning agent on every resolved request. The subprocess provider installed in the same isolated task context determines where Bash runs. Native foreground and background execution, deadlines, cancellation, byte-based incremental output and output recovery remain owned by their existing implementations.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use this package

Mount this executor beside `dsh-subprocess-remote` in the task Agent's isolated context. The subprocess provider holds endpoint and authentication settings; this package uses the unchanged [native Bash configuration](../bash-local/README.md).

```yaml
- id: task-bash
  name: '@deepseek-ai/dsh-bash-remote'
  config:
    cwd: /app
    timeoutMs: 120000
    maxTimeoutMs: 600000
    maxOutputBytes: 64000
    maxSpillBytes: 67108864
    graceMs: 3000
```

The model-facing Bash consumer stamps `agentId`. Resolving an agentless command fails before any remote operation. Native `onExpiry: 'none'` returns a live background handle; `kill()` reaches the worker-owned process rather than returning a synthetic finished result.

## Model Experience

### Task-environment Bash results

#### What the model sees

Native Bash input, output, timeout and failure presentation stay intact, including real task-container output recovery paths supplied by the remote process provider. The model-facing consumer stamps `agentId`; resolving an agentless command fails before any remote operation.

#### Token effect

No model call, prompt text or tool parameter is added; the native Bash consumer keeps its existing input and result budgets.

#### KV Cache effect

No direct invalidation; the native Bash consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- This executor requires a working task-scoped subprocess provider. It does not silently run a command on the Harness host if remote execution fails.
- PTY and separate control-channel support are properties of that provider's protocol, not capabilities this Bash adapter fabricates.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This adapter inherits `LocalBashExecutor`; only the subprocess provider decides where a command runs, so keep deadlines, cancellation and output collection in the inherited implementation.

</details>
