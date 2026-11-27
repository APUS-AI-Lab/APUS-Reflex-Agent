---
description: "Filesystem provider for deployments whose task files live in another container, for maintainers wiring a benchmark trial to its task service."
kind: "package-reference"
---

# @deepseek-ai/dsh-fs-remote

## Summary

`dsh-fs-remote` serves `ctx.fs` from the environment a benchmark service owns. A benchmark trial can hand its work to this harness while its files stay in a container this process never touches, so every operation runs a short program in that task container and returns its real answer.

The target key carries the agent as well as the path. One harness process serves concurrent cases, and the service needs that identity to choose the right container; consumers treat the key as opaque.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount this provider instead of a local one when the task's files are not on this host.

```yaml
- id: fs-sandbox
  disabled: true          # one filesystem provider may be loaded

- id: fs-remote
  name: '@deepseek-ai/dsh-fs-remote'
  config:
    endpoint: http://terminalbench-pipeline:8080
    token: !!js 'process.env.PIPELINE_API_TOKEN?.trim()'
```

| Field | Meaning |
|---|---|
| `endpoint` | The service that owns the task containers. Required. |
| `token` | Bearer credential, sent as `Authorization`. Optional. |
| `timeoutSec` | Budget for one operation. |

Each operation is a `POST <endpoint>/jobs/by-session/<agentId>/exec` whose command runs a Python program in the task container. Program and request travel base64-encoded, so neither a path nor a file body can change the command the container runs.

<a id="understand-the-implementation"></a>
## Understand the implementation

Every operation is one program invocation: read, stat, list, write, edit, bytes or a byte range. The program prints one JSON answer; a failure the caller can act on — a missing file, text that does not match, a changed version — arrives as a code inside that answer, while a container that never replied throws. The two are different facts and stay distinguishable.

Version tokens identify the device, inode, nanosecond modification time and byte size. Probe processes serialize guarded mutations by canonical target, then publish through a temporary file and an atomic replacement or exclusive create. Writers outside this provider do not participate in its lock.

`resolve` and `lstat` require the calling agent in their options. Resolution follows symbolic links, including existing parents of an absent target; `lstat` observes the final directory entry without following its link. Read-only mutation policy rejects writes, workspace-write checks the current canonical path and directory descriptor against its workspace root, and danger-full-access does not apply that workspace restriction.

<a id="model-experience"></a>
## Model Experience

### Task-environment file results

#### What the model sees

The model-facing `read`, `read_image`, `write` and `edit` consumers keep their existing result types. Byte reads reject oversized files instead of returning truncated content, text reads reject binary or malformed UTF-8 content, and streamed text is decoded across bounded byte windows. `glob` and `grep` are subprocess consumers and require a separately configured remote subprocess provider.

#### Token effect

No prompt text or model call is added; the native file consumers keep their existing input and result budgets.

#### KV Cache effect

No direct invalidation; the native file consumers own any request-prefix changes.

## Known Limitations and Deferred Work

- **No watching.** `watch` inherits the base refusal; a task trial does not need change notifications.
- **Streaming uses bounded round trips.** A changed file version interrupts a streamed read instead of combining different versions.
- **Cancellation does not undo a committed mutation.** Pre-aborted calls send nothing; stopping an already dispatched task-container command requires the execution service to cancel that command.
- **A lost service is a failed operation.** Nothing is retried: a write must not happen twice.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The probe program is uploaded into the task container and answers over the execution service; do not add host-side fallbacks that would let a task read or write Harness-host files.

</details>
