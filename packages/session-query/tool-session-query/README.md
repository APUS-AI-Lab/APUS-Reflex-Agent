---
description: "Workspace-authorized model-facing session history tools for agent developers and maintainers choosing, configuring, or debugging prior-session search, tracing, and event reads."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-session-query

English | [中文](README.zh.md)

## Summary

Use `dsh-tool-session-query` to let a model search earlier sessions, inspect event matches, trace relationships, and read exact event data in bounded pages. Its five read-only tools authorize cross-session access only when the target session's `cwd` exactly matches the caller's; callers without a `cwd` can inspect only themselves. Search excludes the caller session and asks the model to narrow its query at the deployment result cap. The package is opt-in and adds fixed guidance plus five tool schemas to every model request.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this package when the agent should be able to search its own prior sessions and inspect their relationships and events. The common path is explicit: mount the plugin over `ctx.sessionQuery` (backed by `dsh-session-query-sqlite`), then let the model call the tools.

### When to choose it

Choose it when a deployment wants model-driven retrieval of prior work — for example a coding agent that searches what it did in earlier sessions before starting a task. Avoid it when only programmatic retrieval is needed: `ctx.sessionQuery` itself serves code callers without the model-facing schema, prompt, and authorization layer.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `maxSearchResults` | `100` | Maximum authorized hits returned by one search call |
| `searchTimeoutMs` | `30000` | Cooperative deadline attached to both full-text search tools |
| `maxReadBytes` | `8192` | Complete event-read output budget in UTF-8 bytes, at least `256` |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-session-query) is the exhaustive source for every accepted field and its JSDoc.

### What the model can do

| Tool | What the model gets |
|---|---|
| `session_search` | Sessions matching a literal query, ranked, with title and best-match excerpt; always omits the caller session |
| `session_event_search` | Events matching a literal query inside one authorized session; for the current session it stops before the step that invoked it |
| `session_trace` | The authorized ancestor chain and descendant tree of one session; unauthorized boundaries appear as markers without hidden ids |
| `session_event_trace` | One event's positional replacements and cited source-event relationships |
| `session_event_read` | Complete event JSON with optional neighbors when it fits; otherwise a bounded exact page with continuation offset and event digest |

Workspace authority is conservative: cross-session access requires exact `cwd` equality between target and caller session, and a caller without `cwd` can inspect only itself. Requested parent ids are deduplicated and authority-checked before search; missing and cross-workspace guesses behave identically. Search results are cursor-free: a capped result asks the model to narrow its query, and never exposes provider cursors, offsets, page sizes, or a model-controlled limit. Timestamps at the tool boundary are timezone-qualified ISO 8601 and become inclusive epoch-millisecond filters.

Explicit `view: event-json` returns pages of `JSON.stringify(event, null, 2)`, not physical JSONL bytes. `view: text-block` with `block` returns that original message text without trimming. Pages contain `sha256`, UTF-16 `offset`/`end`/`total`, `content`, and `next_offset` (null at the end); positions never split a valid surrogate pair. Continue with the same view/block, `next_offset` as `offset`, and the returned `sha256` as `expected_sha256`; changed events are rejected. Explicit paging cannot combine with nonzero `before`/`after`. An oversized legacy read automatically returns the first event-JSON page and marks requested neighbors omitted.

### Failures and recovery

Every trusted query service call passes through an error sanitizer: caller cancellation is preserved, provider diagnostics stay in internal logs, and unsafe failures become `SESSION_QUERY_TOOL_FAILED`. Local validation and authorization retain tool-owned errors. Event reads enforce `maxReadBytes` over the complete emitted string; metadata that cannot fit produces `SESSION_QUERY_TOOL_READ_BUDGET_TOO_SMALL`, without source content. Other tools still rely on the optional generic spill policy for oversized inline results.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the tools and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The consumer is built on one separation and three commitments:

- **Narrow read-only tools.** Five flat snake-case schemas keep search pagination internal and expose source-read continuation only when needed.
- **Authority derived from the caller, never the model.** Caller identity comes from `ToolExecution.exec.agent`; workspace is exact-string `cwd` equality, re-checked against the header observed with each result.
- **One model-boundary sanitizer.** Every trusted `ctx.sessionQuery` call goes through the service boundary, which preserves cancellation and contains diagnostic and classification failures.
- **Exact source pages.** Page contents concatenate to the selected original string; a digest binds every page to one complete event.

The design history lives in the [model-facing session query tools note](../../../.agents/notes/archived/feature/2026-07-24-model-facing-session-query-tools.md) and the [session-search-not-shipped-default note](../../../.agents/notes/archived/feature/2026-08-02-session-search-not-shipped-default.md).

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config, prompt section, five tool registrations |
| [`src/input.ts`](src/input.ts) | Model schemas, argument normalization, filter construction |
| [`src/workspace-access.ts`](src/workspace-access.ts) | Caller identity, workspace authorization, title access, lineage projection |
| [`src/service-boundary.ts`](src/service-boundary.ts) | Trusted calls and model-safe error translation |
| [`src/operations.ts`](src/operations.ts) | The five operation workflows |
| [`src/presentation.ts`](src/presentation.ts) | Text result rendering and tool-call cards |

### Operation flow

Each executor derives the caller, normalizes the model's arguments into service filters, authorizes the target (or the requested parent ids) against the caller workspace, and collects results through the service boundary. Both search tools page internally through provider cursors while the observed generation stays valid, stopping at `maxSearchResults`; because one search consumes generation-bound provider cursors, the two search tools execute exclusively with sibling tool calls, while the three exact trace/read tools opt into parallel execution. Lineage output replaces unauthorized ancestor and descendant boundaries with markers containing no hidden session id.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the tool surface to the underlying service, the schema catalog, and the design evidence.

- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-session-query) — the five tool schemas as the model sees them.
- [dsh-session-query](../session-query/README.md) — the service these tools call.
- [dsh-session-query-sqlite](../session-query-sqlite/README.md) — the full-text backend behind the two search tools.
- [Session Query subsystem reference](../../../docs/subsystems/session-query.md) — the type-level contract under the tools.
- [Model-facing session query tools](../../../.agents/notes/archived/feature/2026-07-24-model-facing-session-query-tools.md) — workspace authority, cursor-free results, and spill decisions.

-----

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

The model receives one fixed prior-history guidance section.

##### Prior-history guidance

```markdown
Use session_search to find relevant work from prior sessions, or session_event_search to search earlier events in one session. Search results are cursor-free and workspace-scoped. Follow a useful hit with session_trace, session_event_trace, or session_event_read when you need lineage, relationships, or exact data.
```

#### Token effect

One fixed concise section is present on each request while the plugin is mounted.

#### KV Cache effect

Prefix-stable while the plugin and guidance text are unchanged.

### Tool schemas

#### What the model sees

The model sees the generated [`session_search`, `session_event_search`, `session_trace`, `session_event_trace`, and `session_event_read` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-session-query). Search cursors and model-controlled result limits remain absent; event reads expose view, block, offset, and expected digest.

#### Token effect

Five fixed read-only schemas are sent on each request while visible.

#### KV Cache effect

Prefix-stable while tool visibility and definitions are unchanged.

### Tool results

#### What the model sees

Each successful call emits one text block. Search results include titles and excerpts; traces include authorized relationships. Event reads retain complete small results and page larger results; the generic spill policy may further shorten inline tool output.

#### Token effect

Results are data-dependent and remain in logged tool history until compaction; `maxSearchResults` bounds search-hit count.

#### KV Cache effect

Append-only result text follows the reusable request prefix and does not invalidate earlier cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when this package is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **Search caps without continuation** — search returns at most the deployment cap and asks the model to narrow its query when more matches exist; there is no continuation token.
- **Conservative workspace identity** — workspace identity is exact-string `cwd` equality, so symlink-equivalent paths do not share authority.
- **Source reads still load full events** — pagination bounds model output, not backend memory use; traces still need the spill policy for bounded inline output.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open design questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

#### Future: broader workspace semantics

Exact-string `cwd` equality is deliberately conservative; symlink-aware or canonical-path workspace identity would change which sessions share authority and is undecided.

</details>

**Runtime invariant:** No companion is published. This read-only model adapter owns no event or mutable data relationship beyond the registries that already validate registration.
