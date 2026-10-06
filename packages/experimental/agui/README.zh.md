---
description: "基于 HTTP 的 AG-UI 桥：把 DeepSeek Harness 的轮次、线程、审批与提问流式送给 外部客户端。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-agui

[English](README.md) | 中文

## 概述

`dsh-experimental-agui` 让任何会说 [AG-UI](https://docs.ag-ui.com) 的客户端（例如 `HttpAgent`）通过 HTTP 驱动 DeepSeek Harness 的 agent。一次 `POST <basePath>/run` 以 server-sent AG-UI 事件流式返回一个轮次；一组小巧的线程 API 负责列出、创建、重命名、归档持久化的 Session 并回放其历史；运行期间 agent 发起的审批与提问会变成 `CUSTOM` 事件，由客户端通过对应路由作答。线程 id 就是 Session id，因此持久化 Session 日志始终是唯一的事实来源。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

本 overlay 用于已安装开发依赖并完成构建的源码检出；插件路径相对于 overlay 文件解析。默认 `dsh` 安装不包含 AG-UI；本包不提供可安装的 profile bundle。

把插件挂到提供 `webServer`、`agents` 与 `sessions` 的 profile 上；Web profile 满足。先在配置行指定的环境变量里导出 bearer token，再应用随包提供的 overlay：

```sh
export DSH_AGUI_TOKEN='a-long-random-secret'
pnpm dsh --patch packages/experimental/agui/cordis.patch.yml --profile web --no-open
```

客户端向 `http://127.0.0.1:3080/agui/run` 发送 AG-UI 请求，并携带 `Authorization: Bearer <DSH_AGUI_TOKEN>`。

所有路由都在 `basePath` 下，且都要求 `Authorization: Bearer <token>`：

| 路由 | 用途 |
|---|---|
| `POST /run` | AG-UI `RunAgentInput`；最新一条 `user` 消息提交给该线程的 Agent，轮次以 `text/event-stream`（每个事件一行 `data: <json>`）流式返回。 |
| `GET /threads` | 根 Session 列表：标题、是否归档、cwd、createdAt 以及是否有 live Agent。需要 `sessionQuery`。 |
| `POST /threads` `{ id?, cwd? }` | 在首次运行前预先创建 Session。 |
| `PATCH /threads/:id` `{ title?, archived? }` | 重命名（需要 `sessionTitle`）或归档（需要 `workspaceRegistry`）。 |
| `GET /threads/:id/messages` | 从持久化日志投影出的 AG-UI `user`、`assistant`、`tool` 消息。需要 `sessionQuery`。 |
| `POST /approvals/:id` `{ decision: "allow" \| "reject" }` | 回答一条 `CUSTOM dsh.approval` 事件。 |
| `POST /questions/:id` `{ answers: [...] }` | 回答一条 `CUSTOM dsh.question` 事件。 |

运行期间发出的事件：`RUN_STARTED`、`TEXT_MESSAGE_*`、`REASONING_MESSAGE_*`、`TOOL_CALL_START/ARGS/END/RESULT`、`SUBAGENT_STARTED/FINISHED/ERROR`、`CUSTOM`（`dsh.approval`、`dsh.question`），以及 `RUN_FINISHED` 或 `RUN_ERROR`。关闭响应即取消该轮次。

### 配置

| 键 | 含义 |
|---|---|
| `tokenEnv` | 存放 bearer token 的环境变量名。必填；为空则激活失败。 |
| `basePath` | 绝对路由前缀，不带结尾斜杠。默认 `/agui`。 |
| `provider`、`model` | 本桥创建或恢复的 Agent 所用路由。 |
| `defaultCwd` | 客户端未给出 `forwardedProps.cwd` 时新 Session 的工作目录。默认进程 cwd。 |
| `maxBodyBytes` | 可接受的最大请求体。默认 1 MiB。 |
| `refreshMcpServers` | 每次 run 前重新列出工具的 MCP `serverName`，用于无法通知工具变更的服务器。默认 `[]`。 |
| `mcpRefreshTimeoutMs` | run 等待该重新列出的最长时间；超时或失败时 run 使用缓存的工具开始。默认 3000。 |

run 可携带 `forwardedProps.persona` `{ name, tone, hidden? }`；默认是 System3、`concise` 语气。persona 替换 harness 身份与仅用于 Web 的 prompt 段落。`persona:capabilities` 在每一步只列出已挂载工具且不在 `hidden` 中的通用能力组（`web`、`search`、`files`、`terminal`、`experts`）。未分类工具仍可调用，模型通过其工具描述了解用途；桥不会根据 MCP 服务器名推断业务能力，也不会要求使用某个产品的设置或页面。

自定义 profile 插件可调用 `installPersona(agent.ctx, { persona })`，复用相同的 Agent 局部 prompt 段落。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

`src/run.ts` 驱动一个轮次：用 `agent.followup` 排队用户消息，通过 `agent/inbox/claimed` 关联被认领的 turn，把 `agent/assistant-stream` 帧在模型流式输出时投影为文本、推理与工具调用事件，从 `session/event` 读取 `tool/result` 与 `turn/end`，最后以 `RUN_FINISHED` 或 `RUN_ERROR` 收尾。所有监听器都限定到确切的 Agent，并在轮次结束时移除；之后 flush Session，使列表与历史路由读取的是持久化日志。

`src/index.ts` 负责准入、按线程缓存的 `AgentHandle`（本进程 live、从持久化恢复、或新建）、待处理的审批与提问表，以及路由分发。`src/projection.ts` 从已提交事件推导历史消息：只出现 `source.kind === 'user'` 的 `user/message`、`assistant/message` 与 `tool/result`，注入的上下文永远不会到达客户端。

**运行时不变量：** 未发布运行时不变量伴随包。本桥报告的每一条事实都读自 Agent 运行时与 Session 日志；它不持有独立的持久状态。

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 桥的人格与已挂载能力

#### 模型看到的内容

`persona:capabilities` 段落与所选人格一起提供。桥创建的 Agent 接收所选名称、语气、诚实要求以及已识别挂载工具组的摘要。客户端人格与挂载工具发生变化后，这些段落在下一次模型请求更新。默认组装文本由 [SDK profile 快照](../../../snapshots/sdk/agui-persona/system-prompt.expected.md) 固定。工具执行与审批策略仍由部署配置决定；审批和提问结果取决于客户端回答或取消。

#### Token 影响

人格与能力段落替换部署身份及仅用于 Web 的段落。长度取决于有长度限制的人格名称和已挂载能力组；本插件不发起独立模型请求。

#### KV Cache 影响

人格和工具集合不变时，重复提示前缀保持稳定。人格、隐藏组或挂载工具发生变化后，对应提示段落被替换，可能从首个变化 token 起失去前缀复用。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 每个线程同一时刻只允许一个运行；第二个 `POST /run` 返回 409。
- 不报告线程 `updatedAt`；`createdAt` 取自 Session header。
- 运行流式期间，进程内所有子 agent 运行都会发出 `SUBAGENT_*` 事件，而不仅限于该线程的后代。
- 被替换的模型尝试的推理与文本会先流出，再被重试输出替代；客户端两者都会看到。
- 无 TLS、无按用户身份：一个 bearer token 准入一个受信前端。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

测试挂载真实 AgentLoop、JSONL 持久化、测试用 session-query 引擎，以及监听 0 号端口的 `WebServer`，然后通过 HTTP 调用路由（`tests/harness.ts`）。

</details>
