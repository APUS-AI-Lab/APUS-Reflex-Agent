---
description: "AG-UI over HTTP: stream APUS Reflex Harness turns, threads, approvals and questions to an external client."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-agui

English | [中文](README.zh.md)

## Summary

`dsh-experimental-agui` lets a client that speaks [AG-UI](https://docs.ag-ui.com) — such as `HttpAgent` — drive APUS Reflex Harness agents over HTTP. One `POST <basePath>/run` streams a turn as server-sent AG-UI events; a small thread API lists, creates, renames and archives persisted Sessions and replays their history; approval and question requests raised while a run is streaming become `CUSTOM` events the client answers through matching routes. A thread id is the Session id, so the durable Session log stays the only source of truth.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Use this overlay from a built source checkout with development dependencies installed; the plugin path resolves beside the overlay. Default `dsh` installations do not include AG-UI; this package does not supply an installable profile bundle.

Mount the plugin on a profile that provides `webServer`, `agents` and `sessions`; the Web profile does. Export the bearer token in the environment variable the row names, then apply the shipped overlay:

```sh
export DSH_AGUI_TOKEN='a-long-random-secret'
pnpm dsh --patch packages/experimental/agui/cordis.patch.yml --profile web --no-open
```

Send AG-UI requests to `http://127.0.0.1:3080/agui/run` with `Authorization: Bearer <DSH_AGUI_TOKEN>`.

Routes, all under `basePath` and all requiring `Authorization: Bearer <token>`:

| Route | Purpose |
|---|---|
| `POST /run` | AG-UI `RunAgentInput`; the newest `user` message is submitted to the thread's Agent and the turn streams back as `text/event-stream` (`data: <json>` per event). |
| `GET /threads` | Root Sessions with title, archived flag, cwd, createdAt and whether an Agent is live. Needs `sessionQuery`. |
| `POST /threads` `{ id?, cwd? }` | Create a Session ahead of its first run. |
| `PATCH /threads/:id` `{ title?, archived? }` | Rename (needs `sessionTitle`) or archive (needs `workspaceRegistry`). |
| `GET /threads/:id/messages` | AG-UI `user`, `assistant` and `tool` messages projected from the durable log. Needs `sessionQuery`. |
| `POST /approvals/:id` `{ decision: "allow" \| "reject" }` | Answer a `CUSTOM dsh.approval` event. |
| `POST /questions/:id` `{ answers: [...] }` | Answer a `CUSTOM dsh.question` event. |

Events emitted during a run: `RUN_STARTED`, `TEXT_MESSAGE_*`, `REASONING_MESSAGE_*`, `TOOL_CALL_START/ARGS/END/RESULT`, `SUBAGENT_STARTED/FINISHED/ERROR`, `CUSTOM` (`dsh.approval`, `dsh.question`, `dsh.subagent.activity`) and `RUN_FINISHED` or `RUN_ERROR`. Closing the response cancels the turn.

### Configuration

| Key | Meaning |
|---|---|
| `tokenEnv` | Environment variable holding the bearer token. Required; an empty value fails activation. |
| `basePath` | Absolute route prefix without a trailing slash. Default `/agui`. |
| `provider`, `model` | Route for Agents this bridge creates or resumes. |
| `defaultCwd` | Working directory for new Sessions when `forwardedProps.cwd` is absent. Defaults to the process cwd. |
| `maxBodyBytes` | Largest accepted request body. Default 1 MiB. |
| `refreshMcpServers` | MCP `serverName`s whose tools are re-listed before each run, for servers that cannot announce tool changes. Default `[]`. |
| `mcpRefreshTimeoutMs` | Longest a run waits for that re-list; after it, or on a failure, the run starts with the cached tools. Default 3000. |

A run may carry `forwardedProps.persona` `{ name, tone, hidden? }`; the default is APUS Reflex Harness with the `concise` tone. The persona replaces the harness identity and Web-only prompt sections. At every step, `persona:capabilities` lists only mounted general-purpose tool groups (`web`, `search`, `files`, `terminal`, `experts`) not in `hidden`. Unclassified tools remain callable and are described by their tool schemas; the bridge neither infers business capabilities from MCP server names nor requires product-specific settings or pages.

Custom profile plugins can reuse `installPersona(agent.ctx, { persona })` to install the same agent-scoped prompt sections.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`src/run.ts` drives one turn: it queues the user message with `agent.followup`, correlates the claimed turn through `agent/inbox/claimed`, projects `agent/assistant-stream` frames into text, reasoning and tool-call events as the model streams, reads `tool/result` and `turn/end` from `session/event`, and finishes with `RUN_FINISHED` or `RUN_ERROR`. Every listener is scoped to the exact Agent and removed when the run settles; the Session is flushed afterwards so the list and history routes read a durable log.

`src/index.ts` owns admission, the per-thread `AgentHandle` cache (live in this process, resumed from persistence, or created), the pending approval and question maps, and route dispatch. `src/projection.ts` derives history messages from committed events: only `user/message` events with `source.kind === 'user'`, `assistant/message` and `tool/result` appear, so injected context never reaches the client.

**Runtime invariant:** No runtime invariant companion is published. Every fact the bridge reports is read from the Agent runtime and the Session log; it keeps no independent durable state.

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Bridge persona and mounted capabilities

#### What the model sees

The `persona:capabilities` section accompanies the selected persona. Bridge Agents receive the selected name and tone, honesty instructions and a summary of recognised mounted tool groups. Client persona changes and mounted tools update these sections on the next model request. The exact default assembled text is pinned in the [SDK-profile snapshot](../../../snapshots/sdk/agui-persona/system-prompt.expected.md). Tool execution and approval policy remain deployment-owned; approval and question results follow the client response or cancellation.

#### Token effect

Persona and capability sections replace the deployment identity and Web-only sections. Their size depends on the bounded persona name and mounted capability groups; this plugin sends no independent model request.

#### KV Cache effect

An unchanged persona and tool set preserve the repeated prompt prefix. Changing the persona, hidden groups or mounted tools replaces the corresponding prompt sections and may invalidate prefix reuse from the first changed token.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- One run per thread at a time; a second `POST /run` answers 409.
- Thread `updatedAt` is not reported; `createdAt` comes from the Session header.
- `SUBAGENT_*` and `dsh.subagent.activity` events cover the runs the streaming thread's agent delegated; runs started by its descendants are not reported.
- Reasoning and text of a superseded model attempt are streamed and then replaced by the retry's output; the client sees both.
- No TLS and no per-user identity: one bearer token admits one trusted front-end.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer working context — click to expand</summary>

Tests mount a real AgentLoop, JSONL persistence, the test session-query engine and a listening `WebServer` on port 0, then call the routes over HTTP (`tests/harness.ts`).

</details>
