---
description: "Model-facing tools that read back and search the original conversation behind compaction checkpoints, for agent developers enabling lossless long sessions."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-history-recall

English | [中文](README.zh.md)

## Summary

Use `dsh-tool-history-recall` to let a model recover conversation that compaction replaced. `history_read` pages through the exact original messages behind one checkpoint, and `history_search` finds a literal string across every checkpoint's originals. Both read the current session's append-only log, so a compacted session loses no content the model once saw. Pair it with `dsh-compaction-basic` configured with `recallFooter: true`, which ends each checkpoint with the id these tools accept.

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

Mount this package beside a compaction backend and `ctx.sessionQuery` when long sessions must keep every earlier detail reachable after compaction.

### When to choose it

Choose it when tasks run past the context window and later steps depend on exact earlier values, paths, or error strings that a summary may paraphrase or drop. Without `recallFooter: true` on the compaction backend the model has no checkpoint id; it can still start from the source event of a recalled Continuum memory, or search. The [Continuum Reflex integration](../../experimental/continuum-jev/README.md) mounts this plugin itself while Reflex is enabled.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `pageChars` | `24000` | Characters returned by one `history_read` page |
| `maxMatches` | `20` | Maximum matches returned by one `history_search` call |
| `snippetRadius` | `160` | Characters of context shown on each side of a match |

### What the model can do

| Tool | What the model gets |
|---|---|
| `history_read` | One page of the checkpoint's original span rendered as `User:`, `Assistant:`, and `Tool result:` entries with their event seqs, plus the next offset or an end marker. Naming `event` instead of `checkpoint` selects the checkpoint that replaced that event and starts the page at its message; naming both or neither is an error |
| `history_search` | Case-insensitive literal matches as snippets labeled with checkpoint id and offset, plus scanned, matched, and truncated counts |

A checkpoint that replaced an earlier checkpoint renders that earlier checkpoint with its footer, so older spans stay reachable through it. Reasoning blocks are omitted because providers do not resend them as conversation.

### Failures and recovery

Unknown checkpoint ids fail with `HISTORY_RECALL_UNKNOWN_CHECKPOINT` and list the known ids. An offset past the end or below zero fails with `HISTORY_RECALL_INVALID_OFFSET`, a blank query with `HISTORY_RECALL_INVALID_QUERY`, and a call without an agent with `HISTORY_RECALL_NO_AGENT`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design

The session log already stores every shadowed event, and each `compaction/summary` event records `shadowedSeqs`. Recall is a pure function of that log: no new storage, index, or model call, so keyless replay stays deterministic. Offsets address characters of the rendered span, which is identical for identical logs. The design follows the [recallable compaction proposal](../../../.agents/notes/proposed/feature/2026-07-06-recallable-compaction.md); its frozen index stubs and separate state checkpoint are not implemented here.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config, prompt section, both tools, page and search operations |
| [`src/transcript.ts`](src/transcript.ts) | Checkpoint listing and transcript rendering |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-compaction-basic](../../compaction/compaction-basic/README.md) — the backend whose `recallFooter` option names checkpoints.
- [dsh-session-query](../session-query/README.md) — the service these tools read through.
- [dsh-tool-session-query](../tool-session-query/README.md) — search and read tools across sessions.

-----

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

The model receives one fixed recall guidance section.

##### Recall guidance

```markdown
Checkpoints that condense earlier conversation may end with a footer naming a checkpoint id, and recalled memories name the event of their source message. The original messages are never lost: use history_read with a checkpoint id or a source event to read them page by page, or history_search to find an exact string, value, path, or error message across every checkpoint. Read the originals before relying on details that a checkpoint summary omits or only paraphrases.
```

#### Token effect

One fixed concise section is present on each request while the plugin is mounted.

#### KV Cache effect

Prefix-stable while the plugin and guidance text are unchanged.

### Tool schemas

#### What the model sees

The model sees the generated [`history_read` and `history_search` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-history-recall).

#### Token effect

Two fixed read-only schemas are sent on each request while visible.

#### KV Cache effect

Prefix-stable while tool visibility and definitions are unchanged.

### Tool results

#### What the model sees

Each successful call emits one plain-text block: a page with a header and continuation marker, or a list of snippets with coverage counts.

#### Token effect

`pageChars` bounds a page and `maxMatches` with `snippetRadius` bound a search result; results stay in logged tool history until compaction.

#### KV Cache effect

Recalled text lands at the request tail and does not invalidate earlier cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Current session only** — the tools read the caller's own session; `dsh-tool-session-query` covers other sessions.
- **Whole-log reads** — each call reads the complete session log through `ctx.sessionQuery.readSession`, which costs time linear in log length.
- **Literal search** — matching is case-insensitive literal text, without regex or semantic matching.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This read-only model adapter owns no event or mutable data relationship beyond the registries that already validate registration.
